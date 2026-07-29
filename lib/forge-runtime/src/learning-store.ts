import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  LearningCapabilityProfile,
  LearningMissionProposal,
  LearningObservation,
} from "./learning";

export const LEARNING_STORE_VERSION = 1 as const;

export interface PersistedLearningState {
  readonly version: typeof LEARNING_STORE_VERSION;
  readonly observations: readonly LearningObservation[];
  readonly profiles: readonly LearningCapabilityProfile[];
  readonly proposals: readonly LearningMissionProposal[];
}

export interface LearningStateStore {
  load(): Promise<PersistedLearningState>;
  save(state: PersistedLearningState): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
): asserts value is PersistedLearningState {
  if (!isRecord(value)) {
    throw new Error("Persisted learning state must be an object");
  }

  if (value.version !== LEARNING_STORE_VERSION) {
    throw new Error("Unsupported learning store version");
  }

  if (
    !Array.isArray(value.observations) ||
    !Array.isArray(value.profiles) ||
    !Array.isArray(value.proposals)
  ) {
    throw new Error("Persisted learning collections are invalid");
  }

  for (const observation of value.observations) {
    if (!isRecord(observation)) {
      throw new Error("Persisted learning observation is invalid");
    }

    requiredString(observation.id, "observation.id");
    requiredString(observation.missionId, "observation.missionId");
    requiredString(observation.executionId, "observation.executionId");
    requiredString(observation.evaluationId, "observation.evaluationId");
  }

  for (const profile of value.profiles) {
    if (!isRecord(profile)) {
      throw new Error("Persisted learning profile is invalid");
    }

    requiredString(profile.capabilityId, "profile.capabilityId");

    if (typeof profile.score !== "number") {
      throw new Error("profile.score is invalid");
    }
  }

  for (const proposal of value.proposals) {
    if (!isRecord(proposal)) {
      throw new Error("Persisted learning proposal is invalid");
    }

    requiredString(proposal.id, "proposal.id");
    requiredString(proposal.targetCapabilityId, "proposal.targetCapabilityId");
  }
}

export function createInitialLearningState(): PersistedLearningState {
  return Object.freeze({
    version: LEARNING_STORE_VERSION,
    observations: Object.freeze([]),
    profiles: Object.freeze([]),
    proposals: Object.freeze([]),
  });
}

export function resolveLearningStatePath(): string {
  const explicitPath = process.env.FORGE_LEARNING_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() || path.resolve("storage");

  return path.join(storageRoot, "forge-runtime", "learning-engine.json");
}

export class FileLearningStateStore implements LearningStateStore {
  readonly #filePath: string;

  constructor(filePath = resolveLearningStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedLearningState> {
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
        return createInitialLearningState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Learning state contains invalid JSON: " + this.#filePath,
      );
    }

    validateState(parsed);

    return Object.freeze({
      version: parsed.version,
      observations: Object.freeze(parsed.observations),
      profiles: Object.freeze(parsed.profiles),
      proposals: Object.freeze(parsed.proposals),
    });
  }

  async save(state: PersistedLearningState): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });

    const temporaryPath =
      this.#filePath + "." + process.pid + "." + Date.now() + ".tmp";

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
