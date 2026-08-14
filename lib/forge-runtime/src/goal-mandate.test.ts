import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGoalMandateBoundaries,
  assertGoalMandateTargetManifest,
  authorizeGoalMandate,
  GoalMandateBoundaryError,
  parseGoalMandateRequest,
} from "./goal-mandate";

const request = () => parseGoalMandateRequest({
  allowedPaths: ["sandbox/a.txt", "sandbox/b.txt"],
  maximumMissions: 2,
  maximumDurationMs: 60_000,
  maximumCostUsd: 0,
});

test("authorizes exact bounded local goal work", () => {
  const mandate = authorizeGoalMandate({
    request: request(),
    goalMissionId: "goal-1",
    approvalId: "approval-1",
    authorizedAt: "2026-08-14T00:00:00.000Z",
    baselineCostUsd: 0,
  });
  assert.doesNotThrow(() => assertGoalMandateBoundaries({
    mandate,
    targets: ["sandbox/a.txt", "sandbox/b.txt"],
    missionCount: 2,
    now: "2026-08-14T00:00:30.000Z",
    actualCostUsd: 0,
  }));
});

test("reports exact path, count, duration and cost boundaries", () => {
  const mandate = authorizeGoalMandate({
    request: request(),
    goalMissionId: "goal-1",
    approvalId: "approval-1",
    authorizedAt: "2026-08-14T00:00:00.000Z",
    baselineCostUsd: 0,
  });
  const cases = [
    { boundary: "path", input: { targets: ["sandbox/c.txt"], missionCount: 1, now: "2026-08-14T00:00:01.000Z", actualCostUsd: 0 } },
    { boundary: "mission-count", input: { targets: ["sandbox/a.txt"], missionCount: 3, now: "2026-08-14T00:00:01.000Z", actualCostUsd: 0 } },
    { boundary: "duration", input: { targets: ["sandbox/a.txt"], missionCount: 1, now: "2026-08-14T00:01:00.000Z", actualCostUsd: 0 } },
    { boundary: "cost", input: { targets: ["sandbox/a.txt"], missionCount: 1, now: "2026-08-14T00:00:01.000Z", actualCostUsd: 0.01 } },
  ] as const;
  for (const item of cases) {
    assert.throws(
      () => assertGoalMandateBoundaries({ mandate, ...item.input }),
      (error) => error instanceof GoalMandateBoundaryError && error.boundary === item.boundary,
    );
  }
});

test("hard core and guardian protection cannot be added to a mandate", () => {
  for (const target of [
    "GOVERNANCE/CONSTITUTION.md",
    "lib/forge-runtime/src/kernel.ts",
    "lib/forge-runtime/src/mission-review.ts",
    "lib/forge-runtime/src/workspace-executor.ts",
  ]) {
    assert.throws(
      () => parseGoalMandateRequest({
        allowedPaths: [target],
        maximumMissions: 1,
        maximumDurationMs: 60_000,
        maximumCostUsd: 0,
      }),
      (error) => error instanceof GoalMandateBoundaryError && error.boundary === "hard-protection",
    );
  }
});

test("goal mandate target manifest must match all goal targets exactly", () => {
  const mandate = parseGoalMandateRequest({
    allowedPaths: ["sandbox/a.txt", "sandbox/b.txt"],
    maximumMissions: 2,
    maximumDurationMs: 60_000,
    maximumCostUsd: 0,
  });

  assert.doesNotThrow(() =>
    assertGoalMandateTargetManifest(mandate, ["sandbox/b.txt", "sandbox/a.txt"])
  );
  assert.throws(
    () => assertGoalMandateTargetManifest(mandate, ["sandbox/a.txt"]),
    /Goal mandate boundary path exceeded/,
  );
  assert.throws(
    () => assertGoalMandateTargetManifest(mandate, [
      "sandbox/a.txt",
      "sandbox/b.txt",
      "sandbox/c.txt",
    ]),
    /Goal mandate boundary path exceeded/,
  );
});