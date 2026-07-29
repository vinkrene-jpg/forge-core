import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const resolvedPort = process.env.PORT?.trim() || "5000";
const apiUrl = `http://127.0.0.1:${resolvedPort}`;

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

console.log(`[forge:start] API URL: ${apiUrl}`);
console.log(`[forge:start] UI URL: ${apiUrl}`);
openBrowser(apiUrl);

const child = spawn(process.execPath, [entrypoint], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: resolvedPort,
    NODE_ENV: process.env.NODE_ENV?.trim() || "production",
    FORGE_AUTONOMY_ENABLED:
      process.env.FORGE_AUTONOMY_ENABLED?.trim() || "true",
    FORGE_MEMORY_BRIDGE_ROOT:
      process.env.FORGE_MEMORY_BRIDGE_ROOT?.trim() || "D:\\Forge\\memory",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
