// Real Code Execution Test Runner module.
// Executes actual commands (dependency install, lint, typecheck, build, unit,
// integration) inside a sandbox directory with a restricted environment.
// Built as a module on top of the Locked Core test pipeline — the core
// testRunner, Guardian and Governor are not modified.

import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  db,
  testRunsTable,
  testRunStepsTable,
  modulesTable,
  sandboxesTable,
  sandboxFilesTable,
  type ModuleRow,
  type SandboxRow,
  type TestRunRow,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { isProtectedPath } from "./corelock";
import { sandboxDir, storageRoot } from "./storage";
import { audit } from "./audit";
import { logger } from "./logger";
import { TestTargetError } from "./testRunner";

export const REAL_EXECUTABLE_TYPES = ["lint", "typecheck", "build", "unit", "integration"] as const;

const OUTPUT_CAP = 100_000; // chars per stream per step

interface StepOutcome {
  step: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function stepTimeoutMs(step: string): number {
  const configured = Number(process.env.REAL_TEST_STEP_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return step === "install" ? 180_000 : 120_000;
}

// Env var names that are NEVER passed to sandboxed processes, regardless of
// the allowlist. Everything not explicitly allowed is excluded by default.
const HARD_DENY_ENV = new Set([
  "DATABASE_URL",
  "SESSION_SECRET",
  "PGPASSWORD",
  "PGUSER",
  "PGHOST",
  "PGDATABASE",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CUSTOM_AI_API_KEY",
]);
// Names matching this pattern are only allowed when explicitly prefixed with
// TEST_ (i.e. a secret that was created specifically for testing).
const SENSITIVE_NAME = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|DATABASE|AUTH|COOKIE|SESSION|PRIVATE|^PG)/i;

interface RestrictedEnvResult {
  env: NodeJS.ProcessEnv;
  deniedAllowlistVars: string[];
}

// Restricted environment for sandboxed processes.
// Only PATH/HOME/TMP basics plus secrets explicitly allowed via
// TEST_SECRET_ALLOWLIST (comma-separated env var names). Core credentials are
// hard-denied, and sensitive-looking names are only allowed with a TEST_ prefix.
function buildRestrictedEnv(dir: string): RestrictedEnvResult {
  const home = path.join(dir, ".forge-home");
  const tmp = path.join(dir, ".forge-tmp");
  for (const d of [home, tmp]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: tmp,
    NODE_ENV: "test",
    CI: "true",
    // Shared npm cache inside Forge storage (outside the repo and core).
    NPM_CONFIG_CACHE: path.join(storageRoot, ".npm-cache"),
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
  const deniedAllowlistVars: string[] = [];
  const allowlist = (process.env.TEST_SECRET_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const name of allowlist) {
    if (HARD_DENY_ENV.has(name) || (SENSITIVE_NAME.test(name) && !name.startsWith("TEST_"))) {
      deniedAllowlistVars.push(name);
      continue;
    }
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return { env, deniedAllowlistVars };
}

// Node.js permission model flags for steps that execute module code.
// Every node process spawned in the sandbox (including children started by
// npm scripts) inherits these via NODE_OPTIONS: filesystem access is limited
// to the sandbox directory, the npm cache and the read-only /nix store.
// Non-node child processes are a documented residual risk, mitigated by the
// core integrity verification below.
function permissionNodeOptions(dir: string): string {
  const cache = path.join(storageRoot, ".npm-cache");
  return [
    "--permission",
    `--allow-fs-read=${dir}/`,
    `--allow-fs-read=${cache}/`,
    "--allow-fs-read=/nix/",
    `--allow-fs-write=${dir}/`,
    `--allow-fs-write=${cache}/`,
    "--allow-child-process",
  ].join(" ");
}

// Core integrity verification: checksum of the Locked Core implementation
// (api-server source and DB schema). Computed before and after real
// execution; any difference marks the run as a security failure.
function coreSourceDirs(): string[] {
  const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
  return [
    path.join(workspaceRoot, "artifacts", "api-server", "src"),
    path.join(workspaceRoot, "lib", "db", "src"),
  ].filter((d) => fs.existsSync(d));
}

function hashDirRecursive(dir: string, hash: crypto.Hash): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      hashDirRecursive(full, hash);
    } else if (entry.isFile()) {
      hash.update(full);
      hash.update(fs.readFileSync(full));
    }
  }
}

export function computeCoreChecksum(): string {
  const hash = crypto.createHash("sha256");
  for (const dir of coreSourceDirs()) hashDirRecursive(dir, hash);
  return hash.digest("hex");
}

