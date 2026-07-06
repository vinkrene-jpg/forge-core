import fs from "fs";
import path from "path";
import { logger } from "./logger";

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export const storageRoot: string = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(workspaceRoot, "storage");

export function ensureStorage(): void {
  for (const sub of ["", "sandboxes", "snapshots", "backups"]) {
    const dir = path.join(storageRoot, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info({ dir }, "Created storage directory");
    }
  }
}

export function sandboxDir(sandboxId: number): string {
  return path.join(storageRoot, "sandboxes", String(sandboxId));
}

export function ensureSandboxDir(sandboxId: number): string {
  const dir = sandboxDir(sandboxId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeSandboxDir(sandboxId: number): void {
  const dir = sandboxDir(sandboxId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

export function isStorageWritable(): boolean {
  try {
    ensureStorage();
    const probe = path.join(storageRoot, ".healthcheck");
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
