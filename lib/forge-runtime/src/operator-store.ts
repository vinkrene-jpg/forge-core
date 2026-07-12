import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  ProjectMemoryEntry,
  ProjectRecord,
  PromptComposition,
} from "./operator";

export const OPERATOR_STORE_VERSION = 1 as const;

export interface PersistedOperatorState {
  readonly version: typeof OPERATOR_STORE_VERSION;
  readonly projects: readonly ProjectRecord[];
  readonly memories: readonly ProjectMemoryEntry[];
  readonly compositions: readonly PromptComposition[];
}

export interface OperatorStateStore {
  load(): Promise<PersistedOperatorState>;
  save(state: PersistedOperatorState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requiredString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is invalid`);
  }
}

function validateState(
  value: unknown,
): asserts value is PersistedOperatorState {
  if (!isRecord(value)) {
    throw new Error("Persisted operator state must be an object");
  }

  if (value.version !== OPERATOR_STORE_VERSION) {
    throw new Error("Unsupported operator store version");
  }

  if (
    !Array.isArray(value.projects) ||
    !Array.isArray(value.memories) ||
    !Array.isArray(value.compositions)
  ) {
    throw new Error("Persisted operator collections are invalid");
  }

  for (const project of value.projects) {
    if (!isRecord(project)) {
      throw new Error("Persisted project is invalid");
    }

    requiredString(project.id, "project.id");
    requiredString(project.name, "project.name");
    requiredString(project.rootPath, "project.rootPath");
  }

  for (const memory of value.memories) {
    if (!isRecord(memory)) {
      throw new Error("Persisted memory is invalid");
    }

    requiredString(memory.id, "memory.id");
    requiredString(memory.projectId, "memory.projectId");
    requiredString(memory.content, "memory.content");
  }

  for (const composition of value.compositions) {
    if (!isRecord(composition)) {
      throw new Error("Persisted composition is invalid");
    }

    requiredString(composition.id, "composition.id");
    requiredString(
      composition.projectId,
      "composition.projectId",
    );
    requiredString(
      composition.content,
      "composition.content",
    );
  }
}

export function createInitialOperatorState():
  PersistedOperatorState {
  return Object.freeze({
    version: OPERATOR_STORE_VERSION,
    projects: Object.freeze([]),
    memories: Object.freeze([]),
    compositions: Object.freeze([]),
  });
}

export function resolveOperatorStatePath(): string {
  const explicitPath =
    process.env.FORGE_OPERATOR_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() ||
    path.resolve("storage");

  return path.join(
    storageRoot,
    "forge-runtime",
    "operator-core.json",
  );
}

export class FileOperatorStateStore
  implements OperatorStateStore
{
  readonly #filePath: string;

  constructor(filePath = resolveOperatorStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedOperatorState> {
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
        return createInitialOperatorState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Operator state contains invalid JSON: " +
          this.#filePath,
      );
    }

    validateState(parsed);

    return Object.freeze({
      version: parsed.version,
      projects: Object.freeze(parsed.projects),
      memories: Object.freeze(parsed.memories),
      compositions: Object.freeze(parsed.compositions),
    });
  }

  async save(state: PersistedOperatorState): Promise<void> {
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