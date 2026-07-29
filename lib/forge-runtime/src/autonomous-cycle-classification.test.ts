import assert from "node:assert/strict";
import test from "node:test";

import { classifyAutonomousObjective } from "./autonomous-cycle.js";

test('classificeert Nederlandse opdracht met "Bouw" als bouwmodus', () => {
  const result = classifyAutonomousObjective(
    "Bouw Forge Mirror/MCP stap 2: voeg database-tabellen en migraties toe.",
  );

  assert.equal(result.mode, "build-or-mutate");
  assert.equal(result.profile, "generic-build");
});
