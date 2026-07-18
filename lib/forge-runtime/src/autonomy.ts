import type {
  ApprovalRecord,
  GovernanceRiskLevel,
} from "./governance";
import type { MissionRecord } from "./mission";

export type AutonomousBacklogStatus =
  | "proposed"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface AutonomousBacklogItem {
  readonly id: string;
  readonly objective: string;
  readonly selectionReason: string;
  readonly expectedNewEvidence: readonly string[];
  readonly priority: number;
  readonly status: AutonomousBacklogStatus;
  readonly source: string;
  readonly files: readonly string[];
  readonly missionId: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutonomousMissionFingerprint {
  readonly fingerprint: string;
  readonly recordedAt: string;
}

export interface AutonomousRuntimeState {
  readonly enabled: boolean;
  readonly loopStatus: "stopped" | "running";
  readonly lastTickAt: string | null;
  readonly totalTicks: number;
  readonly cyclesScheduled: number;
  readonly lowRiskApprovalsAutoGranted: number;
  readonly blockedByHardGovernance: boolean;
  readonly blockingApprovalId: string | null;
  readonly blockingRiskLevel: GovernanceRiskLevel | null;
  readonly loopPauseReason: string | null;
  readonly loopPauseDetails: string | null;
  readonly loopPauseRequiresResume: boolean;
  readonly loopPauseMissionId: string | null;
  readonly nextRootCycleNotBefore: string | null;
  readonly lastObservedMissionId: string | null;
  readonly lastMissionOutcome: string | null;
  readonly repeatOutcomeCount: number;
  readonly recentMissionFingerprints: readonly AutonomousMissionFingerprint[];
  readonly scheduledWorkspacePlans: readonly string[];
  readonly backlog: readonly AutonomousBacklogItem[];
}

export interface AutonomousRuntimeSummary extends AutonomousRuntimeState {
  readonly loopPaused: boolean;
  readonly pauseReason: string | null;
  readonly pauseDetails: string | null;
  readonly pauseUntil: string | null;
  readonly pauseRequiresResume: boolean;
  readonly pendingApprovals: number;
  readonly pendingHardApprovals: number;
  readonly queuedMissions: number;
  readonly runningMissions: number;
  readonly awaitingApprovalMissions: number;
  readonly latestMissionId: string | null;
  readonly costBudgetUsd: number;
  readonly costSpentUsd: number;
  readonly costRemainingUsd: number;
}

export function requiresHardGovernanceBoundary(
  approval: ApprovalRecord,
): boolean {
  return (
    approval.assessment.riskLevel === "high" ||
    approval.assessment.riskLevel === "critical"
  );
}

export function cloneBacklogItem(
  item: AutonomousBacklogItem,
): AutonomousBacklogItem {
  return Object.freeze({
    ...item,
    expectedNewEvidence: Object.freeze([...item.expectedNewEvidence]),
    files: Object.freeze([...item.files]),
    missionId: item.missionId ?? null,
    lastError: item.lastError ?? null,
  });
}

export function cloneAutonomyState(
  state: AutonomousRuntimeState,
): AutonomousRuntimeState {
  const base = createInitialAutonomyState();

  return Object.freeze({
    ...base,
    ...state,
    lastTickAt: state.lastTickAt ?? base.lastTickAt,
    blockingApprovalId: state.blockingApprovalId ?? base.blockingApprovalId,
    blockingRiskLevel: state.blockingRiskLevel ?? base.blockingRiskLevel,
    loopPauseReason: state.loopPauseReason ?? base.loopPauseReason,
    loopPauseDetails: state.loopPauseDetails ?? base.loopPauseDetails,
    loopPauseRequiresResume:
      state.loopPauseRequiresResume ?? base.loopPauseRequiresResume,
    loopPauseMissionId: state.loopPauseMissionId ?? base.loopPauseMissionId,
    nextRootCycleNotBefore:
      state.nextRootCycleNotBefore ?? base.nextRootCycleNotBefore,
    lastObservedMissionId:
      state.lastObservedMissionId ?? base.lastObservedMissionId,
    lastMissionOutcome: state.lastMissionOutcome ?? base.lastMissionOutcome,
    repeatOutcomeCount: state.repeatOutcomeCount ?? base.repeatOutcomeCount,
    recentMissionFingerprints: Object.freeze(
      (state.recentMissionFingerprints ?? base.recentMissionFingerprints).map(
        (entry) => Object.freeze({ ...entry }),
      ),
    ),
    scheduledWorkspacePlans: Object.freeze([...state.scheduledWorkspacePlans]),
    backlog: Object.freeze(state.backlog.map(cloneBacklogItem)),
  });
}

export function createInitialAutonomyState(): AutonomousRuntimeState {
  return Object.freeze({
    enabled: process.env.FORGE_AUTONOMY_ENABLED?.trim() === "true",
    loopStatus: "stopped",
    lastTickAt: null,
    totalTicks: 0,
    cyclesScheduled: 0,
    lowRiskApprovalsAutoGranted: 0,
    blockedByHardGovernance: false,
    blockingApprovalId: null,
    blockingRiskLevel: null,
    loopPauseReason: null,
    loopPauseDetails: null,
    loopPauseRequiresResume: false,
    loopPauseMissionId: null,
    nextRootCycleNotBefore: null,
    lastObservedMissionId: null,
    lastMissionOutcome: null,
    repeatOutcomeCount: 0,
    recentMissionFingerprints: Object.freeze([]),
    scheduledWorkspacePlans: Object.freeze([]),
    backlog: Object.freeze([]),
  });
}

export function missionCounts(missions: readonly MissionRecord[]): {
  readonly queued: number;
  readonly running: number;
  readonly awaitingApproval: number;
  readonly latestMissionId: string | null;
} {
  let queued = 0;
  let running = 0;
  let awaitingApproval = 0;

  for (const mission of missions) {
    if (mission.status === "queued") {
      queued += 1;
    } else if (mission.status === "running") {
      running += 1;
    } else if (mission.status === "awaiting_approval") {
      awaitingApproval += 1;
    }
  }

  const latest = [...missions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .at(0);

  return Object.freeze({
    queued,
    running,
    awaitingApproval,
    latestMissionId: latest?.id ?? null,
  });
}
