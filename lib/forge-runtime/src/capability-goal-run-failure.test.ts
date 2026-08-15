import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime } from "./runtime";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for failed goal run");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function historicalMission(index: number) {
  return {
    id: `goal-run-failure-${index}`,
    kind: "operator.autonomous-cycle",
    title: `Historical evaluation failure ${index}`,
    status: "failed",
    createdAt: `2026-08-15T00:0${index}:00.000Z`,
    updatedAt: `2026-08-15T01:0${index}:00.000Z`,
    startedAt: `2026-08-15T00:3${index}:00.000Z`,
    completedAt: `2026-08-15T01:0${index}:00.000Z`,
    attempts: 1,
    interruptedCount: 0,
    input: {},
    output: {
      missionResult: { status: "rejected", cause: "evaluation", message: "Rejected", producedAt: `2026-08-15T01:0${index}:00.000Z` },
      evaluation: { decision: "rejected", checks: [{ id: `failed-check-${index}`, passed: false }] },
    },
    lastError: "Evaluation rejected",
  };
}

async function withSeededRuntime(
  planner: NonNullable<ConstructorParameters<typeof ForgeRuntime>[0]>["goalRunPlanner"],
  run: (runtime: ForgeRuntime) => Promise<void>,
): Promise<void> {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-goal-run-failure-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;
  await mkdir(path.join(storage, "forge-runtime"), { recursive: true });
  await writeFile(
    path.join(storage, "forge-runtime", "missions.json"),
    JSON.stringify({ version: 1, missions: [1, 2, 3, 4].map(historicalMission) }),
  );
  const runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100, goalRunPlanner: planner });
  try {
    await runtime.start();
    await run(runtime);
  } finally {
    await runtime.stop().catch(() => undefined);
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await rm(storage, { recursive: true, force: true });
  }
}

test("three failures on one capability stop the run before a fourth plan", async () => {
  let plannerCalls = 0;
  await withSeededRuntime(async () => {
    plannerCalls += 1;
    throw new Error("controlled planning failure");
  }, async (runtime) => {
    const created = await runtime.createCapabilityGoalRun({
      allowedDirectories: ["lib/", "artifacts/"],
      maximumGoals: 4,
      maximumDurationMs: 60_000,
      maximumCostUsd: 0,
    });
    assert.ok(created.approval);
    await runtime.approveApproval(created.approval.id, "failure-limit-test");
    await waitFor(() => runtime.getMission(created.mission.id)?.status === "failed");
    const mission = runtime.getMission(created.mission.id);
    assert.equal(plannerCalls, 3);
    assert.equal(mission?.output?.missionResult && (mission.output.missionResult as { cause: string }).cause, "goal-run.capability-failure-limit");
    assert.equal((mission?.output?.goals as unknown[] | undefined)?.length, 3);
  });
});

test("a target outside the run directories blocks the run", async () => {
  await withSeededRuntime(async (candidate) => ({
    repositoryId: "forge-core",
    components: [{
      id: "outside-boundary",
      title: "Outside boundary",
      dependsOn: [],
      targets: ["sandbox/outside.txt"],
      acceptanceCriteria: candidate.proposedGoalSpec.acceptanceCriteria,
      requiredCapabilities: ["tool.workspace.write", "tool.workspace.verify"],
      workspaceChange: {
        changes: [{ path: "sandbox/outside.txt", expectedSha256: null, content: "blocked\n" }],
        verification: ["typecheck", "test", "build"],
        commit: null,
      },
    }],
  }), async (runtime) => {
    const created = await runtime.createCapabilityGoalRun({
      allowedDirectories: ["artifacts/"],
      maximumGoals: 1,
      maximumDurationMs: 60_000,
      maximumCostUsd: 0,
    });
    assert.ok(created.approval);
    await runtime.approveApproval(created.approval.id, "boundary-test");
    await waitFor(() => runtime.getMission(created.mission.id)?.status === "failed");
    const boundary = runtime.getMission(created.mission.id)?.output?.mandateBoundary as { boundary?: string } | undefined;
    assert.equal(boundary?.boundary, "path");
  });
});