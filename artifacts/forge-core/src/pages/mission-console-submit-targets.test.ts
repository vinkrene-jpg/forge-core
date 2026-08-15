import assert from "node:assert/strict";
import test from "node:test";
import type { CreateMissionRequest } from "../lib/operator-api";
import { buildMissionConsoleCreateRequest } from "./mission-console-submit";

function previewRequest(): CreateMissionRequest {
  return {
    kind: "operator.autonomous-cycle",
    title: "Build approved targets",
    input: {
      projectId: "forge-core",
      objective: "Build approved targets",
      cycleIndex: 1,
      maxCycles: 1,
      continuationAuthorized: false,
    },
  };
}

test("one labeled target keeps proofTargetPath", () => {
  const request = buildMissionConsoleCreateRequest(
    "Maak het bestand.\nPad: sandbox/mandaat-a.txt",
    previewRequest(),
  );

  assert.deepEqual(request.input.targets, [
    { path: "sandbox/mandaat-a.txt", allowCreate: true },
  ]);
  assert.equal(request.input.proofTargetPath, "sandbox/mandaat-a.txt");
  assert.equal(request.input.proofTargetPaths, undefined);
});

test("two labeled targets keep the complete manifest and use proofTargetPaths", () => {
  const request = buildMissionConsoleCreateRequest(
    [
      "Maak beide bestanden.",
      "Pad: sandbox/mandaat-a.txt",
      "Pad: sandbox/mandaat-b.txt",
    ].join("\n"),
    previewRequest(),
  );

  assert.deepEqual(request.input.targets, [
    { path: "sandbox/mandaat-a.txt", allowCreate: true },
    { path: "sandbox/mandaat-b.txt", allowCreate: true },
  ]);
  assert.equal(request.input.proofTargetPath, undefined);
  assert.deepEqual(request.input.proofTargetPaths, [
    "sandbox/mandaat-a.txt",
    "sandbox/mandaat-b.txt",
  ]);
});

test("labeled lib and artifacts targets are preserved", () => {
  const request = buildMissionConsoleCreateRequest(
    "Wijzig broncode.\nPad: lib/example.ts\nPad: artifacts/example.ts",
    previewRequest(),
  );
  assert.deepEqual(request.input.targets, [
    { path: "lib/example.ts", allowCreate: true },
    { path: "artifacts/example.ts", allowCreate: true },
  ]);
});

test("labeled targets outside allowed roots are rejected", () => {
  assert.throws(
    () => buildMissionConsoleCreateRequest(
      "Wijzig script.\nPad: scripts/src/example.ts",
      previewRequest(),
    ),
    /must remain inside sandbox\/, lib\/, or artifacts\//,
  );
});