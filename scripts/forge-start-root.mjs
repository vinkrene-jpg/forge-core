import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, "..");

function runPnpm(args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : "pnpm";
    const commandArgs = process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm.cmd", ...args]
      : args;

    const child = spawn(command, commandArgs, {
      cwd: repositoryRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`pnpm ${args.join(" ")} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`pnpm ${args.join(" ")} failed with exit code ${code ?? 1}`));
        return;
      }
      resolve();
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}

async function main() {
  await runPnpm(["run", "build"]);
  await runPnpm(["--filter", "@workspace/scripts", "run", "forge:start"]);
}

main().catch((error) => {
  console.error("[forge:start] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
