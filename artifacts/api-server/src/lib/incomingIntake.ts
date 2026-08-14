// Incoming-folder intake (step 3). Watches a configurable directory (default
// C:\Forge\incoming, override with FORGE_INCOMING_DIR) and turns each dropped
// file into an inert Claude Mirror intake mission under governance. Processed
// files move to <dir>/processed; rejected files move to <dir>/failed with a
// sibling .error.txt. Portable: the directory is configurable so it can live
// on D:\ or a NAS, and nothing is platform-specific.

import path from "node:path";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  rename as fsRename,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import type { CreateMissionRequest } from "@workspace/forge-runtime";
import {
  buildMirrorIntakeMissionRequest,
  FIELD_LIMITS,
  parseMirrorIntakeBody,
  type MirrorIntakeBody,
} from "./mirrorIntake";

const INTAKE_EXTENSIONS = new Set([".json", ".txt", ".md"]);

export interface IncomingIntakeConfig {
  readonly dir: string;
  readonly processedDir: string;
  readonly failedDir: string;
}

export interface IncomingIntakeFs {
  readonly readdir: (dir: string) => Promise<readonly string[]>;
  readonly readFile: (file: string) => Promise<string>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly mkdir: (dir: string) => Promise<void>;
  readonly writeFile: (file: string, data: string) => Promise<void>;
}

export interface IncomingIntakeDeps {
  readonly config: IncomingIntakeConfig;
  readonly createMission: (
    request: CreateMissionRequest,
  ) => Promise<{ readonly mission: { readonly id: string } }>;
  readonly fs?: IncomingIntakeFs;
  readonly now?: () => number;
  readonly log?: (
    level: "info" | "warn" | "error",
    message: string,
    meta?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface IncomingIntakeItemResult {
  readonly file: string;
  readonly status: "processed" | "failed";
  readonly missionId?: string;
  readonly error?: string;
}

export interface IncomingIntakeRunSummary {
  readonly processed: readonly IncomingIntakeItemResult[];
  readonly failed: readonly IncomingIntakeItemResult[];
}

const defaultFs: IncomingIntakeFs = {
  readdir: (dir) => fsReaddir(dir),
  readFile: (file) => fsReadFile(file, "utf8"),
  rename: (from, to) => fsRename(from, to),
  mkdir: async (dir) => {
    await fsMkdir(dir, { recursive: true });
  },
  writeFile: (file, data) => fsWriteFile(file, data, "utf8"),
};

export function resolveIncomingConfig(
  env: NodeJS.ProcessEnv = process.env,
): IncomingIntakeConfig {
  const dir = env.FORGE_INCOMING_DIR?.trim() || path.resolve("incoming");
  const processedDir =
    env.FORGE_INCOMING_PROCESSED_DIR?.trim() || path.join(dir, "processed");
  const failedDir =
    env.FORGE_INCOMING_FAILED_DIR?.trim() || path.join(dir, "failed");
  return Object.freeze({ dir, processedDir, failedDir });
}

export function resolveIncomingPollMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.FORGE_INCOMING_POLL_MS?.trim() || "5000");
  if (!Number.isFinite(raw) || raw < 500) return 5_000;
  return Math.min(Math.round(raw), 3_600_000);
}

function sanitizeRequestId(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[^a-zA-Z0-9._:-]+/g, "-").replace(/^[^a-zA-Z0-9]+/, "");
  const bounded = (cleaned || "incoming").slice(0, FIELD_LIMITS.requestId);
  return `incoming-${bounded}`.slice(0, FIELD_LIMITS.requestId);
}

function firstLine(text: string, fallback: string): string {
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  return (line ?? fallback).slice(0, FIELD_LIMITS.title);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns a dropped file's contents into a validated intake body. A `.json` file
 * is read as a (possibly partial) intake body; any other file is treated as a
 * plain-text objective. Missing identity fields are defaulted deterministically
 * from the file name so re-processing the same file is idempotent.
 */
export function buildIntakeBodyFromContent(
  raw: string,
  fileName: string,
): MirrorIntakeBody {
  const requestId = sanitizeRequestId(fileName);
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Incoming .json file is not valid JSON");
    }
    if (!isRecord(parsed)) {
      throw new Error("Incoming .json file must contain an object");
    }
    return parseMirrorIntakeBody({
      requestId: parsed.requestId ?? requestId,
      title: parsed.title ?? firstLine(String(parsed.objective ?? fileName), fileName),
      objective: parsed.objective,
      context: parsed.context ?? "",
      requestedBy: parsed.requestedBy ?? "incoming-folder",
      priority: parsed.priority ?? "NORMAL",
      projectId: parsed.projectId ?? null,
      constraints: parsed.constraints,
      acceptanceCriteria: parsed.acceptanceCriteria,
    });
  }

  const objective = raw.trim();
  if (objective.length === 0) {
    throw new Error("Incoming file is empty");
  }
  return parseMirrorIntakeBody({
    requestId,
    title: firstLine(objective, fileName),
    objective,
    context: "",
    requestedBy: "incoming-folder",
    priority: "NORMAL",
    projectId: null,
  });
}

