// Shared static code scan used by the Quality Analyzer, Technical Debt
// Analyzer and Architecture Validator. Read-only.

import fs from "fs";
import path from "path";

export const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export interface ScannedFile {
  file: string;
  content: string;
  lines: number;
}

const SOURCE_DIRS = [
  "artifacts/api-server/src",
  "artifacts/forge-core/src",
  "lib/db/src",
  "scripts/src",
];

function listFilesRecursive(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(path.relative(workspaceRoot, full));
  }
  return out;
}

export function scanSourceFiles(): ScannedFile[] {
  const files = SOURCE_DIRS.flatMap((d) => listFilesRecursive(path.join(workspaceRoot, d), [".ts", ".tsx"]));
  return files.map((file) => {
    let content = "";
    try {
      content = fs.readFileSync(path.join(workspaceRoot, file), "utf8");
    } catch {
      /* unreadable file: treated as empty */
    }
    return { file, content, lines: content.length === 0 ? 0 : content.split("\n").length };
  });
}
