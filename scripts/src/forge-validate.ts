import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ValidationStatus = "PASS" | "WARNING" | "FAIL";
export type ValidationExitCode = 0 | 1 | 2;

interface CommandStep { id: string; label: string; type: "command"; command: string[]; }
interface GitStep { id: string; label: string; type: "git"; dirtyStatus?: "WARNING" | "FAIL"; }
interface RuntimeStep { id: string; label: string; type: "runtime"; }
interface HttpStep { id: string; label: string; type: "http"; path: string; expectStatus: number; expectJson?: Readonly<Record<string, string | number | boolean>>; captureMissionId?: boolean; }
export type ValidationStep = CommandStep | GitStep | RuntimeStep | HttpStep;

export interface ValidationConfig {
  version: 1;
  reportPath: string;
  runtime: { baseUrl: string; port: number; restartPort?: number; restartCommand?: string[] };
  steps: ValidationStep[];
}

export interface StepResult {
  id: string;
  label: string;
  type: ValidationStep["type"];
  status: ValidationStatus;
  exitCode: number | null;
  durationMs: number;
  details: Readonly<Record<string, unknown>>;
  error: string | null;
}

export interface ValidationReport {
  schemaVersion: 1;
  technicalCode: "FORGE_VALIDATE_01";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  commit: string | null;
  branch: string | null;
  status: ValidationStatus;
  exitCode: ValidationExitCode;
  runtime: { pid: number | null; listenerCount: number; port: number };
  http: Readonly<Record<string, unknown>>;
  results: StepResult[];
  errors: string[];
}

interface RunOptions {
  root: string;
  config: ValidationConfig;
  restart: boolean;
  reportPath?: string;
}

interface ProcessResult { exitCode: number | null; stdout: string; stderr: string; infrastructureError: string | null; }

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(moduleDir, "..", "..");
const MAX_CAPTURE = 32_000;

export class ValidationConfigError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ValidationConfigError(`${field} is required`);
  return value.trim();
}

function command(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ValidationConfigError(`${field} must be a non-empty string array`);
  }
  return [...value] as string[];
}

export function parseValidationConfig(raw: string): ValidationConfig {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { throw new ValidationConfigError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.runtime) || !Array.isArray(value.steps) || value.steps.length === 0) {
    throw new ValidationConfigError("Config requires version 1, runtime and non-empty steps");
  }
  const ids = new Set<string>();
  const steps = value.steps.map((candidate, index): ValidationStep => {
    if (!isRecord(candidate)) throw new ValidationConfigError(`steps[${index}] must be an object`);
    const id = requiredString(candidate.id, `steps[${index}].id`);
    if (ids.has(id)) throw new ValidationConfigError(`Duplicate step id: ${id}`);
    ids.add(id);
    const label = requiredString(candidate.label, `steps[${index}].label`);
    if (candidate.type === "command") return { id, label, type: "command", command: command(candidate.command, `${id}.command`) };
    if (candidate.type === "git") {
      if (candidate.dirtyStatus !== undefined && candidate.dirtyStatus !== "WARNING" && candidate.dirtyStatus !== "FAIL") throw new ValidationConfigError(`${id}.dirtyStatus is invalid`);
      return { id, label, type: "git", ...(candidate.dirtyStatus ? { dirtyStatus: candidate.dirtyStatus } : {}) };
    }
    if (candidate.type === "runtime") return { id, label, type: "runtime" };
    if (candidate.type === "http") {
      if (!Number.isInteger(candidate.expectStatus) || Number(candidate.expectStatus) < 100) throw new ValidationConfigError(`${id}.expectStatus is invalid`);
      if (candidate.expectJson !== undefined && (!isRecord(candidate.expectJson) || Object.values(candidate.expectJson).some((item) => !["string", "number", "boolean"].includes(typeof item)))) {
        throw new ValidationConfigError(`${id}.expectJson must contain scalar values`);
      }
      return { id, label, type: "http", path: requiredString(candidate.path, `${id}.path`), expectStatus: Number(candidate.expectStatus), ...(candidate.expectJson ? { expectJson: candidate.expectJson as Readonly<Record<string, string | number | boolean>> } : {}), captureMissionId: candidate.captureMissionId === true };
    }
    throw new ValidationConfigError(`${id}.type is invalid`);
  });
  const port = Number(value.runtime.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationConfigError("runtime.port is invalid");
  const restartCommand = value.runtime.restartCommand === undefined ? undefined : command(value.runtime.restartCommand, "runtime.restartCommand");
  const restartPort = value.runtime.restartPort === undefined ? undefined : Number(value.runtime.restartPort);
  if (restartPort !== undefined && (!Number.isInteger(restartPort) || restartPort < 1 || restartPort > 65535)) throw new ValidationConfigError("runtime.restartPort is invalid");
  return {
    version: 1,
    reportPath: requiredString(value.reportPath, "reportPath"),
    runtime: { baseUrl: requiredString(value.runtime.baseUrl, "runtime.baseUrl").replace(/\/$/, ""), port, ...(restartPort ? { restartPort } : {}), ...(restartCommand ? { restartCommand } : {}) },
    steps,
  };
}

function confinedPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const reportsRoot = path.resolve(root, "reports");
  if (resolved !== reportsRoot && !resolved.startsWith(reportsRoot + path.sep)) throw new ValidationConfigError("Report path must stay inside reports/");
  return resolved;
}

export function runProcess(executable: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const isWindowsScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const commandExecutable = isWindowsScript ? process.env.ComSpec || "cmd.exe" : executable;
    const commandArgs = isWindowsScript ? ["/d", "/s", "/c", executable, ...args] : args;
    const child = spawn(commandExecutable, commandArgs, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-MAX_CAPTURE); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-MAX_CAPTURE); });
    child.on("error", (error) => resolve({ exitCode: null, stdout, stderr, infrastructureError: error.message }));
    child.on("exit", (exitCode, signal) => resolve({ exitCode, stdout, stderr, infrastructureError: signal ? `terminated by ${signal}` : null }));
  });
}

async function executeCommand(step: CommandStep, root: string): Promise<Omit<StepResult, "durationMs">> {
  const [executable, ...args] = step.command;
  const result = await runProcess(executable, args, root);
  const error = result.infrastructureError ?? (result.exitCode === 0 ? null : `Command failed with exit code ${result.exitCode}`);
  return { id: step.id, label: step.label, type: step.type, status: error ? "FAIL" : "PASS", exitCode: result.exitCode, details: {}, error };
}

async function gitValue(root: string, args: string[]): Promise<ProcessResult> { return runProcess("git", args, root); }

async function executeGit(step: GitStep, root: string, context: { commit: string | null; branch: string | null }): Promise<Omit<StepResult, "durationMs">> {
  const [status, staged, unstaged, untracked, diffCheck, cachedDiffCheck, commit, branch] = await Promise.all([
    gitValue(root, ["status", "--short", "--untracked-files=all"]),
    gitValue(root, ["diff", "--cached", "--name-only"]),
    gitValue(root, ["diff", "--name-only"]),
    gitValue(root, ["ls-files", "--others", "--exclude-standard"]),
    gitValue(root, ["diff", "--check"]),
    gitValue(root, ["diff", "--cached", "--check"]),
    gitValue(root, ["rev-parse", "HEAD"]),
    gitValue(root, ["branch", "--show-current"]),
  ]);
  const commands = [status, staged, unstaged, untracked, diffCheck, cachedDiffCheck, commit, branch];
  const infrastructure = commands.find((item) => item.infrastructureError)?.infrastructureError;
  if (infrastructure || commands.some((item) => item.exitCode !== 0)) {
    return { id: step.id, label: step.label, type: step.type, status: "FAIL", exitCode: null, details: {}, error: infrastructure ?? "Git command failed" };
  }
  context.commit = commit.stdout.trim() || null;
  context.branch = branch.stdout.trim() || null;
  const counts = {
    staged: staged.stdout.trim() ? staged.stdout.trim().split(/\r?\n/).length : 0,
    unstaged: unstaged.stdout.trim() ? unstaged.stdout.trim().split(/\r?\n/).length : 0,
    untracked: untracked.stdout.trim() ? untracked.stdout.trim().split(/\r?\n/).length : 0,
  };
  const dirty = counts.staged + counts.unstaged + counts.untracked > 0;
  return { id: step.id, label: step.label, type: step.type, status: dirty ? (step.dirtyStatus ?? "WARNING") : "PASS", exitCode: 0, details: { ...counts, clean: !dirty, diffCheck: "passed", cachedDiffCheck: "passed", statusEntries: status.stdout.trim() ? status.stdout.trim().split(/\r?\n/).length : 0 }, error: null };
}

