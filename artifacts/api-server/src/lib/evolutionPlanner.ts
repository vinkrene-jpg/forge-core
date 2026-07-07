// Autonomous Planner: decide the next development step for the highest-impact
// gap. AI-assisted via the AI Gateway (task type "planning") when configured,
// with a deterministic rule-based fallback so planning never depends on an AI
// key. Creates a backlog task linked to the plan so the Proposal Generator can
// pick it up.

import {
  db,
  capabilitiesTable,
  evolutionPlansTable,
  tasksTable,
  type EvolutionPlanRow,
  type CapabilityRow,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { invokeGateway, GatewayError } from "./aiGateway";
import { analyzeGaps, type Gap } from "./gapAnalysis";
import { audit } from "./audit";

export class NoGapError extends Error {}

interface PlanDraft {
  design: string;
  steps: string[];
  affectedFiles: string[];
  risk: string;
  priority: string;
  testStrategy: string;
  rollbackStrategy: string;
  source: "ai" | "fallback";
}

export function buildFallbackPlan(gap: Gap): PlanDraft {
  const moduleFile = `modules/${gap.capabilityKey.replace(/_/g, "-")}/index.js`;
  return {
    design: `Close the '${gap.name}' gap (${gap.status}, maturity ${gap.maturity}) by building a small, self-contained sandbox module that demonstrates the capability end-to-end. Reason: ${gap.reason}`,
    steps: [
      `Generate a proposal for a minimal '${gap.capabilityKey}' helper module (sandbox only).`,
      "Include a package.json with a test script and at least one unit test file.",
      "Run the real test runner (lint, typecheck, unit) against the sandbox.",
      "Let Guardian review the draft module and Governor decide on installability.",
      "Request owner approval when the decision is not low-risk-all-green.",
      "Store lessons from the outcome in the Memory Engine.",
    ],
    affectedFiles: [moduleFile, `modules/${gap.capabilityKey.replace(/_/g, "-")}/index.test.js`, "package.json"],
    risk: gap.status === "missing" ? "medium" : "low",
    priority: gap.impactScore >= 50 ? "high" : "medium",
    testStrategy: "Mandatory unit tests via `node --test --test-isolation=none`, plus lint and typecheck through the real test runner. Failed or missing tests block installation.",
    rollbackStrategy: "No direct installs: the sandbox can be discarded at any time. If installed later via governance, the pre-install module snapshot enables rollback.",
    source: "fallback",
  };
}

function parseAiPlan(response: string): Omit<PlanDraft, "source"> | null {
  try {
    const cleaned = response.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    const design = typeof parsed.design === "string" ? parsed.design : null;
    const steps = strArr(parsed.steps);
    if (!design || steps.length === 0) return null;
    return {
      design: design.slice(0, 4000),
      steps,
      affectedFiles: strArr(parsed.affectedFiles),
      risk: typeof parsed.risk === "string" && ["low", "medium", "high"].includes(parsed.risk) ? parsed.risk : "medium",
      priority:
        typeof parsed.priority === "string" && ["low", "medium", "high", "critical"].includes(parsed.priority)
          ? parsed.priority
          : "medium",
      testStrategy: typeof parsed.testStrategy === "string" ? parsed.testStrategy.slice(0, 2000) : "Unit tests mandatory via the real test runner.",
      rollbackStrategy:
        typeof parsed.rollbackStrategy === "string" ? parsed.rollbackStrategy.slice(0, 2000) : "Sandbox-only; discard sandbox or restore pre-install snapshot.",
    };
  } catch {
    return null;
  }
}

export async function createEvolutionPlan(input: { capabilityKey?: string } = {}): Promise<EvolutionPlanRow> {
  const analysis = await analyzeGaps();
  let gap: Gap | undefined;
  if (input.capabilityKey) {
    gap = analysis.gaps.find((g) => g.capabilityKey === input.capabilityKey);
    if (!gap) {
      const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.key, input.capabilityKey));
      if (!cap) throw new NoGapError(`Unknown capability key: ${input.capabilityKey}`);
      throw new NoGapError(`Capability '${input.capabilityKey}' has no open gap (status: ${cap.status}).`);
    }
  } else {
    gap = analysis.gaps[0];
    if (!gap) throw new NoGapError("No open gaps: all capabilities are working. Nothing to plan.");
  }

  let draft: PlanDraft;
  try {
    const prompt = [
      "You are the autonomous planner of Forge Core. Plan the next SMALL development step to close a capability gap.",
      "All work happens in a sandbox; nothing is installed without tests, Guardian review, Governor decision and (if needed) owner approval.",
      'Answer with ONLY a JSON object: {"design": string, "steps": string[], "affectedFiles": string[] (relative sandbox paths only), "risk": "low"|"medium"|"high", "priority": "low"|"medium"|"high"|"critical", "testStrategy": string, "rollbackStrategy": string}.',
      "Test scripts must use `node --test --test-isolation=none`.",
      "",
      `GAP: ${gap.name} (${gap.capabilityKey}) — status ${gap.status}, maturity ${gap.maturity}.`,
      `REASON: ${gap.reason}`,
      `MISSING PARTS: ${gap.missingParts.join("; ") || "none listed"}`,
      `RISKS: ${gap.risks.join("; ")}`,
    ].join("\n");
    const gateway = await invokeGateway("planning", prompt);
    const parsed = parseAiPlan(gateway.response);
    draft = parsed ? { ...parsed, source: "ai" } : buildFallbackPlan(gap);
  } catch (err) {
    if (!(err instanceof GatewayError)) throw err;
    draft = buildFallbackPlan(gap);
  }

  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `Evolution: close capability gap '${gap.name}'`,
      goal: draft.design.slice(0, 2000),
      risk: draft.risk,
      ownerAgent: "evolution-planner",
      status: "planned",
      acceptanceCriteria: draft.testStrategy.slice(0, 1000),
      source: `evolution-gap:${gap.capabilityKey}`,
    })
    .returning();

  const [plan] = await db
    .insert(evolutionPlansTable)
    .values({
      capabilityKey: gap.capabilityKey,
      gapSummary: gap.reason.slice(0, 2000),
      design: draft.design,
      steps: draft.steps,
      affectedFiles: draft.affectedFiles,
      risk: draft.risk,
      priority: draft.priority,
      testStrategy: draft.testStrategy,
      rollbackStrategy: draft.rollbackStrategy,
      source: draft.source,
      status: "planned",
      taskId: task.id,
    })
    .returning();

  await audit({
    actor: "evolution-planner",
    action: "evolution_plan_created",
    targetType: "evolution-plan",
    targetId: plan.id,
    details: `Plan for gap '${gap.capabilityKey}' (source: ${draft.source}, risk: ${draft.risk}, priority: ${draft.priority}); task #${task.id} created`,
  });

  return plan;
}
