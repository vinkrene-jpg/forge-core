import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { ApprovalRecord, MissionRecord } from "@workspace/forge-runtime";
import type { MirrorMissionProjection, MirrorTimelineEvent } from "../lib/mirrorProjection";
import { projectMirrorResume, selectMirrorResume } from "../lib/mirrorResume";
import { createMirrorRouter } from "../routes/mirror";

const baseTime = "2026-08-01T10:00:00.000Z";

function event(
  missionId: string,
  eventType: MirrorTimelineEvent["eventType"],
  sequence: number,
  status = "recorded",
): MirrorTimelineEvent {
  return {
    missionId,
    eventId: `${missionId}-${sequence}`,
    eventType,
    occurredAt: new Date(Date.parse(baseTime) + sequence * 1_000).toISOString(),
    sequence,
    sourceType: "mission",
    sourceId: missionId,
    actorType: "forge",
    summary: eventType,
    payloadReference: `timeline:${sequence}`,
    status,
    integrityFlags: [],
  };
}

function projection(
  missionId: string,
  events: readonly MirrorTimelineEvent[],
  status: MissionRecord["status"] = "running",
  output: MissionRecord["output"] = null,
): MirrorMissionProjection {
  return {
    mission: {
      id: missionId,
      kind: "operator.workspace-change",
      title: `Mission ${missionId}`,
      status,
      createdAt: baseTime,
      updatedAt: events.at(-1)?.occurredAt ?? baseTime,
      startedAt: baseTime,
      completedAt: status === "succeeded" || status === "failed" ? events.at(-1)?.occurredAt ?? baseTime : null,
      attempts: 1,
      interruptedCount: 0,
      input: { projectId: "forge-core", objective: "Resume deterministically" },
      output,
      lastError: status === "failed" ? "failed" : null,
    },
    timeline: events,
    approvals: [],
    evidence: events.filter((item) => item.eventType === "evidence_created"),
    artifacts: [],
    assessments: events.filter((item) => item.eventType === "evaluation_completed"),
    result: status === "succeeded" ? { status: "completed" } : null,
    missingLinks: [],
    duplicateWarnings: [],
    integrityWarnings: [],
  };
}

