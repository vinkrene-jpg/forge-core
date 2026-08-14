import assert from "node:assert/strict";
import test from "node:test";
import {
  combineGuardianReview,
  createInitialMissionState,
  deriveMissionGovernorDecision,
  deriveMissionGuardianReview,
  deriveMissionReview,
  MissionEngine,
  parseGuardianAiVerdict,
  RuntimeEventBus,
  type MissionStateStore,
  type PersistedMissionState,
} from "./index.js";
import type { RuntimeHealthSnapshot } from "./kernel";

const reviewedAt = "2026-08-01T12:00:00.000Z";

function acceptedOutput(): Readonly<Record<string, unknown>> {
  return {
    evaluation: {
      id: "evaluation-1",
      decision: "accepted",
      score: 100,
      checks: [{ id: "provider-succeeded", passed: true, detail: "ok" }],
    },
    executionEvidence: {
      objectiveProfile: "file-create-read-hash",
      receipts: [{ id: "receipt-1", action: "write-file", ok: true }],
      fileEffects: [],
      verificationRuns: [{ command: "typecheck", exitCode: 0 }],
      artifacts: [{ id: "artifact-1", kind: "file-hash-proof", path: "sandbox/p.txt" }],
    },
  };
}

test("Guardian approves and Governor releases a clean accepted mission", () => {
  const review = deriveMissionReview("mission-1", acceptedOutput(), reviewedAt);
  assert.equal(review.guardianReview.outcome, "approved");
  assert.equal(review.guardianReview.reviewer, "guardian");
  assert.equal(review.guardianReview.findings.length, 0);
  assert.equal(review.guardianReview.evidenceReference, "mission.output.executionEvidence");
  assert.equal(review.governorDecision.decision, "released");
  assert.equal(review.governorDecision.guardianReviewId, review.guardianReview.id);
});

test("Guardian blocks and Governor refuses a rejected evaluation", () => {
  const guardian = deriveMissionGuardianReview(
    "mission-2",
    {
      evaluation: { id: "evaluation-2", decision: "rejected", score: 10, checks: [] },
    },
    reviewedAt,
  );
  assert.equal(guardian.outcome, "blocked");
  assert.ok(guardian.findings.some((finding) => finding.code === "evaluation_rejected"));
  const governor = deriveMissionGovernorDecision("mission-2", guardian, reviewedAt);
  assert.equal(governor.decision, "blocked");
  assert.equal(governor.guardianOutcome, "blocked");
});

test("Guardian blocks on a failed verification run even when evaluation is accepted", () => {
  const guardian = deriveMissionGuardianReview(
    "mission-3",
    {
      evaluation: { id: "evaluation-3", decision: "accepted", score: 100, checks: [] },
      executionEvidence: {
        receipts: [{ id: "receipt-3", ok: true }],
        verificationRuns: [{ command: "typecheck", exitCode: 1 }],
        artifacts: [],
      },
    },
    reviewedAt,
  );
  assert.equal(guardian.outcome, "blocked");
  assert.ok(guardian.findings.some((finding) => finding.code === "verification_failed"));
});

test("A mission without evidence is still reviewed and released", () => {
  const review = deriveMissionReview(
    "mission-4",
    { checkedAt: reviewedAt, kernelStatus: "running" },
    reviewedAt,
  );
  assert.equal(review.guardianReview.outcome, "approved");
  assert.equal(review.guardianReview.evidenceReference, "mission.output");
  assert.equal(review.governorDecision.decision, "released");
});

test("Review derivation is deterministic for identical persisted input", () => {
  const first = deriveMissionReview("mission-5", acceptedOutput(), reviewedAt);
  const second = deriveMissionReview("mission-5", acceptedOutput(), reviewedAt);
  assert.deepEqual(first, second);
  assert.match(first.guardianReview.id, /^guardian-[a-f0-9]{32}$/);
  assert.match(first.governorDecision.id, /^governor-[a-f0-9]{32}$/);
});

