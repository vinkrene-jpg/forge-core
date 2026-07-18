import type { MissionKind } from "./mission";

export type LearningOutcome = "passed" | "failed";

export interface LearningEvidenceReference {
  readonly type:
    | "mission"
    | "execution"
    | "evaluation"
    | "project-memory"
    | "capability";
  readonly id: string;
}

export interface LearningSignal {
  readonly capabilityId: string;
  readonly score: number;
  readonly outcome: LearningOutcome;
  readonly rationale: string;
}

export interface LearningObservation {
  readonly id: string;
  readonly missionId: string;
  readonly missionKind: MissionKind;
  readonly executionId: string;
  readonly evaluationId: string;
  readonly evidenceMemoryId: string;
  readonly sourceProposalId: string | null;
  readonly targetCapabilityId: string | null;
  readonly capabilityResult: "pass" | "gap" | null;
  readonly toolEvidenceMemoryId: string | null;
  readonly evaluationScore: number;
  readonly outcome: LearningOutcome;
  readonly signals: readonly LearningSignal[];
  readonly evidence: readonly LearningEvidenceReference[];
  readonly observedAt: string;
}

export interface LearningCapabilityProfile {
  readonly capabilityId: string;
  readonly score: number;
  readonly confidence: number;
  readonly observations: number;
  readonly passed: number;
  readonly failed: number;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly updatedAt: string;
}

export type LearningProposalStatus =
  | "proposed"
  | "scheduled"
  | "completed"
  | "failed";

export interface LearningMissionTemplate {
  readonly kind: "operator.autonomous-cycle";
  readonly title: string;
  readonly input: Readonly<{
    projectId: string;
    objective: string;
    reasonForSelection: string;
    expectedNewEvidence: readonly string[];
    cycleIndex: 1;
    maxCycles: 1;
    continuationAuthorized: false;
    files: readonly string[];
  }>;
}

export interface LearningMissionProposal {
  readonly id: string;
  readonly sourceObservationId: string;
  readonly targetCapabilityId: string;
  readonly priority: number;
  readonly reason: string;
  readonly mission: LearningMissionTemplate;
  readonly status: LearningProposalStatus;
  readonly scheduledMissionId: string | null;
  readonly resultObservationId: string | null;
  readonly createdAt: string;
  readonly scheduledAt: string | null;
  readonly completedAt: string | null;
}

export interface ObserveAutonomousLearningRequest {
  readonly missionId: string;
  readonly missionKind: "operator.autonomous-cycle";
  readonly executionId: string;
  readonly executionStatus: "running" | "succeeded" | "failed" | "unavailable";
  readonly evaluationId: string;
  readonly evaluationScore: number;
  readonly evaluationDecision: "accepted" | "rejected";
  readonly evaluationChecks: readonly {
    readonly id: string;
    readonly passed: boolean;
  }[];
  readonly evidenceMemoryId: string;
  readonly projectId: string;
  readonly capabilityIds: readonly string[];
  readonly sourceProposalId?: string | null;
  readonly targetCapabilityId?: string | null;
  readonly capabilityResult?: "pass" | "gap" | null;
  readonly toolEvidenceMemoryId?: string | null;
}

export interface RecordFailedLearningExerciseRequest {
  readonly proposalId: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly evaluationId: string;
  readonly evaluationScore: number;
  readonly failedCheckIds: readonly string[];
  readonly evidenceMemoryId: string;
  readonly projectId: string;
  readonly reason: string;
}

export interface LearningSummary {
  readonly observations: number;
  readonly profiles: number;
  readonly proposals: number;
  readonly proposed: number;
  readonly scheduled: number;
  readonly completed: number;
  readonly failed: number;
  readonly lastObservedAt: string | null;
}
