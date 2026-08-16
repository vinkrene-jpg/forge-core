import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeEventBus } from "./event-bus";
import { ExerciseRegistry, type ExercismTrackSource } from "./exercise-registry";
import { FileExerciseStateStore } from "./exercise-store";

async function fixture(root: string, includeTest = true): Promise<void> {
  const exerciseRoot = path.join(root, "exercises", "practice", "hello-world");
  await mkdir(path.join(exerciseRoot, ".docs"), { recursive: true });
  await mkdir(path.join(exerciseRoot, ".meta"), { recursive: true });
  await writeFile(path.join(root, "config.json"), JSON.stringify({
    language: "TypeScript",
    exercises: { practice: [{ slug: "hello-world", name: "Hello World", difficulty: 1, practices: ["strings"], prerequisites: [] }] },
  }));
  await writeFile(path.join(exerciseRoot, ".docs", "instructions.md"), "Return the upstream greeting.\n");
  await writeFile(path.join(exerciseRoot, ".meta", "config.json"), JSON.stringify({ files: { solution: ["hello-world.ts"], test: ["hello-world.test.ts"] } }));
  await writeFile(path.join(exerciseRoot, "hello-world.ts"), "export function hello(): string { throw new Error('todo'); }\n");
  if (includeTest) await writeFile(path.join(exerciseRoot, "hello-world.test.ts"), "// upstream test\n");
}

test("Exercism acquisition persists upstream exercise bytes atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-exercise-registry-"));
  const checkoutRoot = path.join(root, "checkout");
  const statePath = path.join(root, "state.json");
  await fixture(checkoutRoot);
  let cleanupCalls = 0;
  const source: ExercismTrackSource = {
    async checkout() {
      return {
        rootPath: checkoutRoot,
        repository: "https://github.com/exercism/typescript.git",
        revision: "a".repeat(40),
        async cleanup() { cleanupCalls += 1; },
      };
    },
  };
  const registry = new ExerciseRegistry({ events: new RuntimeEventBus(), stateStore: new FileExerciseStateStore(statePath), exercismSource: source });
  await registry.initialize();
  const imported = await registry.acquireExercismTrack("typescript");
  assert.equal(imported.length, 1);
  assert.equal(imported[0].instructions, "Return the upstream greeting.\n");
  assert.equal(imported[0].starterFiles[0].path, "hello-world.ts");
  assert.equal(imported[0].testFiles[0].content, "// upstream test\n");
  assert.equal(imported[0].difficulty, 1);
  assert.deepEqual(imported[0].concepts, ["strings"]);
  assert.equal(cleanupCalls, 1);

  await rm(path.join(checkoutRoot, "exercises", "practice", "hello-world", "hello-world.test.ts"));
  await assert.rejects(registry.acquireExercismTrack("typescript"), /ENOENT/);
  assert.equal(registry.listExercises().length, 1);
  assert.equal(registry.listExercises()[0].testFiles[0].content, "// upstream test\n");
  assert.equal(cleanupCalls, 2);
  await rm(root, { recursive: true, force: true });
});

test("the easiest exercise runs first and only unchanged upstream tests promote capabilities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-exercise-attempt-"));
  const checkoutRoot = path.join(root, "checkout");
  await fixture(checkoutRoot);
  const harderRoot = path.join(checkoutRoot, "exercises", "practice", "two-fer");
  await mkdir(path.join(harderRoot, ".docs"), { recursive: true });
  await mkdir(path.join(harderRoot, ".meta"), { recursive: true });
  await writeFile(path.join(checkoutRoot, "config.json"), JSON.stringify({
    language: "TypeScript",
    exercises: { practice: [
      { slug: "two-fer", name: "Two Fer", difficulty: 3, practices: ["strings"], prerequisites: ["hello-world"] },
      { slug: "hello-world", name: "Hello World", difficulty: 1, practices: ["strings"], prerequisites: [] },
    ] },
  }));
  await writeFile(path.join(harderRoot, ".docs", "instructions.md"), "Return a phrase.\n");
  await writeFile(path.join(harderRoot, ".meta", "config.json"), JSON.stringify({ files: { solution: ["two-fer.ts"], test: ["two-fer.test.ts"] } }));
  await writeFile(path.join(harderRoot, "two-fer.test.ts"), "// upstream harder test\n");
  const promoted: string[] = [];
  const registry = new ExerciseRegistry({
    events: new RuntimeEventBus(),
    stateStore: new FileExerciseStateStore(path.join(root, "state.json")),
    exercismSource: { async checkout() { return { rootPath: checkoutRoot, repository: "https://github.com/exercism/typescript.git", revision: "b".repeat(40), async cleanup() {} }; } },
    async promoteCapability(request) { promoted.push(`${request.capabilityId}:${request.exerciseId}:${request.attemptId}`); },
  });
  await registry.initialize();
  await registry.acquireExercismTrack("typescript");
  assert.equal(registry.nextExercise()?.id, "exercism:typescript:hello-world");
  const failed = await registry.startAttempt("exercism:typescript:hello-world", "mission-1", ["upstream-test"]);
  const expectedHash = failed.upstreamTestsSha256;
  const failedResult = await registry.completeAttempt(failed.id, {
    command: ["upstream-test"], exitCode: 0, durationMs: 25,
    testsSha256Before: expectedHash, testsSha256After: "c".repeat(64), image: null, containerId: null,
  });
  assert.equal(failedResult.status, "failed");
  assert.equal(failedResult.attemptNumber, 1);
  assert.equal(failedResult.durationMs, 25);
  assert.deepEqual(promoted, []);
  const passed = await registry.startAttempt("exercism:typescript:hello-world", "mission-2", ["upstream-test"]);
  const passedResult = await registry.completeAttempt(passed.id, {
    command: ["upstream-test"], exitCode: 0, durationMs: 40,
    testsSha256Before: expectedHash, testsSha256After: expectedHash, image: null, containerId: null,
  });
  assert.equal(passedResult.status, "passed");
  assert.equal(passedResult.attemptNumber, 2);
  const next = registry.nextExercise();
  assert.equal(next?.id, "exercism:typescript:two-fer");
  assert.equal(next?.difficulty, 3);
  assert.equal(next && registry.estimateDurationMs(next), 33);
  assert.match(promoted[0], /^language\.typescript\.strings:exercism:typescript:hello-world:/);
  await rm(root, { recursive: true, force: true });
});