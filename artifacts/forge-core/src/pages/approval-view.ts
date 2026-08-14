import type {
  ApprovalRecord,
  MissionRecord,
} from "@/lib/forge-api";

export interface ApprovalViewRow {
  readonly approval: ApprovalRecord;
  readonly mission: MissionRecord | null;
}

export function pendingApprovalRows(
  approvals: readonly ApprovalRecord[],
  missions: readonly MissionRecord[],
): readonly ApprovalViewRow[] {
  const missionsById = new Map(missions.map((mission) => [mission.id, mission]));
  return approvals
    .filter((approval) => approval.status === "pending")
    .map((approval) => Object.freeze({
      approval,
      mission: missionsById.get(approval.missionId) ?? null,
    }));
}

export function approvalQueueState(input: {
  readonly approvalsLoading: boolean;
  readonly approvalsError: boolean;
  readonly pendingCount: number;
}): "loading" | "error" | "empty" | "pending" {
  if (input.approvalsLoading) return "loading";
  if (input.approvalsError) return "error";
  return input.pendingCount === 0 ? "empty" : "pending";
}