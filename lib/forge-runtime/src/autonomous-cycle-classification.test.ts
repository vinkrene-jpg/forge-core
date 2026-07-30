import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyAutonomousObjective,
  parseAutonomousCycleInput,
} from "./autonomous-cycle.js";

test('classificeert Nederlandse opdracht met "Bouw" als bouwmodus', () => {
  const result = classifyAutonomousObjective(
    "Bouw Forge Mirror/MCP stap 2: voeg database-tabellen en migraties toe.",
  );

  assert.equal(result.mode, "build-or-mutate");
  assert.equal(result.profile, "generic-build");
});

test("behoudt analysemodus wanneer wijzigen expliciet verboden is", () => {
  const result = classifyAutonomousObjective(
    [
      "Analyseer uitsluitend de bestaande database- en migratiestructuur.",
      "Geef concrete repositorypaden als bronverwijzing.",
      "Wijzig geen bestanden.",
    ].join("\n"),
  );

  assert.equal(result.mode, "analysis-only");
  assert.equal(result.profile, "generic-analysis");
});

test("behoudt analysemodus voor Engelse read-only opdracht", () => {
  const result = classifyAutonomousObjective(
    "Inspect the repository files and migration structure. Do not modify files.",
  );

  assert.equal(result.mode, "analysis-only");
  assert.equal(result.profile, "generic-analysis");
});

test("behoudt analysemodus voor Nederlandse postfix-negatie", () => {
  const result = classifyAutonomousObjective(
    "Lees en wijzig sandbox/read-only.txt niet.",
  );

  assert.equal(result.mode, "analysis-only");
  assert.equal(result.profile, "generic-analysis");
});

test("classificeert gecombineerde analyse en echte wijziging als bouwmodus", () => {
  const result = classifyAutonomousObjective(
    "Analyseer de bestaande structuur en wijzig daarna de evaluator met gerichte tests.",
  );

  assert.equal(result.mode, "build-or-mutate");
  assert.equal(result.profile, "generic-build");
});

test("woorden bestand en file alleen maken een analyse niet tot bouwopdracht", () => {
  const result = classifyAutonomousObjective(
    "Inventariseer ieder bestand en file-pad en rapporteer alleen de bevindingen.",
  );

  assert.equal(result.mode, "analysis-only");
  assert.equal(result.profile, "generic-analysis");
});

test("expliciet create-target houdt runtime in generic-build modus", () => {
  const result = parseAutonomousCycleInput({
    projectId: "forge-core",
    objective: "Verwerk uitsluitend het expliciete doelbestand.",
    cycleIndex: 1,
    maxCycles: 1,
    targets: [{
      path: "sandbox/mirror-generic-build-proof-2.txt",
      allowCreate: true,
    }],
  });

  assert.equal(result.objectiveExecutionMode, "build-or-mutate");
  assert.equal(result.objectiveProfile, "generic-build");
});
