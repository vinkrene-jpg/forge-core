import { cp, mkdir, readdir, readlink, symlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const step = process.argv[2];
const fullRepository = process.argv[3] === "full";
const allowedRoots = ["sandbox", "lib", "artifacts"];
const protectedNames = new Set([
  ".env", ".npmrc", ".pnpmfile.cjs", "package.json", "package-lock.json",
  "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "id_rsa", "id_ed25519",
]);

function protectedEntry(name, candidate) {
  return (candidate && protectedNames.has(name)) || name.startsWith(".env")
    || name === ".npmrc" || name.endsWith(".key") || name.endsWith(".pem")
    || (candidate && name === "node_modules");
}

async function overlay(source, destination, candidate) {
  await mkdir(destination, { recursive: true });
  let entries;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (protectedEntry(entry.name, candidate)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await overlay(from, to, candidate);
    else if (entry.isFile()) await cp(from, to, { force: true });
    else if (entry.isSymbolicLink() && !candidate) {
      await symlink(await readlink(from), to);
    }
  }
}

for (const root of allowedRoots) {
  await overlay(`/baseline/${root}`, `/forge/${root}`, false);
  await overlay(`/candidate/${root}`, `/forge/${root}`, true);
}

const typecheckCommands = [
  ["exec", "tsc", "--build", "--force"],
  ["--filter", "@workspace/forge-runtime", "run", "typecheck"],
  ["-r", "--filter", "./artifacts/**", "--if-present", "run", "typecheck"],
  ["exec", "tsc", "-p", "scripts/tsconfig.json", "--noEmit", "--incremental", "false"],
];
const commands = step === "typecheck"
  ? typecheckCommands
  : step === "build"
    ? [...typecheckCommands, ["-r", "--if-present", "run", "build"]]
    : [fullRepository
      ? ["-r", "--if-present", "test"]
      : ["--filter", "@workspace/forge-runtime", "test"]];
const environment = {
  PATH: process.env.PATH,
  HOME: "/tmp/forge-home",
  COREPACK_HOME: "/corepack",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  PNPM_HOME: "/pnpm",
  CI: "1",
  NODE_ENV: "test",
  STORAGE_DIR: "/tmp/forge-storage",
  FORGE_RUNTIME_BUILD_SHA: process.env.FORGE_RUNTIME_BUILD_SHA,
  npm_config_ignore_scripts: "true",
  npm_config_offline: "true",
  npm_config_verify_deps_before_run: "false",
  PNPM_IGNORE_SCRIPTS: "true",
};

for (const command of commands) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn("pnpm", [
      "--config.offline=true",
      "--config.verify-deps-before-run=false",
      ...command,
    ], {
      cwd: "/forge",
      stdio: "inherit",
      env: environment,
    });
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) process.exit(code);
}