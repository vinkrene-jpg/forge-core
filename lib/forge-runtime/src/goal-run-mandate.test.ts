import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGoalRunTargetAllowed,
  GOAL_RUN_CAPABILITY_FAILURE_LIMIT,
  parseGoalRunMandateRequest,
} from "./goal-run-mandate";

test("goal run mandate permits only bounded existing mutation roots", () => {
  const mandate = parseGoalRunMandateRequest({
    allowedDirectories: ["lib/", "artifacts/goal-runs"],
    maximumGoals: 3,
    maximumDurationMs: 60_000,
    maximumCostUsd: 2.5,
  });

  assert.deepEqual(mandate.allowedDirectories, ["lib/", "artifacts/goal-runs/"]);
  assert.equal(assertGoalRunTargetAllowed(mandate, "lib/forge-runtime/src/new.ts"), "lib/forge-runtime/src/new.ts");
  assert.equal(assertGoalRunTargetAllowed(mandate, "artifacts/goal-runs/proof.json"), "artifacts/goal-runs/proof.json");
  assert.equal(GOAL_RUN_CAPABILITY_FAILURE_LIMIT, 3);
  assert.throws(() => assertGoalRunTargetAllowed(mandate, "sandbox/not-authorized.txt"), /boundary path exceeded/);
  assert.throws(() => assertGoalRunTargetAllowed(mandate, "lib/forge-runtime/src/governance.ts"), /hard-protection/);
});

test("goal run mandate rejects broadened roots and invalid limits", () => {
  assert.throws(() => parseGoalRunMandateRequest({
    allowedDirectories: ["GOVERNANCE/"],
    maximumGoals: 3,
    maximumDurationMs: 60_000,
    maximumCostUsd: 0,
  }), /hard-protection/);
  assert.throws(() => parseGoalRunMandateRequest({
    allowedDirectories: ["src/"],
    maximumGoals: 3,
    maximumDurationMs: 60_000,
    maximumCostUsd: 0,
  }), /boundary path exceeded/);
  assert.throws(() => parseGoalRunMandateRequest({
    allowedDirectories: ["lib/"],
    maximumGoals: 0,
    maximumDurationMs: 60_000,
    maximumCostUsd: 0,
  }), /maximumGoals/);
});