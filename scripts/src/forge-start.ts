import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, "../..");
const entrypoint = path.join(
  repositoryRoot,
  "artifacts",
  "api-server",
  "dist",
  "index.mjs",
);

const sensitiveEnvironmentName = /(TOKEN|KEY|SECRET)/i;

interface PortListener {
  readonly pid: number;
  readonly program: string;
  readonly executablePath: string;
  readonly commandLine: string;
  readonly runtimeRepositoryRoot: string;
}

export function loadRootEnvironment(
  root: string,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  let fileEnvironment: NodeJS.ProcessEnv = {};

  try {
    fileEnvironment = parseEnv(readFileSync(path.join(root, ".env"), "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return {
    ...fileEnvironment,
    ...inheritedEnvironment,
  };
}

export function formatEnvironmentDiagnostic(
  name: string,
  value: string | undefined,
): string {
  return `${name}=${sensitiveEnvironmentName.test(name) ? "[REDACTED]" : value ?? ""}`;
}

export function configuredProviders(
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const providers: string[] = [];

  if (environment.OPENAI_API_KEY?.trim()) providers.push("openai");
  if (environment.ANTHROPIC_API_KEY?.trim()) providers.push("anthropic");
  if (environment.CUSTOM_AI_API_KEY?.trim()) providers.push("custom-ai");
  if (environment.FORGE_LOCAL_MODEL_ENABLED?.trim() === "true") {
    providers.push("local-model");
  }

  return providers;
}

export function canonicalRepositoryRoot(
  root: string,
  environment: NodeJS.ProcessEnv,
): string {
  const configured = environment.FORGE_CANONICAL_REPO_ROOT?.trim();
  return realpathSync(
    configured ? path.resolve(root, configured) : path.resolve(root),
  );
}

export function assertCanonicalRepositoryRoot(
  runningRoot: string,
  canonicalRoot: string,
): void {
  const running = realpathSync(runningRoot);
  const canonical = realpathSync(canonicalRoot);
  const equal = process.platform === "win32"
    ? running.toLowerCase() === canonical.toLowerCase()
    : running === canonical;

  if (!equal) {
    throw new Error(
      `Forge repository root mismatch: running repository ${running}; canonical repository ${canonical}`,
    );
  }
}

function listenersOnPort(port: string): readonly PortListener[] {
  if (process.platform !== "win32") return [];

  const script = [
    `$listeners = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)`,
    "$runtimeRoot = ''",
    `try { $runtime = Invoke-RestMethod -Uri 'http://127.0.0.1:${port}/api/runtime' -TimeoutSec 2 -ErrorAction Stop; $runtimeRoot = [string]$runtime.binding.runtimeRepositoryRoot } catch {}`,
    "$result = @($listeners | ForEach-Object {",
    "  $process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($_.OwningProcess)\" -ErrorAction SilentlyContinue",
    "  [pscustomobject]@{ pid = [int]$_.OwningProcess; program = [string]$process.Name; executablePath = [string]$process.ExecutablePath; commandLine = [string]$process.CommandLine; runtimeRepositoryRoot = $runtimeRoot }",
    "})",
    "ConvertTo-Json -Compress -InputObject $result",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );

  if (result.status !== 0) {
    throw new Error(
      `Could not inspect port ${port}: ${result.stderr.trim() || "PowerShell failed"}`,
    );
  }

  const parsed = JSON.parse(result.stdout.trim() || "[]") as unknown;
  return Array.isArray(parsed) ? parsed as PortListener[] : [parsed as PortListener];
}

function listenerDirectory(listener: PortListener): string {
  const absoluteScript = listener.commandLine.match(
    /["']?([A-Za-z]:\\[^"']+?\.(?:mjs|cjs|js))["']?(?:\s|$)/i,
  )?.[1];
  return listener.runtimeRepositoryRoot ||
    path.dirname(absoluteScript || listener.executablePath || "unknown");
}

export function assertPortAvailable(port: string): void {
  const listeners = listenersOnPort(port);
  if (listeners.length === 0) return;

  const details = listeners.map((listener) =>
    `PID ${listener.pid}, program ${listener.program || "unknown"}, map ${listenerDirectory(listener)}, command ${listener.commandLine || "unknown"}`
  ).join("; ");
  throw new Error(`Port ${port} is already in use by ${details}`);
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      const opener = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      });
      opener.unref();
      return;
    }
    if (process.platform === "darwin") {
      const opener = spawn("open", [url], { detached: true, stdio: "ignore" });
      opener.unref();
      return;
    }
    const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    opener.unref();
  } catch {
    // If opening the browser fails, keep startup unaffected.
  }
}

export function main(): void {
  const environment = loadRootEnvironment(repositoryRoot);
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot, environment);
  assertCanonicalRepositoryRoot(repositoryRoot, canonicalRoot);
  const resolvedPort = environment.PORT?.trim() || "5000";
  const apiUrl = `http://127.0.0.1:${resolvedPort}`;
  const providers = configuredProviders(environment);

  assertPortAvailable(resolvedPort);

  console.log(`[forge:start] API URL: ${apiUrl}`);
  console.log(`[forge:start] UI URL: ${apiUrl}`);
  console.log(`[forge:start] Canonical repository: ${canonicalRoot}`);
  console.log(
    `[forge:start] Providers configured: ${providers.length > 0 ? providers.join(", ") : "none"}`,
  );
  openBrowser(apiUrl);

  const child = spawn(process.execPath, [entrypoint], {
    cwd: repositoryRoot,
    stdio: "inherit",
    env: {
      ...environment,
      PORT: resolvedPort,
      FORGE_CANONICAL_REPO_ROOT: canonicalRoot,
      FORGE_WORKSPACE_ROOT: environment.FORGE_WORKSPACE_ROOT?.trim() || canonicalRoot,
      NODE_ENV: environment.NODE_ENV?.trim() || "production",
      FORGE_AUTONOMY_ENABLED:
        environment.FORGE_AUTONOMY_ENABLED?.trim() || "true",
      FORGE_MEMORY_BRIDGE_ROOT:
        environment.FORGE_MEMORY_BRIDGE_ROOT?.trim() || "D:\\Forge\\memory",
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

const isMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMain) main();
