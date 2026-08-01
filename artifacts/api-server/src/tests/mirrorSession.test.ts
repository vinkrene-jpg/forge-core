import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { ApprovalRecord, MissionRecord } from "@workspace/forge-runtime";
import type {
  MirrorMissionProjection,
  MirrorTimelineEvent,
} from "../lib/mirrorProjection";
import {
  projectMirrorSession,
  SESSION_PROGRESS_MILESTONES,
  type MirrorSessionStatus,
} from "../lib/mirrorSession";
import { createMirrorRouter } from "../routes/mirror";

const occurredAt = "2026-08-01T10:00:00.000Z";

function mission(status: MissionRecord["status"] = "running"): MissionRecord {
  return {
    id: "mission-session-1",
    kind: "operator.workspace-change",
    title: "Session projection",
    status,
    createdAt: occurredAt,
    updatedAt: "2026-08-01T10:10:00.000Z",
    startedAt: status === "awaiting_approval" ? null : occurredAt,
    completedAt: status === "succeeded" || status === "failed"
      ? "2026-08-01T10:10:00.000Z"
      : null,
    attempts: 1,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: "Project session" },
    output: null,
    lastError: status === "failed" ? "Build failed" : null,
  };
}

function event(
  eventType: MirrorTimelineEvent["eventType"],
  sequence: number,
  overrides: Partial<MirrorTimelineEvent> = {},
): MirrorTimelineEvent {
  return {
    missionId: "mission-session-1",
    eventId: `event-${sequence}`,
    eventType,
    occurredAt: new Date(Date.parse(occurredAt) + sequence * 1_000).toISOString(),
    sequence,
    sourceType: "mission",
    sourceId: `source-${sequence}`,
    actorType: "forge",
    summary: eventType,
    payloadReference: `timeline:${sequence}`,
    status: "recorded",
    integrityFlags: [],
    ...overrides,
  };
}

function approval(status: ApprovalRecord["status"]): ApprovalRecord {
  return {
    id: "approval-1",
    missionId: "mission-session-1",
    status,
    assessment: {
      policyVersion: "1.0.0",
      action: "mission.execute",
      missionKind: "operator.workspace-change",
      riskLevel: "high",
      decision: "require_approval",
      reason: "Approval required",
      assessedAt: occurredAt,
    },
    createdAt: occurredAt,
    updatedAt: occurredAt,
    decidedAt: status === "pending" ? null : occurredAt,
    decidedBy: status === "pending" ? null : "operator",
    note: null,
  };
}

function projection(options: {
  readonly status?: MissionRecord["status"];
  readonly events?: readonly MirrorTimelineEvent[];
  readonly approvals?: readonly ApprovalRecord[];
  readonly duplicateWarnings?: readonly string[];
  readonly missingLinks?: readonly string[];
} = {}): MirrorMissionProjection {
  const timeline = options.events ?? [
    event("input_received", 1),
    event("interpretation_created", 2),
  ];
  return {
    mission: mission(options.status),
    timeline,
    approvals: options.approvals ?? [],
    evidence: timeline.filter((item) => item.eventType === "evidence_created"),
    artifacts: [],
    assessments: timeline.filter((item) =>
      item.eventType === "evaluation_completed" ||
      item.eventType === "guardian_reviewed" ||
      item.eventType === "governor_released" ||
      item.eventType === "governor_blocked"),
    result: timeline.some((item) => item.eventType === "result_published")
      ? { status: "completed" }
      : null,
    missingLinks: options.missingLinks ?? [],
    duplicateWarnings: options.duplicateWarnings ?? [],
    integrityWarnings: options.duplicateWarnings ?? [],
  };
}

function assertStatus(
  expected: MirrorSessionStatus,
  options?: Parameters<typeof projection>[0],
): void {
  assert.equal(projectMirrorSession(projection(options)).status, expected);
}

