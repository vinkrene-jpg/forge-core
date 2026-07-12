import type {
  MissionKind,
  CreateMissionRequest,
} from "./mission";

export const GOVERNANCE_POLICY_VERSION = "1.0.0" as const;

export type GovernanceRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type GovernanceDecision =
  | "allow"
  | "require_approval"
  | "deny";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

export interface GovernanceAssessment {
  readonly policyVersion: typeof GOVERNANCE_POLICY_VERSION;
  readonly action: "mission.execute";
  readonly missionKind: MissionKind;
  readonly riskLevel: GovernanceRiskLevel;
  readonly decision: GovernanceDecision;
  readonly reason: string;
  readonly assessedAt: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly missionId: string;
  readonly status: ApprovalStatus;
  readonly assessment: GovernanceAssessment;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly note: string | null;
}

export interface GovernanceSummary {
  readonly policyVersion: typeof GOVERNANCE_POLICY_VERSION;
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
}

export interface MissionCreationResult {
  readonly mission: import("./mission").MissionRecord;
  readonly assessment: GovernanceAssessment;
  readonly approval: ApprovalRecord | null;
}

export interface ApprovalDecisionResult {
  readonly approval: ApprovalRecord;
  readonly mission: import("./mission").MissionRecord;
}

export function assessMissionRequest(
  request: CreateMissionRequest,
): GovernanceAssessment {
  const assessedAt = new Date().toISOString();

  if (request.kind === "runtime.self-check") {
    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      action: "mission.execute",
      missionKind: request.kind,
      riskLevel: "low",
      decision: "allow",
      reason:
        "Read-only runtime health inspection within the local Forge workspace.",
      assessedAt,
    });
  }

  if (request.kind === "operator.autonomous-cycle") {
    const cycleIndex = request.input?.cycleIndex;
    const maxCycles = request.input?.maxCycles;
    const continuationAuthorized =
      request.input?.continuationAuthorized === true;
    const boundedContinuation =
      continuationAuthorized &&
      typeof cycleIndex === "number" &&
      typeof maxCycles === "number" &&
      Number.isInteger(cycleIndex) &&
      Number.isInteger(maxCycles) &&
      cycleIndex > 1 &&
      cycleIndex <= maxCycles &&
      maxCycles <= 5;

    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      action: "mission.execute",
      missionKind: request.kind,
      riskLevel: boundedContinuation ? "low" : "medium",
      decision: boundedContinuation ? "allow" : "require_approval",
      reason: boundedContinuation
        ? "Bounded continuation of an explicitly approved autonomous provider loop."
        : "Starting an external provider-backed autonomous loop requires explicit operator approval.",
      assessedAt,
    });
  }

  const durationValue = request.input?.durationMs;
  const durationMs =
    typeof durationValue === "number"
      ? durationValue
      : 10_000;

  const riskLevel: GovernanceRiskLevel =
    durationMs >= 60_000 ? "high" : "medium";

  return Object.freeze({
    policyVersion: GOVERNANCE_POLICY_VERSION,
    action: "mission.execute",
    missionKind: request.kind,
    riskLevel,
    decision: "require_approval",
    reason:
      riskLevel === "high"
        ? "Long-running operational mission requires explicit human approval."
        : "Operational stability mission consumes runtime resources and requires explicit approval.",
    assessedAt,
  });
}
