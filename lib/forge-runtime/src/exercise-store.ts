import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExerciseAttemptRecord, ExerciseRecord } from "./exercise";

export const EXERCISE_STORE_VERSION = 1 as const;

export interface PersistedExerciseState {
  readonly version: typeof EXERCISE_STORE_VERSION;
  readonly exercises: readonly ExerciseRecord[];
  readonly attempts: readonly ExerciseAttemptRecord[];
  readonly acquiredTracks: readonly {
    readonly source: "exercism";
    readonly track: string;
    readonly repository: string;
    readonly revision: string;
    readonly acquiredAt: string;
  }[];
}

export interface ExerciseStateStore {
  load(): Promise<PersistedExerciseState>;
  save(state: PersistedExerciseState): Promise<void>;
}

export function createInitialExerciseState(): PersistedExerciseState {
  return Object.freeze({
    version: EXERCISE_STORE_VERSION,
    exercises: Object.freeze([]),
    attempts: Object.freeze([]),
    acquiredTracks: Object.freeze([]),
  });
}

function validateState(value: unknown): asserts value is PersistedExerciseState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Persisted exercise state must be an object");
  }

  const state = value as Record<string, unknown>;
  if (state.version !== EXERCISE_STORE_VERSION) {
    throw new Error("Unsupported exercise store version");
  }
  if (!Array.isArray(state.exercises) || !Array.isArray(state.attempts) || !Array.isArray(state.acquiredTracks)) {
    throw new Error("Persisted exercise collections are invalid");
  }
}

export function resolveExerciseStatePath(): string {
  const explicit = process.env.FORGE_EXERCISE_STATE_PATH?.trim();
  if (explicit) return explicit;
  const storageRoot = process.env.STORAGE_DIR?.trim() || path.resolve("storage");
  return path.join(storageRoot, "forge-runtime", "exercise-registry.json");
}

export class FileExerciseStateStore implements ExerciseStateStore {
  readonly #filePath: string;

  constructor(filePath = resolveExerciseStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedExerciseState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#filePath, "utf8"));
      validateState(parsed);
      return parsed;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return createInitialExerciseState();
      }
      throw error;
    }
  }

  async save(state: PersistedExerciseState): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    try {
      await rename(temporaryPath, this.#filePath);
    } catch {
      await rm(this.#filePath, { force: true });
      await rename(temporaryPath, this.#filePath);
    }
  }
}