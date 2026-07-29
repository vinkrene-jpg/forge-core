// AI Guardian Reviewer module.
// Composes the rule-based Guardian (unchanged Locked Core behavior) with an
// AI review that runs exclusively through the AI Gateway. The combined
// outcome can only be stricter than the rule-based outcome, never milder:
// an AI "pass" can never override a rules "fail".

import {
  db,
  guardianReviewsTable,
  testRunsTable,
  testRunStepsTable,
  modulesTable,
  sandboxesTable,
  sandboxFilesTable,
  type ModuleRow,
  type GuardianFindingData,
  type GuardianReviewRow,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { runGuardian } from "./guardian";
import { invokeGateway } from "./aiGateway";
import { audit } from "./audit";
import { logger } from "./logger";

const OUTCOME_RANK: Record<string, number> = { pass: 0, warning: 1, fail: 2 };
const VALID_OUTCOMES = ["pass", "warning", "fail"] as const;
type Outcome = (typeof VALID_OUTCOMES)[number];

const AI_CATEGORIES = [
  "architecture",
  "security",
  "duplication",
  "technical_debt",
  "maintainability",
  "regression_risk",
  "other",
];

function stricter(a: Outcome, b: Outcome): Outcome {
  return OUTCOME_RANK[a] >= OUTCOME_RANK[b] ? a : b;
}

interface AiVerdict {
  outcome: Outcome;
  summary: string;
  findings: GuardianFindingData[];
}

function parseAiVerdict(response: string): AiVerdict {
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return {
      outcome: "warning",
      summary: "AI review response could not be parsed as JSON; treated as warning (owner approval required).",
      findings: [
        {
          category: "review_quality",
          severity: "medium",
          message: "AI Guardian returned an unparseable response. Manual review recommended.",
        },
      ],
    };
  }
  try {
    const parsed = JSON.parse(response.slice(start, end + 1)) as {
      outcome?: string;
      summary?: string;
      findings?: { category?: string; severity?: string; message?: string }[];
    };
    const outcome: Outcome = VALID_OUTCOMES.includes(parsed.outcome as Outcome)
      ? (parsed.outcome as Outcome)
      : "warning";
    const findings: GuardianFindingData[] = Array.isArray(parsed.findings)
      ? parsed.findings
          .filter((f) => f && typeof f.message === "string" && f.message.length > 0)
          .slice(0, 30)
          .map((f) => ({
            category: AI_CATEGORIES.includes(f.category ?? "") ? (f.category as string) : "other",
            severity: ["low", "medium", "high", "critical"].includes(f.severity ?? "") ? (f.severity as string) : "medium",
            message: (f.message as string).slice(0, 500),
          }))
      : [];
    return {
      outcome,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
      findings,
    };
  } catch {
    return {
      outcome: "warning",
      summary: "AI review JSON was invalid; treated as warning (owner approval required).",
      findings: [
        {
          category: "review_quality",
          severity: "medium",
          message: "AI Guardian JSON verdict failed to parse. Manual review recommended.",
        },
      ],
    };
  }
}

async function buildReviewContext(module: ModuleRow): Promise<string> {
  const parts: string[] = [];
  parts.push(`MODULE: ${module.name} v${module.version} (type: ${module.type}, risk: ${module.riskLevel})`);
  parts.push(`PURPOSE: ${module.purpose ?? "-"}`);
  parts.push(`DEPENDENCIES: ${(module.dependencies ?? []).join(", ") || "none"}`);
  parts.push(`MANIFEST: ${module.manifest ?? "none"}`);

  const [latestTest] = await db
    .select()
    .from(testRunsTable)
    .where(eq(testRunsTable.moduleId, module.id))
    .orderBy(desc(testRunsTable.createdAt))
    .limit(1);
  if (latestTest) {
    parts.push(
      `LATEST TEST RUN: mode=${latestTest.mode}, status=${latestTest.status}, passed=${latestTest.passed}, failed=${latestTest.failed}, types=${(latestTest.types ?? []).join(",")}`,
    );
    const steps = await db
      .select()
      .from(testRunStepsTable)
      .where(eq(testRunStepsTable.testRunId, latestTest.id));
    for (const s of steps) {
      parts.push(
        `TEST STEP ${s.step}: ${s.status} (exit ${s.exitCode ?? "n/a"}, ${s.durationMs}ms)\n  stdout: ${s.stdout.slice(0, 1500)}\n  stderr: ${s.stderr.slice(0, 1500)}`,
      );
    }
  } else {
    parts.push("LATEST TEST RUN: none");
  }

  const [sandbox] = await db
    .select()
    .from(sandboxesTable)
    .where(eq(sandboxesTable.moduleId, module.id))
    .orderBy(desc(sandboxesTable.createdAt))
    .limit(1);
  if (sandbox) {
    const files = await db.select().from(sandboxFilesTable).where(eq(sandboxFilesTable.sandboxId, sandbox.id));
    parts.push(`SANDBOX FILES (${files.length}):`);
    for (const f of files.slice(0, 20)) {
      parts.push(`--- ${f.path} ---\n${f.content.slice(0, 4000)}`);
    }
  } else {
    parts.push("SANDBOX FILES: no sandbox linked");
  }
  return parts.join("\n\n");
}

