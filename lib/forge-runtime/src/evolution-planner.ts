import { randomUUID } from "node:crypto";
import type {
  CapabilityStatus,
  EvolutionPlanRecord,
  EvolutionPlanStep,
} from "./capability";
import type { CapabilityRegistry } from "./capability-registry";

function actionFor(
  actualStatus: CapabilityStatus | null,
): EvolutionPlanStep["action"] {
  if (
    actualStatus === null ||
    actualStatus === "unavailable"
  ) {
    return "implement";
  }

  if (actualStatus === "experimental") {
    return "validate";
  }

  return "promote";
}

function roiScore(
  gapCount: number,
  expectedReuse: number,
  missionCriticality: number,
): number {
  const benefit =
    expectedReuse * 12 +
    missionCriticality * 10;

  const effort = Math.max(1, gapCount) * 15;

  return Math.max(
    1,
    Math.min(100, Math.round(benefit - effort + 35)),
  );
}

export class EvolutionPlanner {
  readonly #registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry) {
    this.#registry = registry;
  }

  async createPlan(
    analysisId: string,
  ): Promise<EvolutionPlanRecord> {
    const analysis = this.#registry.getAnalysis(analysisId);

    if (analysis === null) {
      throw new Error(`Capability analysis not found: ${analysisId}`);
    }

    if (analysis.gaps.length === 0) {
      throw new Error(
        "Evolution plan is not required because the analysis has no gaps",
      );
    }

    const existing = this.#registry
      .listPlans()
      .find((plan) => plan.analysisId === analysisId);

    if (existing) {
      return existing;
    }

    const timestamp = new Date().toISOString();

    const steps = analysis.gaps.map(
      (gap, index): EvolutionPlanStep =>
        Object.freeze({
          order: index + 1,
          capabilityId: gap.capabilityId,
          action: actionFor(gap.actualStatus),
          fromStatus: gap.actualStatus,
          toStatus: gap.requiredStatus,
          acceptanceCriteria: Object.freeze([
            `Capability ${gap.capabilityId} is implemented in the Forge runtime.`,
            `Automated verification proves status ${gap.requiredStatus}.`,
            "Verification evidence is persisted and linked to the capability record.",
          ]),
        }),
    );

    const plan: EvolutionPlanRecord = Object.freeze({
      id: randomUUID(),
      analysisId: analysis.id,
      objective: analysis.objective,
      status: "proposed",
      roiScore: roiScore(
        analysis.gaps.length,
        analysis.expectedReuse,
        analysis.missionCriticality,
      ),
      steps: Object.freeze(steps),
      approvedAt: null,
      approvedBy: null,
      startedAt: null,
      completedAt: null,
      lastError: null,
      evidence: Object.freeze([]),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return this.#registry.recordPlan(plan);
  }
}