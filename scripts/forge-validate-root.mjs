import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwarded = process.argv.slice(2);
const tsxCli = path.join(root, "scripts", "node_modules", "tsx", "dist", "cli.mjs");
const args = [tsxCli, path.join(root, "scripts", "src", "forge-validate.ts"), ...forwarded];
const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
child.on("error", (error) => { console.error(`FAIL validation-framework ${error.message}`); process.exitCode = 2; });
child.on("exit", (code, signal) => { process.exitCode = signal ? 2 : code ?? 2; });