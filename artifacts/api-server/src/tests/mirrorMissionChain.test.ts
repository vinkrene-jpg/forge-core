import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMissionReview,
  type AiExecutionRecord,
  type ApprovalRecord,
  type MissionRecord,
} from "@workspace/forge-runtime";
import {
  MirrorProjectionService,
  type MirrorProjectionSource,
} from "../lib/mirrorProjection";
import { projectMirrorSession } from "../lib/mirrorSession";
import { projectMirrorResume } from "../lib/mirrorResume";

const createdAt = "2026-08-01T10:00:00.000Z";
const approvedAt = "2026-08-01T10:02:00.000Z";
const executionStartedAt = "2026-08-01T10:03:00.000Z";
const completedAt = "2026-08-01T10:10:00.000Z";

function approvedApproval(): ApprovalRecord {
  return {
    id: "approval-1",
    missionId: "mission-chain",
    status: "approved",
    assessment: {
      policyVersion: "1.0.0",
      action: "mission.execute",
      missionKind: "operator.workspace-change",
      riskLevel: "high",
      decision: "require_approval",
      reason: "Explicit operator approval required",
      assessedAt: createdAt,
    },
    createdAt,
    updatedAt: approvedAt,
    decidedAt: approvedAt,
    decidedBy: "operator",
    note: null,
  };
}

function succeededExecution(): AiExecutionRecord {
  return {
    id: "execution-1",
    missionId: "mission-chain",
    compositionId: "composition-1",
    projectId: "forge-core",
    routeProfileId: "route-1",
    providerId: "openai-responses",
    model: "test-model",
    status: "succeeded",
    inputChars: 128,
    outputText: "proof output",
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    estimatedCostUsd: 0,
    providerResponseId: "response-1",
    error: null,
    createdAt,
    startedAt: executionStartedAt,
    completedAt,
  };
}

function executionEvidence(): Readonly<Record<string, unknown>> {
  return {
    objectiveProfile: "file-create-read-hash",
    receipts: [
      {
        id: "receipt-1",
        action: "write-file",
        targetPath: "sandbox/chain-proof.txt",
        completedAt,
        ok: true,
      },
    ],
    fileEffects: [],
    verificationRuns: [
      { command: "typecheck", exitCode: 0, stdoutSha256: "a".repeat(64), stderrSha256: "b".repeat(64), durationMs: 5 },
    ],
    artifacts: [
      { id: "artifact-1", kind: "file-hash-proof", path: "sandbox/chain-proof.txt", sha256: "c".repeat(64) },
    ],
  };
}

function evaluation(decision: "accepted" | "rejected"): Readonly<Record<string, unknown>> {
  return {
    id: "evaluation-1",
    missionId: "mission-chain",
    executionId: "execution-1",
    score: decision === "accepted" ? 100 : 10,
    decision,
    checks: [{ id: "provider-succeeded", passed: decision === "accepted", detail: "provider" }],
    evaluatedAt: completedAt,
  };
}

function completedMission(
  output: Readonly<Record<string, unknown>>,
  status: MissionRecord["status"] = "succeeded",
): MissionRecord {
  return {
    id: "mission-chain",
    kind: "operator.workspace-change",
    title: "Full mission chain",
    status,
    createdAt,
    updatedAt: completedAt,
    startedAt: createdAt,
    completedAt,
    attempts: 1,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: "Run the full mission chain" },
    output,
    lastError: null,
  };
}

function project(
  mission: MissionRecord,
  options: {
    readonly approvals?: readonly ApprovalRecord[];
    readonly executions?: readonly AiExecutionRecord[];
  } = {},
) {
  const source: MirrorProjectionSource = {
    listMissions: () => [mission],
    listApprovals: () => options.approvals ?? [],
    listAiExecutions: () => options.executions ?? [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };
  const projection = new MirrorProjectionService(source).getMission(mission.id);
  assert.ok(projection);
  return projection;
}

test("A completed mission runs the full chain bewijs -> guardian -> governor -> result", () => {
  const evidence = executionEvidence();
  const evaluated = evaluation("accepted");
  const review = deriveMissionReview(
    "mission-chain",
    { evaluation: evaluated, executionEvidence: evidence },
    completedAt,
  );
  assert.equal(review.guardianReview.outcome, "approved");
  assert.equal(review.governorDecision.decision, "released");

  const projection = project(
    completedMission({
      executionEvidence: evidence,
      evaluation: evaluated,
      guardianReview: review.guardianReview,
      governorDecision: review.governorDecision,
      missionResult: {
        status: "completed",
        cause: "execution",
        message: "Chain proof produced",
        producedAt: completedAt,
      },
    }),
    { approvals: [approvedApproval()], executions: [succeededExecution()] },
  );

  const types: string[] = projection.timeline.map((event) => event.eventType);
  for (const required of [
    "input_received",
    "interpretation_created",
    "approval_granted",
    "execution_started",
    "execution_completed",
    "evidence_created",
    "evaluation_completed",
    "guardian_reviewed",
    "governor_released",
    "result_published",
  ]) {
    assert.ok(types.includes(required), `timeline is missing ${required}`);
  }

  const orderOf = (eventType: string): number => types.indexOf(eventType);
  assert.ok(orderOf("evidence_created") < orderOf("guardian_reviewed"));
  assert.ok(orderOf("guardian_reviewed") < orderOf("governor_released"));
  assert.ok(orderOf("governor_released") < orderOf("result_published"));

  assert.equal(projection.missingLinks.includes("guardian_review"), false);
  assert.equal(projection.missingLinks.includes("governor_decision"), false);
  assert.equal(projection.missingLinks.includes("evidence"), false);
  assert.equal(projection.missingLinks.includes("result"), false);
  assert.equal(projection.missingLinks.length, 0);

  assert.ok(projection.assessments.some((event) => event.eventType === "guardian_reviewed"));
  assert.ok(projection.assessments.some((event) => event.eventType === "governor_released"));

  const session = projectMirrorSession(projection);
  assert.equal(session.status, "COMPLETED");
  assert.equal(session.completionPercentage, 100);
  assert.equal(session.pendingGuardian, false);
  assert.equal(session.pendingGovernor, false);
  assert.deepEqual([...session.activeBlockers], []);

  const resume = projectMirrorResume(projection);
  assert.equal(resume.resumeStatus, "COMPLETED");
  assert.equal(resume.lastCompletedStep, "result_published");
});

test("A Governor block surfaces as a blocked chain without a released event", () => {
  const evidence = executionEvidence();
  const rejected = evaluation("rejected");
  const review = deriveMissionReview(
    "mission-chain",
    { evaluation: rejected, executionEvidence: evidence },
    completedAt,
  );
  assert.equal(review.guardianReview.outcome, "blocked");
  assert.equal(review.governorDecision.decision, "blocked");

  const projection = project(
    completedMission(
      {
        executionEvidence: evidence,
        evaluation: rejected,
        guardianReview: review.guardianReview,
        governorDecision: review.governorDecision,
      },
      "running",
    ),
  );

  const types: string[] = projection.timeline.map((event) => event.eventType);
  assert.ok(types.includes("guardian_reviewed"));
  assert.ok(types.includes("governor_blocked"));
  assert.equal(types.includes("governor_released"), false);

  const session = projectMirrorSession(projection);
  assert.equal(session.status, "BLOCKED");
  assert.ok(session.activeBlockers.length > 0);
});
