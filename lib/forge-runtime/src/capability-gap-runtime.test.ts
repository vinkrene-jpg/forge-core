import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime } from "./runtime";

test("reconciles historical failures once and releases only an inert GoalSpec", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-gap-runtime-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;
  const runtimeStorage = path.join(storage, "forge-runtime");
  await mkdir(runtimeStorage, { recursive: true });
  const failedMission = {
    id: "historical-failure",
    kind: "operator.autonomous-cycle",
    title: "Historical rejected evaluation",
    status: "failed",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T01:00:00.000Z",
    startedAt: "2026-08-15T00:30:00.000Z",
    completedAt: "2026-08-15T01:00:00.000Z",
    attempts: 1,
    interruptedCount: 0,
    input: {},
    output: {
      missionResult: {
        status: "rejected",
        cause: "evaluation",
        message: "Evaluation rejected",
        producedAt: "2026-08-15T01:00:00.000Z",
      },
      evaluation: {
        decision: "rejected",
        checks: [{ id: "verification-explicit", passed: false }],
      },
    },
    lastError: "Evaluation rejected",
  };
  await writeFile(
    path.join(runtimeStorage, "missions.json"),
    JSON.stringify({ version: 1, missions: [failedMission] }),
  );

  try {
    const runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
    await runtime.start();
    const candidates = runtime.listCapabilityGapCandidates();
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every((candidate) => candidate.occurrences === 1));

    const released = await runtime.releaseCapabilityGapCandidate(
      candidates.find((candidate) => candidate.capabilityId === "evaluation.output.assess")!.id,
      "gap-test-operator",
    );
    assert.equal(released.kind, "operator.goal-build");
    assert.equal(released.status, "not_started");
    assert.equal(released.attempts, 0);
    assert.equal(runtime.listApprovals().some((approval) => approval.missionId === released.id), false);

    const repeated = await runtime.releaseCapabilityGapCandidate(
      released.input.capabilityGapCandidateId as string,
      "gap-test-operator",
    );
    assert.equal(repeated.id, released.id);
    await runtime.stop();

    const restarted = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
    await restarted.start();
    assert.equal(
      restarted.listCapabilityAnalyses().filter((analysis) =>
        analysis.sourceMissionId === failedMission.id
      ).length,
      2,
    );
    assert.equal(
      restarted.listCapabilityGapCandidates().filter((candidate) =>
        candidate.releasedGoalSpecMissionId === released.id
      ).length,
      1,
    );
    await restarted.stop();
  } finally {
    process.env.STORAGE_DIR = previousStorage;
    await rm(storage, { recursive: true, force: true });
  }
});