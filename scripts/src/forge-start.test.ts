import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  configuredProviders,
  formatEnvironmentDiagnostic,
  loadRootEnvironment,
} from "./forge-start.js";

test("root .env values reach the child environment and inherited values win", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-start-env-"));

  try {
    writeFileSync(
      path.join(root, ".env"),
      "FORGE_TEST_FROM_FILE=from-file\nFORGE_TEST_OVERRIDE=from-file\n",
    );
    const environment = loadRootEnvironment(root, {
      ...process.env,
      FORGE_TEST_OVERRIDE: "already-set",
    });
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify({ fromFile: process.env.FORGE_TEST_FROM_FILE, override: process.env.FORGE_TEST_OVERRIDE }))",
      ],
      { env: environment, encoding: "utf8" },
    );

    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      fromFile: "from-file",
      override: "already-set",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("environment diagnostics redact token, key and secret values", () => {
  for (const name of [
    "FORGE_WORKSPACE_BRIDGE_TOKEN",
    "OPENAI_API_KEY",
    "SESSION_SECRET",
  ]) {
    const diagnostic = formatEnvironmentDiagnostic(name, "must-not-appear");
    assert.equal(diagnostic, `${name}=[REDACTED]`);
    assert.doesNotMatch(diagnostic, /must-not-appear/);
  }

  assert.equal(
    formatEnvironmentDiagnostic("FORGE_AI_PROVIDER", "openai-responses"),
    "FORGE_AI_PROVIDER=openai-responses",
  );
});

test("provider diagnostics expose names without credential values", () => {
  const providers = configuredProviders({
    OPENAI_API_KEY: "openai-value-must-not-appear",
    ANTHROPIC_API_KEY: "anthropic-value-must-not-appear",
    FORGE_LOCAL_MODEL_ENABLED: "true",
  });
  const diagnostic = providers.join(", ");

  assert.deepEqual(providers, ["openai", "anthropic", "local-model"]);
  assert.doesNotMatch(diagnostic, /value-must-not-appear/);
});