function pendingApproval(missionId: string): ApprovalRecord {
  return {
    id: `${missionId}-approval`,
    missionId,
    status: "pending",
    assessment: {
      policyVersion: "1.0.0",
      action: "mission.execute",
      missionKind: "operator.workspace-change",
      riskLevel: "high",
      decision: "require_approval",
      reason: "Approval required",
      assessedAt: baseTime,
    },
    createdAt: baseTime,
    updatedAt: baseTime,
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
}

test("explicit missionId has priority and proven fields never use chat context", () => {
  const first = projection("first", [
    event("first", "input_received", 1),
    event("first", "execution_started", 2, "running"),
  ]);
  const second = projection("second", [
    event("second", "input_received", 3),
    event("second", "execution_started", 4, "running"),
  ]);
  const selected = selectMirrorResume([first, second], "first");
  assert.equal(selected.ambiguous, false);
  assert.equal(selected.resume?.missionId, "first");
  assert.equal(selected.resume?.lastKnownCommit.certainty, "ONBEKEND");
  assert.equal(selected.resume?.lastKnownRuntimeState.certainty, "ONBEKEND");
});

test("multiple active or blocked candidates produce a deterministic ambiguity response", () => {
  const active = projection("active", [
    event("active", "input_received", 1),
    event("active", "execution_started", 2, "running"),
  ]);
  const blocked = projection("blocked", [
    event("blocked", "input_received", 1),
    event("blocked", "error_recorded", 3, "failed"),
  ], "failed");
  const result = selectMirrorResume([active, blocked]);
  assert.equal(result.ambiguous, true);
  assert.equal(result.resume, null);
  assert.deepEqual(result.candidates.map((item) => item.missionId), ["blocked", "active"]);
  assert.equal(result.nextRecommendedAction.actionType, "CHOOSE_MISSION");
});

test("completed missions are not selected by default and no active mission is explicit", () => {
  const completed = projection("completed", [
    event("completed", "input_received", 1),
    event("completed", "result_published", 2, "succeeded"),
  ], "succeeded");
  const result = selectMirrorResume([completed]);
  assert.equal(result.resumeAvailable, false);
  assert.equal(result.nextRecommendedAction.actionType, "NO_ACTIVE_MISSION");
});

test("resume advice follows proven blockers and proven commit/runtime linkage", () => {
  const source = projection("linked", [
    event("linked", "input_received", 1),
    event("linked", "execution_completed", 2, "succeeded"),
    event("linked", "error_recorded", 3, "failed"),
  ], "failed", {
    executionEvidence: { commitSha: "a".repeat(40) },
    preExecutionSnapshot: {
      runtimeBuildSha: "b".repeat(40),
      runtimeModulePath: "artifacts/api-server/dist/index.mjs",
      status: "healthy",
    },
  });
  const resume = projectMirrorResume(source);
  assert.equal(resume.nextRecommendedAction.actionType, "RESOLVE_BLOCKER");
  assert.equal(resume.lastKnownCommit.certainty, "BEWEZEN");
  assert.equal(resume.lastKnownRuntimeState.certainty, "BEWEZEN");
  assert.equal(resume.lastCompletedStep, "execution_completed");
});

test("projection and selection are byte-identical for unchanged restart data", () => {
  const source = projection("stable", [
    event("stable", "input_received", 1),
    event("stable", "execution_started", 2, "running"),
  ]);
  const before = JSON.stringify(selectMirrorResume([structuredClone(source)]));
  const after = JSON.stringify(selectMirrorResume([structuredClone(source)]));
  assert.equal(after, before);
});

test("open approval determines the safe resume action", () => {
  const source = projection("approval", [event("approval", "input_received", 1)]);
  const resume = projectMirrorResume({ ...source, approvals: [pendingApproval("approval")] });
  assert.equal(resume.pendingApprovals, 1);
  assert.equal(resume.nextRecommendedAction.actionType, "WAIT_FOR_APPROVAL");
});

test("completed execution without evidence is marked explicitly", () => {
  const resume = projectMirrorResume(projection("evidence", [
    event("evidence", "input_received", 1),
    event("evidence", "execution_completed", 2, "succeeded"),
  ]));
  assert.equal(resume.pendingEvidence, true);
  assert.equal(resume.nextRecommendedAction.actionType, "COLLECT_EVIDENCE");
});

test("rejected Guardian review becomes a proven resume blocker", () => {
  const source = projection("guardian-block", [
    event("guardian-block", "evidence_created", 1),
    event("guardian-block", "guardian_reviewed", 2, "rejected"),
  ]);
  const resume = projectMirrorResume(source);
  assert.equal(resume.resumeStatus, "BLOCKED");
  assert.equal(resume.nextRecommendedAction.actionType, "RESOLVE_BLOCKER");
  assert.deepEqual(resume.activeBlockers, ["guardian_reviewed"]);
});

test("Guardian-approved mission receives the Governor action", () => {
  const resume = projectMirrorResume(projection("governor", [
    event("governor", "evidence_created", 1),
    event("governor", "guardian_reviewed", 2, "accepted"),
  ]));
  assert.equal(resume.pendingGovernor, true);
  assert.equal(resume.nextRecommendedAction.actionType, "REQUEST_GOVERNOR_DECISION");
});

test("ambiguity response contains at most five deterministically ordered candidates", () => {
  const sources = Array.from({ length: 7 }, (_, index) => projection(`candidate-${index}`, [
    event(`candidate-${index}`, "execution_started", index + 1, "running"),
  ]));
  const result = selectMirrorResume(sources);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 5);
  assert.equal(result.candidates[0]?.missionId, "candidate-6");
});

test("missing and corrupt source links remain visible without fallback", () => {
  const source = projection("integrity", [event("integrity", "input_received", 1)]);
  const resume = projectMirrorResume({
    ...source,
    missingLinks: ["evidence"],
    integrityWarnings: ["missing evidence", "mismatched missionId"],
  });
  assert.deepEqual(resume.integrityWarnings, ["mismatched missionId", "missing evidence"]);
  assert.ok(resume.missingData.includes("evidence"));
  assert.equal(resume.fieldCertainty.currentState, "AFGELEID");
});

test("Resume endpoints are GET-only and unknown missionId returns 404", async () => {
  const sourceMission = projection("route-mission", [
    event("route-mission", "input_received", 1),
    event("route-mission", "execution_started", 2, "running"),
  ]).mission;
  let sourceMissions: readonly MissionRecord[] = [sourceMission];
  const source = {
    listMissions: () => sourceMissions,
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
    const standard = await fetch(`${baseUrl}/api/mirror/resume`);
    assert.equal(standard.status, 200);
    assert.equal((await standard.json() as { resumeAvailable: boolean }).resumeAvailable, true);
    const explicit = await fetch(`${baseUrl}/api/mirror/resume/route-mission`);
    assert.equal(explicit.status, 200);
    assert.equal((await explicit.json() as { resume: { missionId: string } }).resume.missionId, "route-mission");
    assert.equal((await fetch(`${baseUrl}/api/mirror/resume/unknown`)).status, 404);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(`${baseUrl}/api/mirror/resume`, { method })).status, 404);
    }
    sourceMissions = [projection("completed-route", [], "succeeded", {
      missionResult: { status: "completed" },
    }).mission];
    const noResume = await fetch(`${baseUrl}/api/mirror/resume`);
    assert.equal(noResume.status, 200);
    assert.equal((await noResume.json() as { resumeAvailable: boolean }).resumeAvailable, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});