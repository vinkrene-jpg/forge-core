import assert from "node:assert/strict";
import test from "node:test";
import { extractAutonomousWorkspaceTargets } from "./autonomous-cycle";

test("extracts one sandbox target without changing its manifest shape", () => {
  assert.deepEqual(
    extractAutonomousWorkspaceTargets("Maak sandbox/mandaat-a.txt."),
    [{ path: "sandbox/mandaat-a.txt", allowCreate: true }],
  );
});

test("extracts every named sandbox target in stable order", () => {
  assert.deepEqual(
    extractAutonomousWorkspaceTargets(
      "Maak sandbox/mandaat-a.txt en sandbox/mandaat-b.txt.",
    ),
    [
      { path: "sandbox/mandaat-a.txt", allowCreate: true },
      { path: "sandbox/mandaat-b.txt", allowCreate: true },
    ],
  );
});

test("rejects a repository-relative mutation target outside sandbox", () => {
  assert.throws(
    () => extractAutonomousWorkspaceTargets("Wijzig lib/forge-runtime/src/runtime.ts."),
    /must remain inside sandbox\//,
  );
});