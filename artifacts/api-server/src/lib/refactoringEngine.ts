// Refactoring Engine: turns quality/debt findings into refactoring
// improvements in the backlog. Improvements flow through the normal
// improvement→task→proposal→governance pipeline; nothing is changed directly.

import { db, improvementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scanSourceFiles } from "./codeScan";
import { computeQualityFindings, type Finding } from "./qualityAnalyzer";
import { computeDebtFindings } from "./techDebtAnalyzer";
import { audit } from "./audit";

export interface RefactorPlanResult {
  created: number;
  skippedExisting: number;
  improvementIds: number[];
  summary: string;
}

export function findingToImprovement(f: Finding): { problem: string; cause: string; expectedImprovement: string; risk: string; priority: string } {
  return {
    problem: `[${f.code}] ${f.file ?? "workspace"}: ${f.message}`,
    cause: `Detected by static analysis (${f.code}).`,
    expectedImprovement: "Refactoring reduces maintenance cost and future defect risk.",
    risk: "low",
    priority: f.severity === "critical" ? "high" : "medium",
  };
}

export async function createRefactorPlan(): Promise<RefactorPlanResult> {
  const files = scanSourceFiles();
  const findings = [...computeQualityFindings(files), ...computeDebtFindings(files)].filter(
    (f) => f.severity !== "info",
  );

  const existing = await db.select({ problem: improvementsTable.problem }).from(improvementsTable);
  const existingProblems = new Set(existing.map((e) => e.problem));

  const improvementIds: number[] = [];
  let skippedExisting = 0;
  for (const f of findings) {
    const draft = findingToImprovement(f);
    if (existingProblems.has(draft.problem)) {
      skippedExisting += 1;
      continue;
    }
    const [row] = await db
      .insert(improvementsTable)
      .values({ ...draft, status: "open", source: "refactoring-engine" })
      .returning({ id: improvementsTable.id });
    improvementIds.push(row.id);
    existingProblems.add(draft.problem);
  }

  const summary = `${findings.length} actionable finding(s); ${improvementIds.length} improvement(s) created, ${skippedExisting} already known.`;
  await audit({
    actor: "refactoring-engine",
    action: "refactor_plan_created",
    targetType: "improvement",
    details: summary,
  });
  return { created: improvementIds.length, skippedExisting, improvementIds, summary };
}

export async function openRefactoringImprovements(): Promise<number> {
  const rows = await db
    .select({ id: improvementsTable.id })
    .from(improvementsTable)
    .where(eq(improvementsTable.source, "refactoring-engine"));
  return rows.length;
}
