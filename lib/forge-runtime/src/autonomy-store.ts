import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  cloneAutonomyState,
  createInitialAutonomyState,
  type AutonomousRuntimeState,
} from "./autonomy";

export const AUTONOMY_STORE_VERSION = 1 as const;

export interface PersistedAutonomyState {
  readonly version: typeof AUTONOMY_STORE_VERSION;
  readonly state: AutonomousRuntimeState;
}

export interface AutonomyStateStore {
  load(): Promise<PersistedAutonomyState>;
  save(state: PersistedAutonomyState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validate(value: unknown): asserts value is PersistedAutonomyState {
  if (!isRecord(value)) {
    throw new Error("Persisted autonomy state must be an object");
  }

  if (value.version !== AUTONOMY_STORE_VERSION) {
    throw new Error("Unsupported autonomy store version");
  }

  if (!isRecord(value.state)) {
    throw new Error("Autonomy state payload is invalid");
  }

  if (typeof value.state.enabled !== "boolean") {
    throw new Error("Autonomy state enabled flag is invalid");
  }

  if (
    value.state.loopStatus !== "stopped" &&
    value.state.loopStatus !== "running"
  ) {
    throw new Error("Autonomy loop status is invalid");
  }

  if (!Array.isArray(value.state.backlog)) {
    throw new Error("Autonomy backlog is invalid");
  }
}

export function createInitialPersistedAutonomyState(): PersistedAutonomyState {
  return Object.freeze({
    version: AUTONOMY_STORE_VERSION,
    state: createInitialAutonomyState(),
  });
}

export function resolveAutonomyStatePath(): string {
  const explicitPath = process.env.FORGE_AUTONOMY_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() || path.resolve("storage");

  return path.join(storageRoot, "forge-runtime", "autonomy.json");
}

export class FileAutonomyStateStore implements AutonomyStateStore {
  readonly #filePath: string;

  constructor(filePath = resolveAutonomyStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedAutonomyState> {
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
        return createInitialPersistedAutonomyState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Autonomy state contains invalid JSON: " + this.#filePath,
      );
    }

    validate(parsed);

    return Object.freeze({
      version: parsed.version,
      state: cloneAutonomyState(parsed.state),
    });
  }

  async save(state: PersistedAutonomyState): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });

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
