import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { KernelStatus } from "./runtime-state";

export const RUNTIME_STATE_VERSION = 1 as const;

export interface PersistedRuntimeState {
  readonly version: typeof RUNTIME_STATE_VERSION;
  readonly runtimeId: string;
  readonly sessionId: string | null;
  readonly restartCount: number;
  readonly recoveryCount: number;
  readonly lastKnownKernelStatus: KernelStatus;
  readonly lastStartedAt: string | null;
  readonly lastStoppedAt: string | null;
  readonly updatedAt: string;
  readonly lastShutdownClean: boolean;
  readonly recoveredFromStatus: KernelStatus | null;
  readonly lastError: string | null;
}

export interface RuntimeStateStore {
  load(): Promise<PersistedRuntimeState | null>;
  save(state: PersistedRuntimeState): Promise<void>;
}

const kernelStatuses = new Set<KernelStatus>([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed",
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function assertPersistedRuntimeState(
  value: unknown,
): asserts value is PersistedRuntimeState {
  if (typeof value !== "object" || value === null) {
    throw new Error("Persisted runtime state must be an object");
  }

  const state = value as Record<string, unknown>;

  if (state.version !== RUNTIME_STATE_VERSION) {
    throw new Error("Unsupported runtime state version");
  }

  if (typeof state.runtimeId !== "string" || state.runtimeId.length === 0) {
    throw new Error("Persisted runtimeId is invalid");
  }

  if (!isNullableString(state.sessionId)) {
    throw new Error("Persisted sessionId is invalid");
  }

  if (
    !Number.isInteger(state.restartCount) ||
    Number(state.restartCount) < 0
  ) {
    throw new Error("Persisted restartCount is invalid");
  }

  if (
    !Number.isInteger(state.recoveryCount) ||
    Number(state.recoveryCount) < 0
  ) {
    throw new Error("Persisted recoveryCount is invalid");
  }

  if (
    !kernelStatuses.has(
      state.lastKnownKernelStatus as KernelStatus,
    )
  ) {
    throw new Error("Persisted kernel status is invalid");
  }

  if (!isNullableString(state.lastStartedAt)) {
    throw new Error("Persisted lastStartedAt is invalid");
  }

  if (!isNullableString(state.lastStoppedAt)) {
    throw new Error("Persisted lastStoppedAt is invalid");
  }

  if (typeof state.updatedAt !== "string") {
    throw new Error("Persisted updatedAt is invalid");
  }

  if (typeof state.lastShutdownClean !== "boolean") {
    throw new Error("Persisted lastShutdownClean is invalid");
  }

  if (
    state.recoveredFromStatus !== null &&
    !kernelStatuses.has(state.recoveredFromStatus as KernelStatus)
  ) {
    throw new Error("Persisted recoveredFromStatus is invalid");
  }

  if (!isNullableString(state.lastError)) {
    throw new Error("Persisted lastError is invalid");
  }
}

export function createInitialRuntimeState(): PersistedRuntimeState {
  return Object.freeze({
    version: RUNTIME_STATE_VERSION,
    runtimeId: randomUUID(),
    sessionId: null,
    restartCount: 0,
    recoveryCount: 0,
    lastKnownKernelStatus: "stopped",
    lastStartedAt: null,
    lastStoppedAt: null,
    updatedAt: new Date().toISOString(),
    lastShutdownClean: true,
    recoveredFromStatus: null,
    lastError: null,
  });
}

export function resolveRuntimeStatePath(): string {
  const explicitPath =
    process.env.FORGE_RUNTIME_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() || path.resolve("storage");

  return path.join(
    storageRoot,
    "forge-runtime",
    "runtime-state.json",
  );
}

export class FileRuntimeStateStore implements RuntimeStateStore {
  readonly #filePath: string;

  constructor(filePath = resolveRuntimeStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedRuntimeState | null> {
    let raw: string;

    try {
      raw = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Runtime state file contains invalid JSON: " +
          this.#filePath,
      );
    }

    assertPersistedRuntimeState(parsed);

    return Object.freeze({ ...parsed });
  }

  async save(state: PersistedRuntimeState): Promise<void> {
    const directory = path.dirname(this.#filePath);

    await mkdir(directory, { recursive: true });

    const temporaryPath =
      this.#filePath +
      "." +
      process.pid +
      "." +
      Date.now() +
      ".tmp";

    await writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2) + "\n",
      "utf8",
    );

    try {
      await rename(temporaryPath, this.#filePath);
    } catch {
      await rm(this.#filePath, { force: true });
      await rename(temporaryPath, this.#filePath);
    }
  }
}