// Roadmap Generator: composes a ranked evolution roadmap from capability
// gaps, planned backlog tasks, open improvements and critical debt findings.

import { db, tasksTable, improvementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { analyzeGaps } from "./gapAnalysis";
import { scanSourceFiles } from "./codeScan";
import { computeDebtFindings } from "./techDebtAnalyzer";
import { audit } from "./audit";

export interface RoadmapItem {
  rank: number;
  kind: "capability_gap" | "backlog_task" | "improvement" | "debt" | "maintenance";
  refId: number | null;
  title: string;
  priority: "low" | "medium" | "high" | "critical";
  rationale: string;
}

export interface Roadmap {
  generatedAt: string;
  summary: string;
  items: RoadmapItem[];
}

export async function generateRoadmap(): Promise<Roadmap> {
  const items: Omit<RoadmapItem, "rank">[] = [];

  // 1. Capability gaps: always first — they block autonomy.
  const analysis = await analyzeGaps();
  for (const gap of analysis.gaps) {
    items.push({
      kind: "capability_gap",
      refId: null,
      title: `Close capability gap: ${gap.name} (${gap.capabilityKey})`,
      priority: gap.impactScore >= 50 ? "critical" : "high",
      rationale: gap.reason,
    });
  }

  // 2. Planned backlog tasks.
  const planned = await db.select().from(tasksTable).where(eq(tasksTable.status, "planned")).orderBy(tasksTable.createdAt);
  for (const t of planned) {
    items.push({
      kind: "backlog_task",
      refId: t.id,
      title: t.title,
      priority: (t.risk === "high" ? "high" : t.risk === "critical" ? "critical" : "medium") as RoadmapItem["priority"],
      rationale: t.goal ?? "Planned backlog task.",
    });
  }

  // 3. Open improvements.
  const improvements = await db.select().from(improvementsTable).where(eq(improvementsTable.status, "open"));
  for (const imp of improvements) {
    items.push({
      kind: "improvement",
      refId: imp.id,
      title: imp.problem.length > 120 ? `${imp.problem.slice(0, 117)}...` : imp.problem,
      priority: (["low", "medium", "high", "critical"].includes(imp.priority) ? imp.priority : "medium") as RoadmapItem["priority"],
      rationale: imp.expectedImprovement ?? "Open improvement from the backlog.",
    });
  }

  // 4. Critical debt findings not yet captured as improvements.
  const debt = computeDebtFindings(scanSourceFiles()).filter((f) => f.severity === "critical");
  for (const f of debt) {
    items.push({
      kind: "debt",
      refId: null,
      title: `[${f.code}] ${f.file ?? "workspace"}`,
      priority: "high",
      rationale: f.message,
    });
  }

  if (items.length === 0) {
    items.push({
      kind: "maintenance",
      refId: null,
      title: "Monitor, refine capability maturity and keep dependencies current",
      priority: "low",
      rationale: "No gaps, backlog, improvements or critical debt: steady-state maintenance.",
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const kindOrder = { capability_gap: 0, backlog_task: 1, improvement: 2, debt: 3, maintenance: 4 };
  items.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || order[a.priority] - order[b.priority]);

  const roadmap: Roadmap = {
    generatedAt: new Date().toISOString(),
    summary: `${items.length} roadmap item(s): ${analysis.gaps.length} gap(s), ${planned.length} planned task(s), ${improvements.length} open improvement(s), ${debt.length} critical debt finding(s).`,
    items: items.map((it, i) => ({ rank: i + 1, ...it })),
  };
  await audit({
    actor: "roadmap-generator",
    action: "roadmap_generated",
    targetType: "roadmap",
    details: roadmap.summary,
  });
  return roadmap;
}