const REVIEW_INSTRUCTIONS = `You are the AI Guardian Reviewer of Forge Core, an autonomous development platform.
Review the module below before installation. Assess:
- architecture risks (bad structure, wrong coupling, core boundary violations)
- security risks (injection, secrets handling, unsafe execution, dependency risks)
- duplication (re-implements existing Forge functionality)
- technical_debt (shortcuts, missing error handling, dead code)
- maintainability (readability, naming, documentation, testability)
- regression_risk (chance this change breaks existing behavior)

Respond with ONLY a JSON object, no prose, in exactly this shape:
{"outcome":"pass|warning|fail","summary":"<max 3 sentences>","findings":[{"category":"architecture|security|duplication|technical_debt|maintainability|regression_risk|other","severity":"low|medium|high|critical","message":"<specific finding>"}]}

Rules: outcome "fail" only for critical problems that must block installation. "warning" when the owner should review the findings first. "pass" only when there are no significant concerns.`;

export async function runAiGuardianReview(module: ModuleRow): Promise<GuardianReviewRow> {
  // 1. Rule-based Guardian always runs first (Locked Core behavior, unchanged).
  const rules = await runGuardian(module);

  // 2. AI review via the AI Gateway only — no direct provider calls here.
  const context = await buildReviewContext(module);
  const gatewayResult = await invokeGateway("securityreview", `${REVIEW_INSTRUCTIONS}\n\n${context}`, "");
  const ai = parseAiVerdict(gatewayResult.response);

  // 3. Combine: final outcome is the stricter of rules and AI.
  const finalOutcome = stricter(rules.outcome, ai.outcome);
  const combinedFindings: GuardianFindingData[] = [
    ...rules.findings.map((f) => ({ ...f, message: `[rules] ${f.message}` })),
    ...ai.findings.map((f) => ({ ...f, message: `[ai] ${f.message}` })),
  ];

  const insertedRows = (await db
    .insert(guardianReviewsTable)
    .values({
      moduleId: module.id,
      outcome: finalOutcome,
      findings: combinedFindings,
      reviewer: "ai",
      summary: ai.summary || null,
      model: `${gatewayResult.provider}/${gatewayResult.model}`,
    })
    .returning()) as unknown as GuardianReviewRow[];

  const row = insertedRows[0];
  if (!row) throw new Error("AI Guardian review insert returned no row");

  if (finalOutcome === "fail") {
    await db.update(modulesTable).set({ status: "guardian_failed" }).where(eq(modulesTable.id, module.id));
  }

  await audit({
    actor: "ai-guardian",
    action: "ai_guardian_review",
    targetType: "module",
    targetId: module.id,
    details: `Outcome: ${finalOutcome} (rules: ${rules.outcome}, ai: ${ai.outcome}, ${combinedFindings.length} findings, model: ${gatewayResult.provider}/${gatewayResult.model})`,
    outcome: finalOutcome === "fail" ? "blocked" : "allowed",
  });

  logger.info(
    { moduleId: module.id, finalOutcome, rulesOutcome: rules.outcome, aiOutcome: ai.outcome },
    "AI Guardian review finished",
  );
  return row;
}
