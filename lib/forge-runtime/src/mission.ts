export type MissionKind =
  | "runtime.self-check"
  | "runtime.stability-window"
  | "operator.autonomous-cycle"
  | "operator.goal-run"
  | "operator.goal-build"
  | "operator.workspace-change"
  | "operator.workspace-plan"
  | "operator.mirror-intake";

export type MissionStatus =
  | "not_started"
  | "awaiting_approval"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type MissionResultStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "rejected";

export interface MissionResult {
  readonly status: MissionResultStatus;
  readonly cause: string;
  readonly message: string;
  readonly producedAt: string;
}

export interface MissionRecord {
  readonly id: string;
  readonly kind: MissionKind;
  readonly title: string;
  readonly status: MissionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly attempts: number;
  readonly interruptedCount: number;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, unknown>> | null;
  readonly lastError: string | null;
}

export interface CreateMissionRequest {
  readonly kind: MissionKind;
  readonly title?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string;
}

export interface MissionSummary {
  readonly total: number;
  readonly notStarted: number;
  readonly awaitingApproval: number;
  readonly queued: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly currentMissionId: string | null;
}

export interface MissionLoopSnapshot {
  readonly status: "stopped" | "running";
  readonly currentMissionId: string | null;
  readonly pollIntervalMs: number;
}
