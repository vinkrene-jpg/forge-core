import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseValidationConfig, repoRoot, runProcess, runValidation, ValidationConfigError, type ValidationConfig } from "./forge-validate.js";

const minimalConfig: ValidationConfig = {
  version: 1,
  reportPath: "reports/validation-report.json",
  runtime: { baseUrl: "http://127.0.0.1:1", port: 1 },
  steps: [],
};

test("configuration is extensible through generic command steps", () => {
  const config = parseValidationConfig(JSON.stringify({
    ...minimalConfig,
    steps: [{ id: "future-module", label: "Future module", type: "command", command: [process.execPath, "--version"] }],
  }));
  assert.equal(config.steps[0]?.id, "future-module");
  assert.throws(() => parseValidationConfig("{}"), ValidationConfigError);
  assert.throws(() => parseValidationConfig(JSON.stringify({
    ...minimalConfig,
    steps: [{ id: "http", label: "HTTP", type: "http", path: "/", expectStatus: 200, expectJson: { status: null } }],
  })), ValidationConfigError);
});

test("repository command steps use the Turbo task graph", () => {
  const config = parseValidationConfig(
    fs.readFileSync(path.join(repoRoot, "config", "forge-validation.json"), "utf8"),
  );
  const commandSteps = config.steps.filter((step) => step.type === "command");

  assert.equal(commandSteps.length, 13);
  for (const step of commandSteps) {
    assert.deepEqual(step.command.slice(0, 4), ["pnpm.cmd", "exec", "turbo", "run"]);
    assert.ok(step.command.some((argument) => argument.startsWith("--filter=@workspace/")));
  }
});

test("successful and failing commands produce reports and deterministic exit codes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-validate-"));
  fs.mkdirSync(path.join(root, "reports"));
  try {
    const pass = await runValidation({ root, restart: false, config: { ...minimalConfig, steps: [{ id: "pass", label: "Pass", type: "command", command: [process.execPath, "-e", "process.exit(0)"] }] } });
    assert.equal(pass.status, "PASS");
    assert.equal(pass.exitCode, 0);
    assert.equal(pass.results[0]?.exitCode, 0);
    assert.ok(fs.existsSync(path.join(root, "reports", "validation-report.json")));

    const fail = await runValidation({ root, restart: false, config: { ...minimalConfig, steps: [{ id: "fail", label: "Fail", type: "command", command: [process.execPath, "-e", "process.exit(7)"] }] } });
    assert.equal(fail.status, "FAIL");
    assert.equal(fail.exitCode, 1);
    assert.equal(fail.results[0]?.exitCode, 7);

    const infrastructure = await runValidation({ root, restart: false, config: { ...minimalConfig, steps: [{ id: "missing", label: "Missing", type: "command", command: [path.join(root, "not-a-command")] }] } });
    assert.equal(infrastructure.exitCode, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("report path may not escape reports", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-validate-path-"));
  try {
    await assert.rejects(() => runValidation({ root, restart: false, reportPath: "../outside.json", config: { ...minimalConfig, steps: [{ id: "pass", label: "Pass", type: "command", command: [process.execPath, "--version"] }] } }), ValidationConfigError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Windows command shims execute without shell output leakage", async () => {
  if (process.platform !== "win32") return;
  const result = await runProcess("pnpm.cmd", ["--version"], repoRoot);
  assert.equal(result.infrastructureError, null);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^11\./);
});