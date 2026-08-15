import { createHash } from "node:crypto";
import type {
  CapabilityAnalysisRecord,
  CapabilityRecord,
} from "./capability";
import type { GoalSpec } from "./goal-build-graph";
import type { MissionRecord } from "./mission";

export interface CapabilityGapCandidate {
  readonly id: string;
  readonly capabilityId: string;
  readonly capabilityName: string;
  readonly cause: string;
  readonly occurrences: number;
  readonly missionIds: readonly string[];
  readonly latestAt: string;
  readonly proposedGoalSpec: GoalSpec;
  readonly releasedGoalSpecMissionId: string | null;
}

type OutcomeType = NonNullable<CapabilityAnalysisRecord["outcomeType"]>;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function boundedMessage(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 500);
}

function canonicalFailureCause(mission: MissionRecord): string {
  const result = record(mission.output?.missionResult);
  const text = [result?.cause, result?.message, mission.lastError]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (text.includes("verification failed") || text.includes("test failed")) {
    return "workspace-verification-failed";
  }
  if (
    text.includes("workspace plan") ||
    text.includes("provider plan") ||
    text.includes("provider-output-contract") ||
    text.includes("schema")
  ) {
    return "workspace-plan-validation-failed";
  }
  if (text.includes("provider") || text.includes("model route")) {
    return "provider-execution-failed";
  }
  if (result?.status === "rejected" || result?.cause === "evaluation") {
    return "evaluation-rejected";
  }
  return boundedMessage(result?.cause, `${mission.kind}-failed`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || `${mission.kind}-failed`;
}

function missionFailureCapability(mission: MissionRecord, cause: string): string {
  if (cause === "workspace-verification-failed") return "tool.workspace.verify";
  if (cause === "provider-execution-failed") return "ai.provider.execute";
  if (cause === "workspace-plan-validation-failed") return "workspace.plan.validate";
  if (cause === "evaluation-rejected") return "evaluation.output.assess";
  return "mission.loop.execute";
}

function analysisId(
  missionId: string,
  outcomeType: OutcomeType,
  capabilityId: string,
  cause: string,
): string {
  const digest = createHash("sha256")
    .update(`${missionId}\0${outcomeType}\0${capabilityId}\0${cause}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `outcome-gap-${digest}`;
}

function outcomeAnalysis(
  mission: MissionRecord,
  capabilities: ReadonlyMap<string, CapabilityRecord>,
  outcomeType: OutcomeType,
  capabilityId: string,
  cause: string,
  reason: string,
): CapabilityAnalysisRecord | null {
  const capability = capabilities.get(capabilityId);
  if (!capability) return null;
  const createdAt = mission.completedAt ?? mission.updatedAt;

  return Object.freeze({
    id: analysisId(mission.id, outcomeType, capabilityId, cause),
    objective: `Prevent repeated ${cause} in ${mission.kind}`,
    sourceType: "mission",
    sourceMissionKind: mission.kind,
    sourceMissionId: mission.id,
    outcomeType,
    outcomeCause: cause,
    requirements: Object.freeze([Object.freeze({
      capabilityId,
      minimumStatus: "operational",
      reason,
    })]),
    gaps: Object.freeze([Object.freeze({
      capabilityId,
      requiredStatus: "operational",
      actualStatus: capability.status,
      reason,
    })]),
    decision: "improve_then_execute",
    expectedReuse: 5,
    missionCriticality: 4,
    createdAt,
  });
}

function evaluationDetails(mission: MissionRecord): {
  readonly rejected: boolean;
  readonly cause: string;
  readonly reason: string;
} {
  const direct = record(mission.output?.evaluation);
  const execution = record(mission.output?.executionEvidence);
  const evaluation = direct ?? record(execution?.evaluation);
  const result = record(mission.output?.missionResult);
  const rejected = evaluation?.decision === "rejected" || result?.status === "rejected";
  const checks = Array.isArray(evaluation?.checks) ? evaluation.checks : [];
  const failedChecks = checks.flatMap((value) => {
    const check = record(value);
    return check?.passed === false && typeof check.id === "string" ? [check.id] : [];
  }).sort();
  const cause = failedChecks.length > 0
    ? `evaluation-rejected:${failedChecks.join(",")}`
    : "evaluation-rejected";
  return {
    rejected,
    cause,
    reason: boundedMessage(result?.message, cause),
  };
}

export function deriveCapabilityOutcomeGaps(
  mission: MissionRecord,
  capabilityRecords: readonly CapabilityRecord[],
): readonly CapabilityAnalysisRecord[] {
  const capabilities = new Map(capabilityRecords.map((item) => [item.id, item]));
  const analyses: CapabilityAnalysisRecord[] = [];
  const result = record(mission.output?.missionResult);

  if (mission.status === "failed") {
    const cause = canonicalFailureCause(mission);
    const analysis = outcomeAnalysis(
      mission,
      capabilities,
      "mission_failure",
      missionFailureCapability(mission, cause),
      cause,
      boundedMessage(result?.message ?? mission.lastError, cause),
    );
    if (analysis) analyses.push(analysis);
  }

  const evaluation = evaluationDetails(mission);
  if (evaluation.rejected) {
    const analysis = outcomeAnalysis(
      mission,
      capabilities,
      "evaluation_rejection",
      "evaluation.output.assess",
      evaluation.cause,
      evaluation.reason,
    );
    if (analysis) analyses.push(analysis);
  }

  const mandateBoundary = record(mission.output?.mandateBoundary);
  const mandateCause = typeof result?.cause === "string" && result.cause.startsWith("goal-mandate.")
    ? result.cause
    : typeof mandateBoundary?.boundary === "string"
      ? `goal-mandate.${mandateBoundary.boundary}`
      : null;
  if (mandateCause) {
    const analysis = outcomeAnalysis(
      mission,
      capabilities,
      "mandate_boundary",
      "governance.risk.assess",
      mandateCause,
      boundedMessage(result?.message, mandateCause),
    );
    if (analysis) analyses.push(analysis);
  }

  return Object.freeze(analyses);
}

function candidateId(capabilityId: string, cause: string): string {
  return `gap-${createHash("sha256")
    .update(`${capabilityId}\0${cause}`, "utf8")
    .digest("hex")
    .slice(0, 20)}`;
}

export function rankCapabilityGapCandidates(
  analyses: readonly CapabilityAnalysisRecord[],
  missions: readonly MissionRecord[],
  capabilities: readonly CapabilityRecord[],
): readonly CapabilityGapCandidate[] {
  const capabilityById = new Map(capabilities.map((item) => [item.id, item]));
  const releasedByCandidate = new Map<string, string>();
  const resolvedCandidates = new Set<string>();
  for (const mission of missions) {
    const candidate = mission.input.capabilityGapCandidateId;
    if (mission.kind === "operator.goal-build" && typeof candidate === "string") {
      releasedByCandidate.set(candidate, mission.id);
    }
    const evaluation = record(mission.output?.evaluation);
    if (
      mission.kind === "operator.workspace-change" &&
      mission.status === "succeeded" &&
      evaluation?.decision === "accepted" &&
      typeof candidate === "string"
    ) {
      resolvedCandidates.add(candidate);
    }
  }
  const grouped = new Map<string, CapabilityAnalysisRecord[]>();
  for (const analysis of analyses) {
    if (!analysis.outcomeType || !analysis.outcomeCause || !analysis.sourceMissionId) continue;
    const gap = analysis.gaps[0];
    if (!gap || !capabilityById.has(gap.capabilityId)) continue;
    const key = `${gap.capabilityId}\0${analysis.outcomeCause}`;
    grouped.set(key, [...(grouped.get(key) ?? []), analysis]);
  }

  const candidates = [...grouped.values()].map((items) => {
    const first = items[0];
    const gap = first.gaps[0];
    const capability = capabilityById.get(gap.capabilityId)!;
    const cause = first.outcomeCause!;
    const id = candidateId(capability.id, cause);
    const missionIds = [...new Set(items.map((item) => item.sourceMissionId!))].sort();
    const latestAt = items.map((item) => item.createdAt).sort().at(-1)!;
    const recentMissionIds = missionIds.slice(-5);
    const proposedGoalSpec: GoalSpec = Object.freeze({
      objective: `Strengthen ${capability.name} against ${cause}`,
      desiredBehavior: Object.freeze([
        `Forge handles ${cause} without repeating the observed capability failure.`,
      ]),
      constraints: Object.freeze([
        "Use the existing capability registry and missionstore as authoritative state.",
        "Do not widen allowed mutation roots, immutable paths, graph limits or push authority.",
      ]),
      acceptanceCriteria: Object.freeze([Object.freeze({
        id: "gap-no-repeat",
        statement: `A regression proves ${cause} is handled for capability ${capability.id}.`,
        evidence: `${items.length} linked capability analyses; recent missions: ${recentMissionIds.join(", ")}.`,
      })]),
    });
    return Object.freeze({
      id,
      capabilityId: capability.id,
      capabilityName: capability.name,
      cause,
      occurrences: items.length,
      missionIds: Object.freeze(missionIds),
      latestAt,
      proposedGoalSpec,
      releasedGoalSpecMissionId: releasedByCandidate.get(id) ?? null,
    });
  }).filter((candidate) => !resolvedCandidates.has(candidate.id));

  return Object.freeze(candidates.sort((left, right) =>
    right.occurrences - left.occurrences ||
    right.latestAt.localeCompare(left.latestAt) ||
    left.id.localeCompare(right.id)
  ));
}