test("parseGuardianAiVerdict reads a strict JSON verdict, even with surrounding prose", () => {
  const verdict = parseGuardianAiVerdict(
    'Here is my review: {"outcome":"blocked","summary":"Unsafe.","findings":[{"severity":"critical","category":"security","message":"secret leaked"}]} done.',
  );
  assert.equal(verdict.outcome, "blocked");
  assert.equal(verdict.summary, "Unsafe.");
  assert.equal(verdict.findings[0]?.severity, "critical");
  assert.equal(verdict.findings[0]?.code, "security");
});

test("parseGuardianAiVerdict treats unparseable output as changes_requested (never a silent pass)", () => {
  assert.equal(parseGuardianAiVerdict("not json at all").outcome, "changes_requested");
  assert.equal(parseGuardianAiVerdict('{"outcome":"definitely-fine"}').outcome, "changes_requested");
});

test("combineGuardianReview lets the AI tighten but never loosen the rule-based outcome", () => {
  const at = "2026-08-01T12:00:00.000Z";
  const approvedRules = deriveMissionGuardianReview(
    "m",
    { evaluation: { id: "e", decision: "accepted", score: 100, checks: [] }, executionEvidence: { receipts: [{ id: "r", ok: true }], verificationRuns: [{ command: "t", exitCode: 0 }], artifacts: [] } },
    at,
  );
  assert.equal(approvedRules.outcome, "approved");

  // AI tightens approved -> blocked
  const tightened = combineGuardianReview("m", approvedRules, {
    outcome: "blocked",
    summary: "AI found a regression",
    findings: [{ severity: "critical", code: "regression_risk", message: "breaks callers" }],
  }, "openai-responses/test-model", at);
  assert.equal(tightened.outcome, "blocked");
  assert.equal(tightened.basis, "rules+ai");
  assert.equal(tightened.model, "openai-responses/test-model");
  assert.ok(tightened.findings.some((finding) => finding.message.startsWith("[ai]")));
  assert.equal(deriveMissionGovernorDecision("m", tightened, at).decision, "blocked");

  // AI cannot loosen a rules "blocked"
  const blockedRules = deriveMissionGuardianReview(
    "m",
    { evaluation: { id: "e", decision: "rejected", score: 1, checks: [] } },
    at,
  );
  assert.equal(blockedRules.outcome, "blocked");
  const stillBlocked = combineGuardianReview("m", blockedRules, {
    outcome: "approved",
    summary: "AI says fine",
    findings: [],
  }, "openai-responses/test-model", at);
  assert.equal(stillBlocked.outcome, "blocked");
  assert.equal(deriveMissionGovernorDecision("m", stillBlocked, at).decision, "blocked");
});

class MemoryMissionStateStore implements MissionStateStore {
  #state: PersistedMissionState = createInitialMissionState();
  async load(): Promise<PersistedMissionState> {
    return this.#state;
  }
  async save(state: PersistedMissionState): Promise<void> {
    this.#state = state;
  }
}

function health(): RuntimeHealthSnapshot {
  return {
    status: "ok",
    kernelStatus: "running",
    checkedAt: reviewedAt,
    uptimeMs: 1,
    eventCount: 1,
  } as unknown as RuntimeHealthSnapshot;
}

test("MissionEngine.complete attaches Guardian review and Governor decision to output", async () => {
  const engine = new MissionEngine({
    events: new RuntimeEventBus(),
    getRuntimeHealth: health,
    stateStore: new MemoryMissionStateStore(),
  });
  await engine.initialize();

  const enqueued = await engine.enqueue(
    { kind: "runtime.self-check", title: "Self check" },
    "queued",
  );
  const running = await engine.claimNext();
  assert.ok(running);
  assert.equal(running.id, enqueued.id);

  const completed = await engine.complete(running.id, {
    checkedAt: reviewedAt,
    kernelStatus: "running",
  });

  assert.equal(completed.status, "succeeded");
  const output = completed.output ?? {};
  const guardianReview = output.guardianReview as { outcome?: string } | undefined;
  const governorDecision = output.governorDecision as { decision?: string } | undefined;
  assert.equal(guardianReview?.outcome, "approved");
  assert.equal(governorDecision?.decision, "released");
  assert.ok(output.missionResult, "missionResult is still present");
});
