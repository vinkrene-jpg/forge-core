export type MissionKind =
  | "runtime.self-check"
  | "runtime.stability-window";

export type MissionStatus =
  | "awaiting_approval"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

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
}

export interface MissionSummary {
  readonly total: number;
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