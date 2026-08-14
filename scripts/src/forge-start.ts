import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
  const resolvedPort = environment.PORT?.trim() || "5000";
  const apiUrl = `http://127.0.0.1:${resolvedPort}`;
  const providers = configuredProviders(environment);

  console.log(`[forge:start] API URL: ${apiUrl}`);
  console.log(`[forge:start] UI URL: ${apiUrl}`);
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
