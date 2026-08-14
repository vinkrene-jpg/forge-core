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

  if (request.kind === "operator.goal-build") {
    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      action: "mission.execute",
      missionKind: request.kind,
      riskLevel: "high",
      decision: "require_approval",
      reason:
        "A bounded GoalSpec mandate authorizes multiple local workspace missions and requires one explicit operator approval.",
      assessedAt,
    });
  }

  if (request.kind === "operator.workspace-change") {
    const commit = request.input?.commit;
    const pushes =
      typeof commit === "object" &&
      commit !== null &&
      !Array.isArray(commit) &&
      (commit as Readonly<Record<string, unknown>>).push === true;

    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      action: "mission.execute",
      missionKind: request.kind,
      riskLevel: pushes ? "critical" : "high",
      decision: "require_approval",
      reason: pushes
        ? "A verified workspace change with external Git push requires explicit operator approval."
        : "A local source mutation and optional commit require explicit operator approval.",
      assessedAt,
    });
  }

  if (request.kind === "operator.workspace-plan") {
    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      action: "mission.execute",
      missionKind: request.kind,
      riskLevel: "medium",
      decision: "require_approval",
      reason:
        "Creating a provider-backed source change plan consumes external resources and requires explicit approval; it cannot mutate the workspace.",
      assessedAt,
    });
  }

  if (request.kind === "operator.mirror-intake") {
    return Object.freeze({
      policyVersion: GOVERNANCE_POLICY_VERSION,
      action: "mission.execute",
      missionKind: request.kind,
      riskLevel: "low",
      decision: "allow",
      reason: "Recording an inert local operator mission intake does not grant execution authority.",
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
