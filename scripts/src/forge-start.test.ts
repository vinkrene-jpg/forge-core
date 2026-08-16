import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertCanonicalRepositoryRoot,
  canonicalRepositoryRoot,
  configuredProviders,
  formatEnvironmentDiagnostic,
  loadRootEnvironment,
} from "./forge-start.js";

test("matching canonical repository root starts normally", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-canonical-equal-"));
  try {
    const canonical = canonicalRepositoryRoot(root, {});
    assert.doesNotThrow(() => assertCanonicalRepositoryRoot(root, canonical));
    assert.equal(canonical, path.resolve(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("different canonical repository root is rejected with both paths", () => {
  const running = mkdtempSync(path.join(os.tmpdir(), "forge-running-root-"));
  const canonical = mkdtempSync(path.join(os.tmpdir(), "forge-canonical-root-"));
  try {
    assert.throws(
      () => assertCanonicalRepositoryRoot(running, canonical),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(running.replaceAll("\\", "\\\\"), "i"));
        assert.match(error.message, new RegExp(canonical.replaceAll("\\", "\\\\"), "i"));
        return true;
      },
    );
  } finally {
    rmSync(running, { recursive: true, force: true });
    rmSync(canonical, { recursive: true, force: true });
  }
});

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

test("Forge child receives only the approved provider secret", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-start-secrets-"));
  try {
    writeFileSync(
      path.join(root, ".env"),
      [
        "OPENAI_API_KEY=test-openai",
        "FORGE_WORKSPACE_BRIDGE_TOKEN=test-bridge",
        "DATABASE_URL=test-database",
        "SMTP_PASSWORD=test-mail",
        "STRIPE_SECRET_KEY=test-payment",
        "GITHUB_TOKEN=test-github",
      ].join("\n"),
    );
    const environment = loadRootEnvironment(root, {});
    assert.equal(environment.OPENAI_API_KEY, "test-openai");
    assert.equal(environment.FORGE_WORKSPACE_BRIDGE_TOKEN, undefined);
    assert.equal(environment.DATABASE_URL, undefined);
    assert.equal(environment.SMTP_PASSWORD, undefined);
    assert.equal(environment.STRIPE_SECRET_KEY, undefined);
    assert.equal(environment.GITHUB_TOKEN, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});