function runStep(
  step: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<StepOutcome> {
  const command = [cmd, ...args].join(" ");
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(cmd, args, { cwd, env, shell: false });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        step,
        command,
        status: "failed",
        exitCode: null,
        stdout: stdout.slice(0, OUTPUT_CAP),
        stderr: (stderr + `\n[forge] step timed out after ${stepTimeoutMs(step)}ms and was killed`).slice(0, OUTPUT_CAP),
        durationMs: Date.now() - started,
      });
    }, stepTimeoutMs(step));
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < OUTPUT_CAP) stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < OUTPUT_CAP) stderr += d.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        step,
        command,
        status: "failed",
        exitCode: null,
        stdout: stdout.slice(0, OUTPUT_CAP),
        stderr: `[forge] failed to start process: ${err.message}`.slice(0, OUTPUT_CAP),
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        step,
        command,
        status: code === 0 ? "passed" : "failed",
        exitCode: code,
        stdout: stdout.slice(0, OUTPUT_CAP),
        stderr: stderr.slice(0, OUTPUT_CAP),
        durationMs: Date.now() - started,
      });
    });
  });
}

function skipped(step: string, reason: string): StepOutcome {
  return {
    step,
    command: "-",
    status: "skipped",
    exitCode: null,
    stdout: "",
    stderr: reason,
    durationMs: 0,
  };
}

