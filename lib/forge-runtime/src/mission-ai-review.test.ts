import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewMissionWithGuardianAi,
  type GuardianAiExecutionResult,
  type GuardianAiReviewDeps,
  type MissionRecord,
} from "./index.js";

const reviewedAt = "2026-08-01T12:00:00.000Z";

function mission(output: Readonly<Record<string, unknown>>): MissionRecord {
  return {
    id: "mission-ai",
    kind: "operator.workspace-change",
    title: "AI review mission",
    status: "running",
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
    startedAt: reviewedAt,
    completedAt: null,
    attempts: 1,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: "do the thing" },
    output,
    lastError: null,
  };
}

const evidenceOutput: Readonly<Record<string, unknown>> = {
  evaluation: { id: "e", decision: "accepted", score: 100, checks: [] },
  executionEvidence: {
    receipts: [{ id: "r", ok: true }],
    verificationRuns: [{ command: "typecheck", exitCode: 0 }],
    artifacts: [{ id: "a" }],
  },
};

function fakeDeps(
  overrides: Partial<GuardianAiReviewDeps> & {
    readonly execResult?: GuardianAiExecutionResult;
    readonly counters?: { compose: number; execute: number };
  } = {},
): GuardianAiReviewDeps {
  const counters = overrides.counters ?? { compose: 0, execute: 0 };
  return {
    aiEnabled: overrides.aiEnabled ?? true,
    gatewayConfigured: overrides.gatewayConfigured ?? (() => true),
    composePrompt: overrides.composePrompt ?? (async () => {
      counters.compose += 1;
      return { id: "composition-1" };
    }),
    executeComposition: overrides.executeComposition ?? (async () => {
      counters.execute += 1;
      return overrides.execResult ?? {
        status: "succeeded",
        outputText: '{"outcome":"blocked","summary":"AI blocks","findings":[{"severity":"critical","category":"security","message":"unsafe"}]}',
        providerId: "openai-responses",
        model: "test-model",
      };
    }),
  };
}

test("rules-only when AI review is disabled", async () => {
  const counters = { compose: 0, execute: 0 };
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({ aiEnabled: false, counters }),
    mission(evidenceOutput),
    evidenceOutput,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules");
  assert.equal(review.guardianReview.outcome, "approved");
  assert.equal(review.governorDecision.decision, "released");
  assert.deepEqual(counters, { compose: 0, execute: 0 });
});

test("rules-only when no provider is configured", async () => {
  const counters = { compose: 0, execute: 0 };
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({ gatewayConfigured: () => false, counters }),
    mission(evidenceOutput),
    evidenceOutput,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules");
  assert.deepEqual(counters, { compose: 0, execute: 0 });
});

test("rules-only when there is no reviewable evidence, even if AI is enabled", async () => {
  const counters = { compose: 0, execute: 0 };
  const output = { checkedAt: reviewedAt, kernelStatus: "running" };
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({ counters }),
    mission(output),
    output,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules");
  assert.deepEqual(counters, { compose: 0, execute: 0 });
});

test("AI Guardian tightens an approved mission to blocked and Governor refuses", async () => {
  const counters = { compose: 0, execute: 0 };
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({ counters }),
    mission(evidenceOutput),
    evidenceOutput,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules+ai");
  assert.equal(review.guardianReview.outcome, "blocked");
  assert.equal(review.guardianReview.model, "openai-responses/test-model");
  assert.equal(review.governorDecision.decision, "blocked");
  assert.deepEqual(counters, { compose: 1, execute: 1 });
});

test("AI Guardian approval keeps a clean mission released via the AI basis", async () => {
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({
      execResult: {
        status: "succeeded",
        outputText: '{"outcome":"approved","summary":"looks good","findings":[]}',
        providerId: "local-model",
        model: "qwen",
      },
    }),
    mission(evidenceOutput),
    evidenceOutput,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules+ai");
  assert.equal(review.guardianReview.outcome, "approved");
  assert.equal(review.governorDecision.decision, "released");
});

test("fail-safe: an unavailable execution falls back to the rule-based review", async () => {
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({ execResult: { status: "unavailable", outputText: null, providerId: null, model: null } }),
    mission(evidenceOutput),
    evidenceOutput,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules");
  assert.equal(review.guardianReview.outcome, "approved");
  assert.equal(review.governorDecision.decision, "released");
});

test("fail-safe: a thrown gateway error falls back to the rule-based review", async () => {
  const review = await reviewMissionWithGuardianAi(
    fakeDeps({
      composePrompt: async () => {
        throw new Error("gateway exploded");
      },
    }),
    mission(evidenceOutput),
    evidenceOutput,
    reviewedAt,
  );
  assert.equal(review.guardianReview.basis, "rules");
  assert.equal(review.governorDecision.decision, "released");
});
