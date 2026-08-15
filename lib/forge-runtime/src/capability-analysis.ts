import { randomUUID } from "node:crypto";
import type {
  CapabilityAnalysisRecord,
  CapabilityAnalysisRequest,
  CapabilityGap,
  CapabilityRequirement,
  CapabilityStatus,
} from "./capability";
import type { CapabilityRegistry } from "./capability-registry";
import type {
  CreateMissionRequest,
  MissionKind,
} from "./mission";

const statusRank: Readonly<Record<CapabilityStatus, number>> = {
  unavailable: 0,
  experimental: 1,
  validated: 2,
  operational: 3,
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    throw new Error("Scoring values must be integers from 1 to 5");
  }

  return value;
}

function requiredText(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

export function requirementsForMission(
  kind: MissionKind,
): readonly CapabilityRequirement[] {
  if (kind === "operator.mirror-intake") {
    return Object.freeze([{
      capabilityId: "governance.risk.assess",
      minimumStatus: "operational",
      reason: "Mission intake must pass deterministic governance assessment without execution.",
    }]);
  }

  const shared: CapabilityRequirement[] = [
    {
      capabilityId: "mission.loop.execute",
      minimumStatus: "operational",
      reason: "Mission must be executable by the live MissionLoop.",
    },
    {
      capabilityId: "governance.risk.assess",
      minimumStatus: "operational",
      reason: "Mission must pass deterministic governance assessment.",
    },
  ];

  if (kind === "runtime.self-check") {
    return Object.freeze([
      ...shared,
      {
        capabilityId: "runtime.health.inspect",
        minimumStatus: "operational",
        reason: "Mission inspects live runtime health.",
      },
    ]);
  }

  if (kind === "operator.autonomous-cycle") {
    return Object.freeze([
      ...shared,
      {
        capabilityId: "project.memory.persist",
        minimumStatus: "operational",
        reason: "Cycle grounds work in persistent project memory.",
      },
      {
        capabilityId: "prompt.context.compose",
        minimumStatus: "operational",
        reason: "Cycle requires a grounded prompt composition.",
      },
      {
        capabilityId: "model.route.select",
        minimumStatus: "operational",
        reason: "Cycle records an explicit model routing decision.",
      },
      {
        capabilityId: "ai.provider.execute",
        minimumStatus: "operational",
        reason: "Cycle executes through the controlled provider gateway.",
      },
      {
        capabilityId: "evaluation.output.assess",
        minimumStatus: "operational",
        reason: "Provider output must be evaluated before acceptance.",
      },
      {
        capabilityId: "mission.autonomous.continue",
        minimumStatus: "operational",
        reason: "Accepted output schedules a bounded next mission.",
      },
      {
        capabilityId: "learning.evidence.assess",
        minimumStatus: "operational",
        reason: "Accepted output must update the evidence-backed learning profile.",
      },
    ]);
  }

  if (kind === "operator.workspace-change") {
    return Object.freeze([
      ...shared,
      {
        capabilityId: "tool.workspace.write",
        minimumStatus: "operational",
        reason: "Mission applies preconditioned changes inside the approved workspace.",
      },
      {
        capabilityId: "tool.workspace.verify",
        minimumStatus: "operational",
        reason: "Every change must pass fixed typecheck, test or build verification.",
      },
      {
        capabilityId: "tool.workspace.rollback",
        minimumStatus: "operational",
        reason: "Failed verification must restore the exact pre-mission workspace.",
      },
    ]);
  }

  if (kind === "operator.goal-build" || kind === "operator.goal-run") {
    return Object.freeze([
      ...shared,
      {
        capabilityId: "tool.workspace.write",
        minimumStatus: "operational",
        reason: "Goal components apply preconditioned changes inside one approved workspace.",
      },
      {
        capabilityId: "tool.workspace.verify",
        minimumStatus: "operational",
        reason: "Every goal component must pass fixed typecheck, test and build verification.",
      },
      {
        capabilityId: "tool.workspace.rollback",
        minimumStatus: "operational",
        reason: "Incomplete component work must roll back when a mandate or verification boundary fails.",
      },
    ]);
  }

  if (kind === "operator.workspace-plan") {
    return Object.freeze([
      ...shared,
      {
        capabilityId: "tool.workspace.inspect",
        minimumStatus: "operational",
        reason: "Planner binds provider output to current source evidence.",
      },
      {
        capabilityId: "prompt.context.compose",
        minimumStatus: "operational",
        reason: "Planner requires a grounded prompt composition.",
      },
      {
        capabilityId: "ai.provider.execute",
        minimumStatus: "operational",
        reason: "Planner uses one controlled provider execution.",
      },
      {
        capabilityId: "workspace.plan.validate",
        minimumStatus: "operational",
        reason: "Provider output must pass strict schema and source-hash validation.",
      },
    ]);
  }

  return Object.freeze([
    ...shared,
    {
      capabilityId: "runtime.stability.observe",
      minimumStatus: "operational",
      reason: "Mission observes runtime stability over time.",
    },
  ]);
}

export class CapabilityAnalyzer {
  readonly #registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry) {
    this.#registry = registry;
  }

  analyzeMission(
    request: CreateMissionRequest,
  ): Promise<CapabilityAnalysisRecord> {
    return this.#analyze(
      {
        objective:
          `Execute mission "${request.title?.trim() || request.kind}"`,
        requirements: requirementsForMission(request.kind),
        expectedReuse: 5,
      missionCriticality:
          request.kind === "runtime.self-check"
            ? 2
            : request.kind === "operator.autonomous-cycle" ||
              request.kind === "operator.goal-build" ||
              request.kind === "operator.goal-run" ||
                request.kind === "operator.workspace-change" ||
                request.kind === "operator.workspace-plan"
              ? 4
              : 3,
      },
      "mission",
      request.kind,
    );
  }

  analyzeManual(
    request: CapabilityAnalysisRequest,
  ): Promise<CapabilityAnalysisRecord> {
    return this.#analyze(
      request,
      "manual",
      null,
    );
  }

  async #analyze(
    request: CapabilityAnalysisRequest,
    sourceType: "mission" | "manual",
    sourceMissionKind: MissionKind | null,
  ): Promise<CapabilityAnalysisRecord> {
    const objective = requiredText(
      request.objective,
      "objective",
    );

    if (
      !Array.isArray(request.requirements) ||
      request.requirements.length === 0
    ) {
      throw new Error("At least one capability requirement is required");
    }

    const requirements = request.requirements.map(
      (requirement) =>
        Object.freeze({
          capabilityId: requiredText(
            requirement.capabilityId,
            "capabilityId",
          ),
          minimumStatus: requirement.minimumStatus,
          reason: requiredText(requirement.reason, "reason"),
        }),
    );

    const gaps: CapabilityGap[] = [];

    for (const requirement of requirements) {
      const capability = this.#registry.getCapability(
        requirement.capabilityId,
      );

      if (
        capability === null ||
        statusRank[capability.status] <
          statusRank[requirement.minimumStatus as CapabilityStatus]
      ) {
        gaps.push(
          Object.freeze({
            capabilityId: requirement.capabilityId,
            requiredStatus: requirement.minimumStatus,
            actualStatus: capability?.status ?? null,
            reason: requirement.reason,
          }),
        );
      }
    }

    const analysis: CapabilityAnalysisRecord = Object.freeze({
      id: randomUUID(),
      objective,
      sourceType,
      sourceMissionKind,
      requirements: Object.freeze(requirements),
      gaps: Object.freeze(gaps),
      decision:
        gaps.length === 0
          ? "execute_directly"
          : "improve_then_execute",
      expectedReuse: boundedInteger(
        request.expectedReuse,
        3,
      ),
      missionCriticality: boundedInteger(
        request.missionCriticality,
        3,
      ),
      createdAt: new Date().toISOString(),
    });

    return this.#registry.recordAnalysis(analysis);
  }
}