test("Session status follows the deterministic lifecycle precedence", () => {
  const input = event("input_received", 1);
  const interpretation = event("interpretation_created", 2);
  const started = event("execution_started", 3);
  const completed = event("execution_completed", 4);
  const evidence = event("evidence_created", 5);
  const guardian = event("guardian_reviewed", 6);

  assertStatus("NOT_STARTED", { events: [input, interpretation] });
  assertStatus("ACTIVE", { events: [input, interpretation, started] });
  assertStatus("WAITING_APPROVAL", {
    status: "awaiting_approval",
    approvals: [approval("pending")],
  });
  assertStatus("WAITING_EVIDENCE", {
    events: [input, interpretation, started, completed],
  });
  assertStatus("WAITING_REVIEW", {
    events: [input, interpretation, started, completed, evidence],
  });
  assertStatus("READY_FOR_RELEASE", {
    events: [input, interpretation, started, completed, evidence, guardian],
  });
  assertStatus("COMPLETED", {
    status: "succeeded",
    events: [input, interpretation, event("result_published", 7)],
  });
  assertStatus("BLOCKED", {
    status: "failed",
    events: [input, interpretation, event("error_recorded", 7, { summary: "Build failed" })],
  });
});

test("Session progress counts only achieved persisted milestones", () => {
  assert.equal(
    SESSION_PROGRESS_MILESTONES.reduce((sum, item) => sum + item.percentage, 0),
    100,
  );
  const events = [
    event("input_received", 1),
    event("interpretation_created", 2),
    event("approval_granted", 3),
    event("execution_started", 4),
    event("execution_completed", 5),
    event("evidence_created", 6),
    event("evaluation_completed", 7),
    event("guardian_reviewed", 8),
    event("governor_released", 9),
    event("result_published", 10),
  ];
  assert.equal(projectMirrorSession(projection({ status: "succeeded", events })).completionPercentage, 100);
  assert.equal(projectMirrorSession(projection()).completionPercentage, 20);
});

test("Session exposes blockers, pending work and explainable next actions", () => {
  const waitingApproval = projectMirrorSession(projection({
    status: "awaiting_approval",
    approvals: [approval("pending"), approval("approved")],
  }));
  assert.equal(waitingApproval.pendingApprovals, 1);
  assert.match(waitingApproval.nextRecommendedAction, /goedkeuring/i);

  const waitingEvidence = projectMirrorSession(projection({ events: [
    event("input_received", 1),
    event("execution_completed", 2),
  ] }));
  assert.equal(waitingEvidence.pendingEvidence, true);
  assert.match(waitingEvidence.nextRecommendedAction, /bewijs/i);

  const waitingReview = projectMirrorSession(projection({ events: [
    event("input_received", 1),
    event("evidence_created", 2),
  ] }));
  assert.equal(waitingReview.pendingGuardian, true);
  assert.match(waitingReview.nextRecommendedAction, /Guardian/i);

  const readyForRelease = projectMirrorSession(projection({ events: [
    event("input_received", 1),
    event("evidence_created", 2),
    event("guardian_reviewed", 3),
  ] }));
  assert.equal(readyForRelease.pendingGovernor, true);
  assert.match(readyForRelease.nextRecommendedAction, /Governor/i);

  const blocked = projectMirrorSession(projection({
    events: [event("error_recorded", 1, { summary: "Runtime-test failed" })],
    duplicateWarnings: ["duplicate event"],
  }));
  assert.deepEqual(blocked.activeBlockers, ["Runtime-test failed", "duplicate event"]);
  assert.match(blocked.nextRecommendedAction, /blokkade/i);

  const missingApproval = projectMirrorSession(projection({
    status: "awaiting_approval",
    missingLinks: ["approval"],
  }));
  assert.equal(missingApproval.status, "BLOCKED");
  assert.deepEqual(missingApproval.activeBlockers, ["missing approval"]);
});

test("Session projection is deterministic and stable for the same restart data", () => {
  const source = projection({
    events: [event("input_received", 1), event("execution_started", 2)],
  });
  const beforeRestart = projectMirrorSession(structuredClone(source));
  const afterRestart = projectMirrorSession(structuredClone(source));
  assert.deepEqual(afterRestart, beforeRestart);
  assert.match(beforeRestart.sessionId, /^mirror-session-[a-f0-9]{24}$/);
  assert.equal(beforeRestart.missionId, source.mission.id);
});

test("Session endpoint is GET-only and returns a clean unknown-mission 404", async () => {
  const source = {
    listMissions: () => [mission("queued")],
    listApprovals: () => [],
    listAiExecutions: () => [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };
  const app = express();
  app.use("/api", createMirrorRouter(source));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${baseUrl}/api/mirror/session/mission-session-1`);
    assert.equal(response.status, 200);
    const body = await response.json() as { readonly missionId: string };
    assert.equal(body.missionId, "mission-session-1");
    assert.equal((await fetch(`${baseUrl}/api/mirror/session/unknown`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/mirror/session/mission-session-1`, {
      method: "POST",
    })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});