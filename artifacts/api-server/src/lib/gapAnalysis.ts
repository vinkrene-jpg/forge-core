// Gap Analysis: determine which capabilities are missing or partial, why,
// what blocks further evolution and which gap yields the most progress.

import { db, capabilitiesTable, type CapabilityRow } from "@workspace/db";

export interface Gap {
  capabilityKey: string;
  name: string;
  status: string;
  maturity: number;
  impactScore: number;
  reason: string;
  blocking: string[];
  risks: string[];
  missingParts: string[];
}

export interface GapAnalysisResult {
  analyzedAt: string;
  gaps: Gap[];
}

const RISKS_BY_KEY: Record<string, string[]> = {
  proposal_generation: ["Generated code may be low quality; mitigated by mandatory tests, Guardian and Governor."],
  evolution_loop: ["A defective loop could create noise (tasks/proposals); mitigated by owner approval and audit."],
  autonomous_planning: ["A bad plan wastes one iteration; no code is installed without governance."],
  governance: ["Overly permissive decisions could install weak modules; rollback snapshots limit the damage."],
};

export function computeGaps(capabilities: CapabilityRow[]): Gap[] {
  const byKey = new Map(capabilities.map((c) => [c.key, c]));
  const gaps: Gap[] = [];

  for (const cap of capabilities) {
    if (cap.status === "working") continue;

    // How many other capabilities depend on this one (directly)?
    const dependents = capabilities.filter((c) => c.dependencies.includes(cap.key)).map((c) => c.key);
    // Are its own dependencies satisfied? Unsatisfied deps lower the score:
    // fixing this gap first would be premature.
    const unmetDeps = cap.dependencies.filter((d) => byKey.get(d)?.status !== "working");

    const statusWeight = cap.status === "missing" ? 40 : 20;
    const impactScore = Math.max(
      0,
      statusWeight + dependents.length * 15 - unmetDeps.length * 25 + Math.round((100 - cap.maturity) / 10),
    );

    const reasonParts: string[] = [];
    if (cap.missingParts.length > 0) reasonParts.push(`missing: ${cap.missingParts.join("; ")}`);
    if (unmetDeps.length > 0) reasonParts.push(`blocked by unmet dependencies: ${unmetDeps.join(", ")}`);
    if (dependents.length > 0) reasonParts.push(`unblocks: ${dependents.join(", ")}`);

    gaps.push({
      capabilityKey: cap.key,
      name: cap.name,
      status: cap.status,
      maturity: cap.maturity,
      impactScore,
      reason: reasonParts.join(" | ") || "Capability not yet demonstrated with evidence.",
      blocking: dependents,
      risks: RISKS_BY_KEY[cap.key] ?? ["Low: sandbox-only development, governance pipeline stays mandatory."],
      missingParts: cap.missingParts,
    });
  }

  gaps.sort((a, b) => b.impactScore - a.impactScore);
  return gaps;
}

export async function analyzeGaps(): Promise<GapAnalysisResult> {
  const capabilities = await db.select().from(capabilitiesTable);
  return { analyzedAt: new Date().toISOString(), gaps: computeGaps(capabilities) };
}
