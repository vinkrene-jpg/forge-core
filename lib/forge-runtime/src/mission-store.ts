import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  MissionKind,
  MissionRecord,
  MissionStatus,
} from "./mission";

export const MISSION_STORE_VERSION = 1 as const;

export interface PersistedMissionState {
  readonly version: typeof MISSION_STORE_VERSION;
  readonly missions: readonly MissionRecord[];
}

export interface MissionStateStore {
  load(): Promise<PersistedMissionState>;
  save(state: PersistedMissionState): Promise<void>;
}

const missionKinds = new Set<MissionKind>([
  "runtime.self-check",
  "runtime.stability-window",
  "operator.autonomous-cycle",
]);

const missionStatuses = new Set<MissionStatus>([
  "awaiting_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertMissionRecord(
  value: unknown,
): asserts value is MissionRecord {
  if (!isRecord(value)) {
    throw new Error("Persisted mission must be an object");
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("Persisted mission id is invalid");
  }

  if (!missionKinds.has(value.kind as MissionKind)) {
    throw new Error("Persisted mission kind is invalid");
  }

  if (typeof value.title !== "string" || value.title.length === 0) {
    throw new Error("Persisted mission title is invalid");
  }

  if (!missionStatuses.has(value.status as MissionStatus)) {
    throw new Error("Persisted mission status is invalid");
  }

  for (const field of ["createdAt", "updatedAt"] as const) {
    if (typeof value[field] !== "string") {
      throw new Error(`Persisted mission ${field} is invalid`);
    }
  }

  if (!isNullableString(value.startedAt)) {
    throw new Error("Persisted mission startedAt is invalid");
  }

  if (!isNullableString(value.completedAt)) {
    throw new Error("Persisted mission completedAt is invalid");
  }

  if (!Number.isInteger(value.attempts) || Number(value.attempts) < 0) {
    throw new Error("Persisted mission attempts is invalid");
  }

  if (
    !Number.isInteger(value.interruptedCount) ||
    Number(value.interruptedCount) < 0
  ) {
    throw new Error("Persisted mission interruptedCount is invalid");
  }

  if (!isRecord(value.input)) {
    throw new Error("Persisted mission input is invalid");
  }

  if (value.output !== null && !isRecord(value.output)) {
    throw new Error("Persisted mission output is invalid");
  }

  if (!isNullableString(value.lastError)) {
    throw new Error("Persisted mission lastError is invalid");
  }
}

function assertPersistedMissionState(
  value: unknown,
): asserts value is PersistedMissionState {
  if (!isRecord(value)) {
    throw new Error("Persisted mission state must be an object");
  }

  if (value.version !== MISSION_STORE_VERSION) {
    throw new Error("Unsupported mission store version");
  }

  if (!Array.isArray(value.missions)) {
    throw new Error("Persisted missions must be an array");
  }

  for (const mission of value.missions) {
    assertMissionRecord(mission);
  }
}

export function createInitialMissionState(): PersistedMissionState {
  return Object.freeze({
    version: MISSION_STORE_VERSION,
    missions: Object.freeze([]),
  });
}

export function resolveMissionStatePath(): string {
  const explicitPath =
    process.env.FORGE_MISSION_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() || path.resolve("storage");

  return path.join(
    storageRoot,
    "forge-runtime",
    "missions.json",
  );
}

export class FileMissionStateStore implements MissionStateStore {
  readonly #filePath: string;

  constructor(filePath = resolveMissionStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedMissionState> {
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
        return createInitialMissionState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Mission state file contains invalid JSON: " +
          this.#filePath,
      );
    }

    assertPersistedMissionState(parsed);

    return Object.freeze({
      version: parsed.version,
      missions: Object.freeze(
        parsed.missions.map((mission) =>
          Object.freeze({
            ...mission,
            input: Object.freeze({ ...mission.input }),
            output:
              mission.output === null
                ? null
                : Object.freeze({ ...mission.output }),
          }),
        ),
      ),
    });
  }

  async save(state: PersistedMissionState): Promise<void> {
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
