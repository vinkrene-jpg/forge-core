import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  aggregateTestHash,
  ForgeRuntime,
  type AiProviderConnector,
  type ExerciseRunner,
  type ExercismTrackSource,
} from "./index.js";

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for exercise learning run");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("one approved learning run acquires and completes the easiest upstream exercise", { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-exercise-run-"));
  const checkoutRoot = path.join(root, "track");
  const exerciseRoot = path.join(checkoutRoot, "exercises", "practice", "hello-world");
  await mkdir(path.join(exerciseRoot, ".docs"), { recursive: true });
  await mkdir(path.join(exerciseRoot, ".meta"), { recursive: true });
  await writeFile(path.join(checkoutRoot, "config.json"), JSON.stringify({
    language: "Python",
    exercises: { practice: [{ slug: "hello-world", name: "Hello World", difficulty: 1, practices: ["strings"], prerequisites: [] }] },
  }));
  await writeFile(path.join(exerciseRoot, ".docs", "instructions.md"), "Return Hello, World!\n");
  await writeFile(path.join(exerciseRoot, ".meta", "config.json"), JSON.stringify({ files: { solution: ["hello_world.py"], test: ["hello_world_test.py"] } }));
  await writeFile(path.join(exerciseRoot, "hello_world_test.py"), "import unittest\nfrom hello_world import hello\nclass T(unittest.TestCase):\n def test_hello(self): self.assertEqual(hello(), 'Hello, World!')\n");

  const source: ExercismTrackSource = {
    async checkout() {
      return { rootPath: checkoutRoot, repository: "https://github.com/exercism/python.git", revision: "d".repeat(40), async cleanup() {} };
    },
  };
  let runnerCalls = 0;
  const runner: ExerciseRunner = {
    async run(exercise, solutionFiles) {
      runnerCalls += 1;
      assert.deepEqual(solutionFiles, [{ path: "hello_world.py", content: "def hello():\n    return 'Hello, World!'\n" }]);
      const hash = aggregateTestHash(exercise);
      return { command: ["python3", "-m", "unittest"], exitCode: 0, durationMs: 123, testsSha256Before: hash, testsSha256After: hash, image: "sha256:" + "e".repeat(64), containerId: "f".repeat(64) };
    },
  };
  const connector: AiProviderConnector = {
    id: "openai-responses",
    async execute() {
      return {
        providerResponseId: "exercise-solution-1",
        outputText: JSON.stringify({ files: [{ path: "hello_world.py", content: "def hello():\n    return 'Hello, World!'\n" }] }),
        usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
      };
    },
  };
  const original = new Map(["STORAGE_DIR", "FORGE_AUTONOMY_ENABLED", "FORGE_AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL"].map((key) => [key, process.env[key]]));
  process.env.STORAGE_DIR = path.join(root, "storage");
  process.env.FORGE_AUTONOMY_ENABLED = "false";
  process.env.FORGE_AI_PROVIDER = "openai-responses";
  process.env.OPENAI_API_KEY = "test-only-not-a-secret";
  process.env.OPENAI_MODEL = "test-model";
  const runtime = new ForgeRuntime({ aiProviderConnectors: [connector], exercismTrackSource: source, exerciseRunner: runner, missionLoopPollIntervalMs: 100, autonomyPollIntervalMs: 100 });
  try {
    await runtime.start();
    await assert.rejects(runtime.createMission({ kind: "operator.learning-exercise", input: {} }), /only be created internally/);
    const run = await runtime.createLearningRun({ track: "python", maximumExercises: 2, maximumDurationMs: 60_000, maximumRunCostUsd: 1, maximumDailyCostUsd: 1 });
    assert.equal(run.mission.status, "awaiting_approval");
    assert.ok(run.approval);
    await runtime.approveApproval(run.approval.id, "exercise-test");
    await waitFor(() => runtime.getMission(run.mission.id)?.status === "succeeded");
    await runtime.setAutonomyEnabled(true);
    try {
      await waitFor(() => {
        const passedAttempt = runtime.listExerciseAttempts().some((attempt) => attempt.status === "passed");
        const completedMission = runtime.listMissions().some((mission) => mission.kind === "operator.learning-exercise" && mission.status === "succeeded");
        return passedAttempt && completedMission;
      });
    } catch (error) {
      throw new Error(`${String(error)}\n${JSON.stringify({ missions: runtime.listMissions(), approvals: runtime.listApprovals(), attempts: runtime.listExerciseAttempts(), events: runtime.snapshot().events.slice(-20) }, null, 2)}`);
    }
    assert.equal(runnerCalls, 1);
    const attempts = runtime.listExerciseAttempts("exercism:python:hello-world");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].attemptNumber, 1);
    assert.equal(attempts[0].durationMs, 123);
    assert.equal(attempts[0].verification?.testFilesUnchanged, true);
    const exerciseMission = runtime.listMissions().find((mission) => mission.kind === "operator.learning-exercise");
    assert.equal(exerciseMission?.status, "succeeded");
    assert.equal(runtime.listApprovals().filter((approval) => approval.missionId === exerciseMission?.id).length, 0);
    const capability = runtime.getCapability("language.python.strings");
    assert.equal(capability?.status, "validated");
    assert.equal(capability?.source, `exercise:exercism:python:hello-world:attempt:${attempts[0].id}`);
    await waitFor(() => runtime.listMissions().some((mission) => mission.input.finalAssignmentFallback === true));
    const fallbacks = runtime.listMissions().filter((mission) => mission.input.finalAssignmentFallback === true);
    assert.equal(fallbacks.length, 1);
    assert.equal(fallbacks[0].input.learningRunMissionId, run.mission.id);
    assert.match(String(fallbacks[0].input.objective), /3D game-engine/);
    assert.match(String(fallbacks[0].input.objective), /AutoCAD-bouwer/);
  } finally {
    await runtime.stop();
    for (const [key, value] of original) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  }
});