async function findListeners(port: number): Promise<number[]> {
  if (process.platform !== "win32") {
    return await new Promise((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => { socket.destroy(); resolve([-1]); });
      socket.once("error", () => resolve([]));
    });
  }
  const result = await runProcess("powershell.exe", ["-NoProfile", "-Command", `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) | ForEach-Object { $_.OwningProcess }`], repoRoot);
  if (result.infrastructureError || result.exitCode !== 0) throw new Error(result.infrastructureError ?? "Listener inspection failed");
  return [...new Set(result.stdout.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

async function executeRuntime(step: RuntimeStep, config: ValidationConfig, runtime: { pid: number | null; listenerCount: number; port: number }): Promise<Omit<StepResult, "durationMs">> {
  try {
    const listeners = await findListeners(config.runtime.port);
    runtime.listenerCount = listeners.length;
    runtime.pid = listeners.length === 1 ? listeners[0] : null;
    const pass = listeners.length === 1;
    return { id: step.id, label: step.label, type: step.type, status: pass ? "PASS" : "FAIL", exitCode: pass ? 0 : 1, details: { port: config.runtime.port, listenerCount: listeners.length, pid: runtime.pid }, error: pass ? null : `Expected one listener on port ${config.runtime.port}, found ${listeners.length}` };
  } catch (error) {
    return { id: step.id, label: step.label, type: step.type, status: "FAIL", exitCode: null, details: { port: config.runtime.port }, error: error instanceof Error ? error.message : String(error) };
  }
}

async function executeHttp(step: HttpStep, config: ValidationConfig, context: { missionId: string | null; http: Record<string, unknown> }): Promise<Omit<StepResult, "durationMs">> {
  if (step.path.includes("{missionId}") && !context.missionId) return { id: step.id, label: step.label, type: step.type, status: "FAIL", exitCode: 1, details: {}, error: "No missionId captured by an earlier HTTP step" };
  const requestPath = step.path.replace("{missionId}", encodeURIComponent(context.missionId ?? ""));
  const url = config.runtime.baseUrl + requestPath;
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    let body: unknown = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) body = await response.json(); else await response.arrayBuffer();
    if (step.captureMissionId && isRecord(body) && Array.isArray(body.missions)) {
      const mission = body.missions.find((item) => isRecord(item) && typeof item.missionId === "string");
      if (isRecord(mission) && typeof mission.missionId === "string") context.missionId = mission.missionId;
    }
    const mismatches = Object.entries(step.expectJson ?? {}).filter(([field, expected]) => {
      let current: unknown = body;
      for (const segment of field.split(".")) current = isRecord(current) ? current[segment] : undefined;
      return current !== expected;
    }).map(([field]) => field);
    const pass = response.status === step.expectStatus && mismatches.length === 0;
    context.http[step.id] = { url, status: response.status, ok: pass, ...(mismatches.length > 0 ? { mismatches } : {}) };
    const error = response.status !== step.expectStatus
      ? `Expected HTTP ${step.expectStatus}, received ${response.status}`
      : mismatches.length > 0 ? `JSON expectations failed: ${mismatches.join(", ")}` : null;
    return { id: step.id, label: step.label, type: step.type, status: pass ? "PASS" : "FAIL", exitCode: pass ? 0 : 1, details: { url, status: response.status, ...(step.expectJson ? { expectedJson: step.expectJson } : {}), ...(context.missionId ? { missionId: context.missionId } : {}) }, error };
  } catch (error) {
    context.http[step.id] = { url, error: error instanceof Error ? error.message : String(error) };
    return { id: step.id, label: step.label, type: step.type, status: "FAIL", exitCode: null, details: { url }, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForHealth(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Restart verification did not become healthy within ${timeoutMs}ms`);
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function restartIfRequested(options: RunOptions): Promise<StepResult | null> {
  if (!options.restart) return null;
  const started = Date.now();
  const restartCommand = options.config.runtime.restartCommand;
  const restartPort = options.config.runtime.restartPort;
  if (!restartCommand || !restartPort) throw new ValidationConfigError("Restart requested but runtime restartCommand/restartPort is not configured");
  if ((await findListeners(restartPort)).length > 0) throw new Error(`Restart verification port ${restartPort} is already in use`);
  const [executable, ...args] = restartCommand;
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forge-validation-restart-"));
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const child = spawn(executable, args, {
        cwd: options.root,
        env: {
          ...process.env,
          PORT: String(restartPort),
          STORAGE_DIR: storageRoot,
          FORGE_AUTONOMY_ENABLED: "false",
          FORGE_CANONICAL_REPO_ROOT: options.root,
          FORGE_WORKSPACE_ROOT: options.root,
        },
        stdio: ["ignore", "ignore", "ignore"],
        shell: false,
      });
      try {
        await waitForHealth(`http://127.0.0.1:${restartPort}/api/healthz`);
      } finally {
        await stopChild(child);
      }
    }
    return { id: "runtime-restart", label: "Runtime restart", type: "runtime", status: "PASS", exitCode: 0, durationMs: Date.now() - started, details: { isolated: true, starts: 2, port: restartPort }, error: null };
  } finally {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

export async function runValidation(options: RunOptions): Promise<ValidationReport> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const context = { commit: null as string | null, branch: null as string | null, missionId: null as string | null, http: {} as Record<string, unknown> };
  const runtime = { pid: null as number | null, listenerCount: 0, port: options.config.runtime.port };
  const results: StepResult[] = [];
  let infrastructureFailure = false;
  let restartHandled = false;
  for (const step of options.config.steps) {
    if (step.type === "runtime" && options.restart && !restartHandled) {
      restartHandled = true;
      try {
        const restartResult = await restartIfRequested(options);
        if (restartResult) {
          results.push(restartResult);
          console.log(`${restartResult.status} ${restartResult.label}`);
        }
      } catch (error) {
        infrastructureFailure = true;
        const restartResult: StepResult = { id: "runtime-restart", label: "Runtime restart", type: "runtime", status: "FAIL", exitCode: null, durationMs: 0, details: {}, error: error instanceof Error ? error.message : String(error) };
        results.push(restartResult);
        console.log(`${restartResult.status} ${restartResult.label}`);
      }
    }
    const stepStarted = Date.now();
    let result: Omit<StepResult, "durationMs">;
    if (step.type === "command") result = await executeCommand(step, options.root);
    else if (step.type === "git") result = await executeGit(step, options.root, context);
    else if (step.type === "runtime") result = await executeRuntime(step, options.config, runtime);
    else result = await executeHttp(step, options.config, context);
    if (result.exitCode === null && result.status === "FAIL") infrastructureFailure = true;
    const complete = { ...result, durationMs: Date.now() - stepStarted };
    results.push(complete);
    console.log(`${complete.status} ${complete.label}`);
  }
  if (options.restart && !restartHandled) {
    infrastructureFailure = true;
    results.push({ id: "runtime-restart", label: "Runtime restart", type: "runtime", status: "FAIL", exitCode: null, durationMs: 0, details: {}, error: "No runtime step configured for requested restart" });
  }
  const hasFailure = results.some((result) => result.status === "FAIL");
  const hasWarning = results.some((result) => result.status === "WARNING");
  const exitCode: ValidationExitCode = infrastructureFailure ? 2 : hasFailure ? 1 : 0;
  const status: ValidationStatus = hasFailure ? "FAIL" : hasWarning ? "WARNING" : "PASS";
  const completed = Date.now();
  const report: ValidationReport = {
    schemaVersion: 1,
    technicalCode: "FORGE_VALIDATE_01",
    startedAt,
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - started,
    commit: context.commit,
    branch: context.branch,
    status,
    exitCode,
    runtime,
    http: context.http,
    results,
    errors: results.flatMap((result) => result.error ? [`${result.id}: ${result.error}`] : []),
  };
  const reportPath = confinedPath(options.root, options.reportPath ?? options.config.reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`${status} validation-report ${path.relative(options.root, reportPath)}`);
  return report;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const configPath = path.resolve(repoRoot, argument("--config") ?? "config/forge-validation.json");
  const config = parseValidationConfig(fs.readFileSync(configPath, "utf8"));
  const report = await runValidation({ root: repoRoot, config, restart: process.argv.includes("--restart"), reportPath: argument("--report") });
  process.exitCode = report.exitCode;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(`FAIL validation-framework ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; });