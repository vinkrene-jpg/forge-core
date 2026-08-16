import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AiExecutionRecord,
} from "./ai-gateway";

export const AI_GATEWAY_STORE_VERSION = 2 as const;

export interface PersistedAiGatewayState {
  readonly version: typeof AI_GATEWAY_STORE_VERSION;
  readonly executions: readonly AiExecutionRecord[];
}

export interface AiGatewayStateStore {
  load(): Promise<PersistedAiGatewayState>;
  save(state: PersistedAiGatewayState): Promise<void>;
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
): asserts value is PersistedAiGatewayState {
  if (!isRecord(value)) {
    throw new Error("Persisted AI Gateway state must be an object");
  }

  if (value.version !== 1 && value.version !== AI_GATEWAY_STORE_VERSION) {
    throw new Error("Unsupported AI Gateway store version");
  }

  if (!Array.isArray(value.executions)) {
    throw new Error("Persisted AI executions must be an array");
  }

  for (const execution of value.executions) {
    if (!isRecord(execution)) {
      throw new Error("Persisted AI execution is invalid");
    }

    requiredString(execution.id, "execution.id");
    if (
      execution.missionId !== undefined &&
      execution.missionId !== null &&
      typeof execution.missionId !== "string"
    ) {
      throw new Error("execution.missionId is invalid");
    }
    requiredString(
      execution.compositionId,
      "execution.compositionId",
    );
    requiredString(
      execution.projectId,
      "execution.projectId",
    );
    requiredString(
      execution.routeProfileId,
      "execution.routeProfileId",
    );
    requiredString(
      execution.createdAt,
      "execution.createdAt",
    );

    if (
      execution.estimatedCostUsd !== undefined &&
      (typeof execution.estimatedCostUsd !== "number" ||
        execution.estimatedCostUsd < 0)
    ) {
      throw new Error("execution.estimatedCostUsd is invalid");
    }
  }
}

export function createInitialAiGatewayState():
  PersistedAiGatewayState {
  return Object.freeze({
    version: AI_GATEWAY_STORE_VERSION,
    executions: Object.freeze([]),
  });
}

export function resolveAiGatewayStatePath(): string {
  const explicitPath =
    process.env.FORGE_AI_GATEWAY_STATE_PATH?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  const storageRoot =
    process.env.STORAGE_DIR?.trim() ||
    path.resolve("storage");

  return path.join(
    storageRoot,
    "forge-runtime",
    "ai-gateway.json",
  );
}

export class FileAiGatewayStateStore
  implements AiGatewayStateStore
{
  readonly #filePath: string;

  constructor(filePath = resolveAiGatewayStatePath()) {
    this.#filePath = filePath;
  }

  async load(): Promise<PersistedAiGatewayState> {
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
        return createInitialAiGatewayState();
      }

      throw error;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "AI Gateway state contains invalid JSON: " +
          this.#filePath,
      );
    }

    validateState(parsed);

    return Object.freeze({
      version: AI_GATEWAY_STORE_VERSION,
      executions: Object.freeze(
        parsed.executions.map((execution) =>
          Object.freeze({
            ...execution,
            missionId: execution.missionId ?? null,
            estimatedCostUsd:
              typeof execution.estimatedCostUsd === "number"
                ? execution.estimatedCostUsd
                : 0,
            reservedCostUsd:
              typeof execution.reservedCostUsd === "number"
                ? execution.reservedCostUsd
                : 0,
            spendMandateId:
              typeof execution.spendMandateId === "string"
                ? execution.spendMandateId
                : null,
            maximumRunCostUsd:
              typeof execution.maximumRunCostUsd === "number"
                ? execution.maximumRunCostUsd
                : null,
            maximumDailyCostUsd:
              typeof execution.maximumDailyCostUsd === "number"
                ? execution.maximumDailyCostUsd
                : null,
          }),
        ),
      ),
    });
  }

  async save(state: PersistedAiGatewayState): Promise<void> {
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