export function isIntakeFile(fileName: string): boolean {
  if (fileName.startsWith(".")) return false;
  if (fileName.toLowerCase().endsWith(".error.txt")) return false;
  return INTAKE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

async function moveInto(
  fs: IncomingIntakeFs,
  fromPath: string,
  targetDir: string,
  fileName: string,
  stamp: number,
): Promise<void> {
  await fs.mkdir(targetDir);
  await fs.rename(fromPath, path.join(targetDir, `${stamp}-${fileName}`));
}

async function processIncomingFile(
  deps: IncomingIntakeDeps,
  fileName: string,
): Promise<IncomingIntakeItemResult> {
  const fs = deps.fs ?? defaultFs;
  const now = deps.now ?? Date.now;
  const stamp = now();
  const fromPath = path.join(deps.config.dir, fileName);

  try {
    const raw = await fs.readFile(fromPath);
    const body = buildIntakeBodyFromContent(raw, fileName);
    const request = buildMirrorIntakeMissionRequest(body);
    const result = await deps.createMission(request);
    await moveInto(fs, fromPath, deps.config.processedDir, fileName, stamp);
    deps.log?.("info", "Incoming file accepted as mission", {
      file: fileName,
      missionId: result.mission.id,
    });
    return Object.freeze({ file: fileName, status: "processed", missionId: result.mission.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
    try {
      await fs.mkdir(deps.config.failedDir);
      await fs.writeFile(
        path.join(deps.config.failedDir, `${fileName}.error.txt`),
        `${new Date(stamp).toISOString()} ${message}\n`,
      );
      await moveInto(fs, fromPath, deps.config.failedDir, fileName, stamp);
    } catch {
      // If we cannot even quarantine the file, surface the original error only.
    }
    deps.log?.("warn", "Incoming file rejected", { file: fileName, error: message });
    return Object.freeze({ file: fileName, status: "failed", error: message });
  }
}

/**
 * Processes every intake file currently in the incoming directory once. Missing
 * directory is treated as empty (and created). Never throws.
 */
export async function processIncomingDirectory(
  deps: IncomingIntakeDeps,
): Promise<IncomingIntakeRunSummary> {
  const fs = deps.fs ?? defaultFs;
  const processed: IncomingIntakeItemResult[] = [];
  const failed: IncomingIntakeItemResult[] = [];

  let entries: readonly string[];
  try {
    entries = await fs.readdir(deps.config.dir);
  } catch {
    try {
      await fs.mkdir(deps.config.dir);
    } catch {
      // ignore; nothing to process this tick
    }
    return Object.freeze({ processed: Object.freeze([]), failed: Object.freeze([]) });
  }

  const files = [...entries].filter(isIntakeFile).sort();
  for (const fileName of files) {
    const result = await processIncomingFile(deps, fileName);
    if (result.status === "processed") {
      processed.push(result);
    } else {
      failed.push(result);
    }
  }

  return Object.freeze({
    processed: Object.freeze(processed),
    failed: Object.freeze(failed),
  });
}

/**
 * Background poller that periodically drains the incoming directory. A single
 * tick never overlaps itself and never throws out of the timer.
 */
export class IncomingIntakeService {
  readonly #deps: IncomingIntakeDeps;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #ticking = false;

  constructor(deps: IncomingIntakeDeps, intervalMs: number) {
    this.#deps = deps;
    this.#intervalMs = Number.isInteger(intervalMs) && intervalMs >= 500 ? intervalMs : 5_000;
  }

  get directory(): string {
    return this.#deps.config.dir;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#deps.log?.("info", "Incoming intake watching directory", {
      dir: this.#deps.config.dir,
      intervalMs: this.#intervalMs,
    });
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async runOnce(): Promise<IncomingIntakeRunSummary> {
    return processIncomingDirectory(this.#deps);
  }

  #schedule(delayMs: number): void {
    if (!this.#running) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#tick();
    }, delayMs);
  }

  async #tick(): Promise<void> {
    if (this.#ticking) {
      this.#schedule(this.#intervalMs);
      return;
    }
    this.#ticking = true;
    try {
      await processIncomingDirectory(this.#deps);
    } catch (error) {
      this.#deps.log?.("error", "Incoming intake tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#ticking = false;
      this.#schedule(this.#intervalMs);
    }
  }
}

/**
 * Constructs the incoming intake service from environment configuration, or
 * returns null when FORGE_INCOMING_ENABLED is not "true".
 */
export function initIncomingIntakeFromEnv(
  createMission: IncomingIntakeDeps["createMission"],
  log?: IncomingIntakeDeps["log"],
  env: NodeJS.ProcessEnv = process.env,
): IncomingIntakeService | null {
  if (env.FORGE_INCOMING_ENABLED?.trim() !== "true") {
    return null;
  }
  const deps: IncomingIntakeDeps = {
    config: resolveIncomingConfig(env),
    createMission,
    log,
  };
  return new IncomingIntakeService(deps, resolveIncomingPollMs(env));
}
