import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  CapabilityAnalysisRecord,
  CapabilityRecord,
  EvolutionPlanRecord,
} from "./capability";

export const CAPABILITY_STORE_VERSION = 1 as const;

export interface PersistedCapabilityState {
  readonly version: typeof CAPABILITY_STORE_VERSION;
  readonly capabilities: readonly CapabilityRecord[];
  readonly analyses: readonly CapabilityAnalysisRecord[];
  readonly plans: readonly EvolutionPlanRecord[];
}

export interface CapabilityStateStore {
  load(): Promise<PersistedCapabilityState>;
  save(state: PersistedCapabilityState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is invalid`);
  }
}

function assertPersistedCapabilityState(
  value: unknown,
): asserts value is PersistedCapabilityState {
  if (!isRecord(value)) {
    throw new Error("Persisted capability state must be an object");
  }

  if (value.version !== CAPABILITY_STORE_VERSION) {
    throw new Error("Unsupported capability store version");
  }

  if (!Array.isArray(value.capabilities)) {
    throw new Error("Persisted capabilities must be an array");
  }

  if (!Array.isArray(value.analyses)) {
    throw new Error("Persisted analyses must be an array");
  }

  if (!Array.isArray(value.plans)) {
    throw new Error("Persisted plans must be an array");
  }

  for (const capability of value.capabilities) {
    if (!isRecord(capability)) {
      throw new Error("Persisted capability is invalid");
    }

    assertString(capability.id, "capability.id");
    assertString(capability.name, "capability.name");
    assertString(capability.description, "capability.description");
    assertString(capability.version, "capability.version");
    assertString(capability.source, "capability.source");
    assertString(capability.createdAt, "capability.createdAt");
    assertString(capability.updatedAt, "capability.updatedAt");
  }

  for (const analysis of value.analyses) {
    if (!isRecord(analysis)) {
      throw new Error("Persisted capability analysis is invalid");
    }

    assertString(analysis.id, "analysis.id");
    assertString(analysis.objective, "analysis.objective");
    assertString(analysis.createdAt, "analysis.createdAt");
  }

  for (const plan of value.plans) {
    if (!isRecord(plan)) {
      throw new Error("Persisted evolution plan is invalid");
    }

    assertString(plan.id, "plan.id");
    assertString(plan.analysisId, "plan.analysisId");
    assertString(plan.objective, "plan.objective");
    assertString(plan.createdAt, "plan.createdAt");
    assertString(plan.updatedAt, "plan.updatedAt");
  }
}

export function createInitialCapabilityState(): PersistedCapabilityState {
  return Object.freeze({
    version: CAPABILITY_STORE_VERSION,
    capabilities: Object.freeze([]),
    analyses: Object.freeze([]),
    plans: Object.freeze([]),
  });
}

export function resolveCapabilityStatePath(): string {
  const explicitPath =
    process.env.FORGE_CAPABILITY_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() || path.resolve("storage");

  return path.join(
    storageRoot,
    "forge-runtime",
    "capabilities.json",
  );
}

export class FileCapabilityStateStore
  implements CapabilityStateStore
{
  readonly #filePath: string;

  constructor(filePath = resolveCapabilityStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedCapabilityState> {
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
        return createInitialCapabilityState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Capability state file contains invalid JSON: " +
          this.#filePath,
      );
    }

    assertPersistedCapabilityState(parsed);

    return Object.freeze({
      version: parsed.version,
      capabilities: Object.freeze(parsed.capabilities),
      analyses: Object.freeze(parsed.analyses),
      plans: Object.freeze(parsed.plans),
    });
  }

  async save(state: PersistedCapabilityState): Promise<void> {
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