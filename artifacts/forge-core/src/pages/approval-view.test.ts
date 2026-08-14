import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalRecord } from "@/lib/forge-api";
import {
  approvalQueueState,
  pendingApprovalRows,
} from "./approval-view";

const pendingGoalApproval: ApprovalRecord = {
  id: "approval-goal",
  missionId: "mission-not-yet-hydrated",
  status: "pending",
  assessment: {
    policyVersion: "1.0.0",
    action: "mission.execute",
    missionKind: "operator.goal-build",
    riskLevel: "high",
    decision: "require_approval",
    reason: "Bounded GoalSpec mandate",
    assessedAt: "2026-08-01T10:00:00.000Z",
  },
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  note: null,
};

test("pending goal approval remains visible before mission hydration", () => {
  const rows = pendingApprovalRows([pendingGoalApproval], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.approval.id, pendingGoalApproval.id);
  assert.equal(rows[0]?.mission, null);
  assert.equal(approvalQueueState({
    approvalsLoading: false,
    approvalsError: false,
    pendingCount: rows.length,
  }), "pending");
});

test("loading and query errors cannot masquerade as an empty queue", () => {
  assert.equal(approvalQueueState({
    approvalsLoading: true,
    approvalsError: false,
    pendingCount: 0,
  }), "loading");
  assert.equal(approvalQueueState({
    approvalsLoading: false,
    approvalsError: true,
    pendingCount: 0,
  }), "error");
});