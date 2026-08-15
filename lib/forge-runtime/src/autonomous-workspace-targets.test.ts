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

test("extracts lib and artifacts mutation targets", () => {
  assert.deepEqual(
    extractAutonomousWorkspaceTargets(
      "Wijzig lib/forge-runtime/src/example.ts en artifacts/forge-core/src/example.ts.",
    ),
    [
      { path: "lib/forge-runtime/src/example.ts", allowCreate: true },
      { path: "artifacts/forge-core/src/example.ts", allowCreate: true },
    ],
  );
});

test("rejects a repository-relative mutation target outside allowed roots", () => {
  assert.throws(
    () => extractAutonomousWorkspaceTargets("Wijzig scripts/src/example.ts."),
    /must remain inside sandbox\/, lib\/, or artifacts\//,
  );
});