function failedStep(step: string, reason: string): StepOutcome {
  return {
    step,
    command: "-",
    status: "failed",
    exitCode: null,
    stdout: "",
    stderr: reason,
    durationMs: 0,
  };
}

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson | null {
  const p = path.join(dir, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

export async function executeRealTestRun(input: {
  moduleId?: number;
  sandboxId?: number;
  types: string[];
}): Promise<TestRunRow> {
  let module: ModuleRow | undefined;
  let sandbox: SandboxRow | undefined;

  if (input.moduleId != null) {
    [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, input.moduleId));
    if (!module) throw new TestTargetError("Module not found");
    [sandbox] = await db
      .select()
      .from(sandboxesTable)
      .where(eq(sandboxesTable.moduleId, module.id))
      .orderBy(desc(sandboxesTable.createdAt))
      .limit(1);
    if (!sandbox) {
      throw new TestTargetError(
        "Real execution requires a sandbox linked to this module. Create a sandbox with moduleId set and add the module code there.",
      );
    }
  } else if (input.sandboxId != null) {
    [sandbox] = await db.select().from(sandboxesTable).where(eq(sandboxesTable.id, input.sandboxId));
    if (!sandbox) throw new TestTargetError("Sandbox not found");
    if (sandbox.moduleId != null) {
      [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, sandbox.moduleId));
    }
  } else {
    throw new TestTargetError("Provide moduleId or sandboxId");
  }

  if (!input.types.includes("unit")) {
    throw new TestTargetError(
      "Real execution requires 'unit' in types: unit tests are mandatory before a module can be installed.",
    );
  }

  const dir = sandboxDir(sandbox.id);
  if (!fs.existsSync(dir)) {
    throw new TestTargetError("Sandbox directory does not exist on disk. Add files to the sandbox first.");
  }

  // Defense in depth: re-verify every registered sandbox file path against
  // the Locked Core protection rules before executing anything.
  const files = await db.select().from(sandboxFilesTable).where(eq(sandboxFilesTable.sandboxId, sandbox.id));
  const violations = files.filter((f) => isProtectedPath(f.path));
  if (violations.length > 0) {
    await audit({
      actor: "real-test-runner",
      action: "real_test_run_blocked",
      targetType: "sandbox",
      targetId: sandbox.id,
      details: `Blocked: protected paths in sandbox: ${violations.map((f) => f.path).join(", ")}`,
      outcome: "blocked",
    });
    throw new TestTargetError("Sandbox contains protected core paths. Real execution refused.");
  }

  const requested = input.types.filter((t): t is (typeof REAL_EXECUTABLE_TYPES)[number] =>
    (REAL_EXECUTABLE_TYPES as readonly string[]).includes(t),
  );
  const notExecutable = input.types.filter((t) => !(REAL_EXECUTABLE_TYPES as readonly string[]).includes(t));

  const pkg = readPackageJson(dir);
  const { env, deniedAllowlistVars } = buildRestrictedEnv(dir);
  if (deniedAllowlistVars.length > 0) {
    await audit({
      actor: "real-test-runner",
      action: "test_secret_allowlist_denied",
      targetType: "sandbox",
      targetId: sandbox.id,
      details: `TEST_SECRET_ALLOWLIST entries refused (core credentials or sensitive names without TEST_ prefix): ${deniedAllowlistVars.join(", ")}`,
      outcome: "blocked",
    });
  }
  // Steps that execute module code run under the Node.js permission model.
  const execEnv: NodeJS.ProcessEnv = { ...env, NODE_OPTIONS: permissionNodeOptions(dir) };
  const coreChecksumBefore = computeCoreChecksum();
  const runStarted = Date.now();
  const steps: StepOutcome[] = [];

  // 1. Dependency install: --ignore-scripts means no package code executes
  // during install; only the permission-restricted steps run module code.
  let installFailed = false;
  if (pkg) {
    const install = await runStep(
      "install",
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
      dir,
      env,
    );
    steps.push(install);
    installFailed = install.status === "failed";
  } else {
    steps.push(skipped("install", "No package.json in sandbox; dependency install skipped."));
  }

  const scripts = pkg?.scripts ?? {};
  const hasTsconfig = fs.existsSync(path.join(dir, "tsconfig.json"));

  for (const type of requested) {
    if (installFailed) {
      steps.push(skipped(type, "Skipped because dependency install failed."));
      continue;
    }
    switch (type) {
      case "lint":
        steps.push(
          scripts.lint
            ? await runStep("lint", "npm", ["run", "lint"], dir, execEnv)
            : skipped("lint", "No 'lint' script in package.json."),
        );
        break;
      case "typecheck":
        if (scripts.typecheck) {
          steps.push(await runStep("typecheck", "npm", ["run", "typecheck"], dir, execEnv));
        } else if (hasTsconfig && pkg) {
          steps.push(await runStep("typecheck", "npx", ["--no-install", "tsc", "--noEmit"], dir, execEnv));
        } else {
          steps.push(skipped("typecheck", "No 'typecheck' script and no tsconfig.json."));
        }
        break;
      case "build":
        steps.push(
          scripts.build
            ? await runStep("build", "npm", ["run", "build"], dir, execEnv)
            : skipped("build", "No 'build' script in package.json."),
        );
        break;
      case "unit": {
        const script = scripts["test:unit"] ? "test:unit" : scripts.test ? "test" : null;
        steps.push(
          script
            ? await runStep("unit", "npm", ["run", script], dir, execEnv)
            : failedStep("unit", "Tests are mandatory: no 'test' or 'test:unit' script found in package.json."),
        );
        break;
      }
      case "integration":
        steps.push(
          scripts["test:integration"]
            ? await runStep("integration", "npm", ["run", "test:integration"], dir, execEnv)
            : skipped("integration", "No 'test:integration' script in package.json."),
        );
        break;
    }
  }
  for (const t of notExecutable) {
    steps.push(skipped(t, `Type '${t}' is not executed in real mode; it is covered by the static test runner.`));
  }

  // Core integrity verification: if the Locked Core implementation changed
  // during execution, the run is a security failure regardless of test output.
  const coreChecksumAfter = computeCoreChecksum();
  if (coreChecksumAfter !== coreChecksumBefore) {
    steps.push(
      failedStep(
        "core-integrity",
        "SECURITY: Locked Core source files were modified during test execution. Run marked as failed.",
      ),
    );
    await audit({
      actor: "real-test-runner",
      action: "core_integrity_violation",
      targetType: "sandbox",
      targetId: sandbox.id,
      details: "Core source checksum changed during real test execution. Possible sandbox escape attempt.",
      outcome: "blocked",
    });
  }

  const durationMs = Date.now() - runStarted;
  const passed = steps.filter((s) => s.status === "passed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const status = failed > 0 ? "failed" : "passed";

  const summary = steps.map((s) => ({
    type: s.step,
    status: s.status,
    details: `${s.command} → exit ${s.exitCode ?? "n/a"} in ${s.durationMs}ms${s.status === "skipped" ? ` (${s.stderr})` : ""}`,
  }));

  const [row] = await db
    .insert(testRunsTable)
    .values({
      moduleId: module?.id ?? null,
      sandboxId: sandbox.id,
      types: input.types,
      status,
      results: JSON.stringify(summary),
      passed,
      failed,
      mode: "real",
      moduleVersion: module?.version ?? null,
      durationMs,
    })
    .returning();

  if (steps.length > 0) {
    await db.insert(testRunStepsTable).values(
      steps.map((s) => ({
        testRunId: row.id,
        step: s.step,
        command: s.command,
        status: s.status,
        exitCode: s.exitCode,
        stdout: s.stdout,
        stderr: s.stderr,
        durationMs: s.durationMs,
      })),
    );
  }

  if (module) {
    await db.update(modulesTable).set({ testStatus: status }).where(eq(modulesTable.id, module.id));
  }
  await db.update(sandboxesTable).set({ testStatus: status }).where(eq(sandboxesTable.id, sandbox.id));

  await audit({
    actor: "real-test-runner",
    action: "real_test_run",
    targetType: module ? "module" : "sandbox",
    targetId: module?.id ?? sandbox.id,
    details: `Real execution (${input.types.join(", ")}) — ${passed} passed, ${failed} failed in ${durationMs}ms${module ? ` [module v${module.version}]` : ""}`,
    outcome: status === "failed" ? "blocked" : "allowed",
  });

  logger.info({ testRunId: row.id, status, durationMs, sandboxId: sandbox.id }, "Real test run finished");
  return row;
}
