import { randomUUID } from "node:crypto";
import type { RuntimeEventBus } from "./event-bus";
import {
  AI_GATEWAY_STORE_VERSION,
  FileAiGatewayStateStore,
  type AiGatewayStateStore,
  type PersistedAiGatewayState,
} from "./ai-gateway-store";
import type {
  AiCostSummary,
  AiExecutionRecord,
  AiGatewayStatus,
  AiGatewaySummary,
  AiProviderConnector,
  AiProviderId,
  AiSpendMandate,
  AiUsage,
} from "./ai-gateway";
import type {
  PromptComposition,
} from "./operator";
import { OpenAiResponsesConnector } from "./openai-responses-connector";
import { LocalModelConnector } from "./local-model-connector";
import { ManualFallbackConnector } from "./manual-fallback-connector";

export interface AiGatewayEngineOptions {
  readonly events: RuntimeEventBus;
  readonly getComposition: (
    compositionId: string,
  ) => PromptComposition | null;
  readonly stateStore?: AiGatewayStateStore;
  readonly connectors?: readonly AiProviderConnector[];
}

function optionalPositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) {
    return fallback;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw new Error(
      `Configuration value must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return number;
}

function emptyUsage(): AiUsage {
  return Object.freeze({
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function cloneExecution(
  execution: AiExecutionRecord,
): AiExecutionRecord {
  return Object.freeze({
    ...execution,
    missionId: execution.missionId ?? null,
    usage: Object.freeze({ ...execution.usage }),
    estimatedCostUsd: execution.estimatedCostUsd,
    reservedCostUsd: execution.reservedCostUsd,
  });
}

function roundUsd(value: number): number {
  return Math.max(0, Math.round(value * 1_000_000) / 1_000_000);
}

function tokenRate(
  providerId: AiProviderId | null,
): { readonly inputPer1k: number; readonly outputPer1k: number } {
  if (providerId === "openai-responses") {
    const inputPer1k = Number(
      process.env.FORGE_OPENAI_INPUT_USD_PER_1K?.trim() || "0.005",
    );
    const outputPer1k = Number(
      process.env.FORGE_OPENAI_OUTPUT_USD_PER_1K?.trim() || "0.015",
    );

    return {
      inputPer1k: Number.isFinite(inputPer1k) ? inputPer1k : 0.005,
      outputPer1k: Number.isFinite(outputPer1k) ? outputPer1k : 0.015,
    };
  }

  return {
    inputPer1k: 0,
    outputPer1k: 0,
  };
}

function executionCost(
  providerId: AiProviderId | null,
  usage: AiUsage,
): number {
  const rates = tokenRate(providerId);
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  return roundUsd(
    (inputTokens / 1_000) * rates.inputPer1k +
      (outputTokens / 1_000) * rates.outputPer1k,
  );
}

function mandateMoney(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${field} must be between 0 and 1000000`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function reservedExecutionCost(
  providerId: AiProviderId,
  inputChars: number,
  maximumOutputTokens: number,
): number {
  if (providerId !== "openai-responses") return 0;
  const rates = tokenRate(providerId);
  const conservativeInputTokens = inputChars;
  const cost =
    (conservativeInputTokens / 1_000) * rates.inputPer1k +
    (maximumOutputTokens / 1_000) * rates.outputPer1k;
  return Math.ceil(cost * 1_000_000) / 1_000_000;
}

function utcDay(value: string): string {
  return value.slice(0, 10);
}

function chargedOrReserved(execution: AiExecutionRecord): number {
  return execution.status === "running"
    ? execution.reservedCostUsd
    : execution.estimatedCostUsd;
}

function localModelEnabled(): boolean {
  return process.env.FORGE_LOCAL_MODEL_ENABLED?.trim() === "true";
}

export class AiGatewayEngine {
  readonly #events: RuntimeEventBus;
  readonly #getComposition:
    AiGatewayEngineOptions["getComposition"];
  readonly #stateStore: AiGatewayStateStore;
  readonly #connectors:
    ReadonlyMap<AiProviderId, AiProviderConnector>;
  #state: PersistedAiGatewayState =
    Object.freeze({
      version: AI_GATEWAY_STORE_VERSION,
      executions: Object.freeze([]),
    });
  #initialized = false;
  #mutation = Promise.resolve();

  constructor(options: AiGatewayEngineOptions) {
    this.#events = options.events;
    this.#getComposition =
      options.getComposition;
    this.#stateStore =
      options.stateStore ??
      new FileAiGatewayStateStore();

    const connectors: readonly AiProviderConnector[] =
      options.connectors ?? [
        new OpenAiResponsesConnector(),
        new LocalModelConnector(),
        new ManualFallbackConnector(),
      ];

    this.#connectors = new Map(
      connectors.map((connector) => [
        connector.id,
        connector,
      ]),
    );
  }

  async #mutate<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    let release!: () => void;

    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.#mutation;
    this.#mutation = next;

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  #ensureInitialized(): void {
    if (!this.#initialized) {
      throw new Error(
        "AiGatewayEngine is not initialized",
      );
    }
  }

  async #save(
    state: PersistedAiGatewayState,
  ): Promise<void> {
    this.#state = Object.freeze({
      version: AI_GATEWAY_STORE_VERSION,
      executions: Object.freeze(
        state.executions.map(cloneExecution),
      ),
    });

    await this.#stateStore.save(this.#state);
  }

  async initialize(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#initialized) {
        return;
      }

      const loaded =
        await this.#stateStore.load();

      await this.#save(loaded);
      this.#initialized = true;

      const status = this.status();

      this.#events.publish("ai.gateway.loaded", {
        configured: status.configured,
        providerId: status.providerId,
        model: status.model,
        executions:
          this.#state.executions.length,
      });
    });
  }

  status(): AiGatewayStatus {
    const preferredProvider = process.env.FORGE_AI_PROVIDER?.trim();
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    const openAiModel = process.env.OPENAI_MODEL?.trim();
    const localModelRouteEnabled = localModelEnabled();

    const availableProviders: AiProviderId[] = [];

    if (
      this.#connectors.has("openai-responses") &&
      Boolean(openAiKey) &&
      Boolean(openAiModel)
    ) {
      availableProviders.push("openai-responses");
    }

    if (
      this.#connectors.has("local-model") &&
      localModelRouteEnabled
    ) {
      availableProviders.push("local-model");
    }

    if (this.#connectors.has("manual-fallback")) {
      availableProviders.push("manual-fallback");
    }

    const explicitProvider: AiProviderId | null =
      preferredProvider === "openai-responses" ||
      preferredProvider === "local-model" ||
      preferredProvider === "manual-fallback"
        ? preferredProvider
        : null;

    const fallbackProvider: AiProviderId =
      availableProviders.includes("local-model")
        ? "local-model"
        : availableProviders.includes("openai-responses")
          ? "openai-responses"
          : "manual-fallback";

    const providerId: AiProviderId | null =
      explicitProvider && availableProviders.includes(explicitProvider)
        ? explicitProvider
        : availableProviders.length > 0
          ? fallbackProvider
          : null;

    const configured = providerId !== null;

    const model =
      providerId === "openai-responses"
        ? openAiModel ?? null
        : providerId === "local-model"
          ? process.env.FORGE_LOCAL_MODEL_NAME?.trim() ||
            "qwen2.5-coder:7b"
          : providerId === "manual-fallback"
            ? "manual-fallback"
            : null;

    const apiBase =
      providerId === "openai-responses"
        ? process.env.OPENAI_BASE_URL?.trim() ||
          "https://api.openai.com/v1"
        : providerId === "local-model"
          ? process.env.FORGE_LOCAL_MODEL_BASE_URL?.trim() ||
            "http://127.0.0.1:11434/v1"
          : null;

    return Object.freeze({
      providerId,
      configured,
      secretConfigured: Boolean(openAiKey),
      model,
      apiBase,
      maxInputChars: optionalPositiveInteger(
        process.env.FORGE_AI_MAX_INPUT_CHARS,
        100_000,
        1_000,
        1_000_000,
      ),
      maxOutputTokens: optionalPositiveInteger(
        process.env.FORGE_AI_MAX_OUTPUT_TOKENS,
        1_200,
        64,
        32_000,
      ),
      note: configured
        ? `Provider policy active. Preferred execution route: ${providerId}.`
        : "Gateway is operational, but no provider route is configured.",
    });
  }

  summary(): AiGatewaySummary {
    this.#ensureInitialized();

    const status = this.status();
    let succeeded = 0;
    let failed = 0;
    let unavailable = 0;
    let totalEstimatedCostUsd = 0;
    const byProvider = new Map<AiProviderId, AiCostSummary>();

    for (const execution of this.#state.executions) {
      if (execution.status === "succeeded") {
        succeeded += 1;
      } else if (execution.status === "failed") {
        failed += 1;
      } else if (execution.status === "unavailable") {
        unavailable += 1;
      }

      totalEstimatedCostUsd += execution.estimatedCostUsd;

      const providerId = execution.providerId ?? "manual-fallback";
      const current = byProvider.get(providerId);

      byProvider.set(
        providerId,
        Object.freeze({
          providerId,
          executions: (current?.executions ?? 0) + 1,
          estimatedCostUsd: roundUsd(
            (current?.estimatedCostUsd ?? 0) + execution.estimatedCostUsd,
          ),
        }),
      );
    }

    const roundedTotalCost = roundUsd(totalEstimatedCostUsd);
    const currentUtcDay = utcDay(new Date().toISOString());
    const dailyEstimatedCostUsd = roundUsd(
      this.#state.executions
        .filter((execution) => utcDay(execution.createdAt) === currentUtcDay)
        .reduce((total, execution) => total + execution.estimatedCostUsd, 0),
    );

    return Object.freeze({
      configured: status.configured,
      providerId: status.providerId,
      model: status.model,
      executions: this.#state.executions.length,
      succeeded,
      failed,
      unavailable,
      totalEstimatedCostUsd: roundedTotalCost,
      dailyEstimatedCostUsd,
      budgetLimitUsd: 0,
      budgetRemainingUsd: 0,
      byProvider: Object.freeze([...byProvider.values()]),
      lastExecutionAt:
        this.#state.executions.at(-1)?.completedAt ??
        null,
    });
  }

  listExecutions():
    readonly AiExecutionRecord[] {
    this.#ensureInitialized();

    return this.#state.executions.map(
      cloneExecution,
    );
  }

  getExecution(
    executionId: string,
  ): AiExecutionRecord | null {
    this.#ensureInitialized();

    const execution =
      this.#state.executions.find(
        (candidate) =>
          candidate.id === executionId,
      );

    return execution
      ? cloneExecution(execution)
      : null;
  }

  async executeComposition(
    compositionId: string,
    missionId: string | null = null,
    spendMandate: AiSpendMandate | null = null,
  ): Promise<AiExecutionRecord> {
    this.#ensureInitialized();

    const composition =
      this.#getComposition(compositionId);

    if (!composition) {
      throw new Error(
        `Prompt composition not found: ${compositionId}`,
      );
    }

    const status = this.status();
    const providerId = this.#selectProvider(
      composition,
      status,
    );
    const providerModel =
      providerId === "openai-responses"
        ? process.env.OPENAI_MODEL?.trim() ?? null
        : providerId === "local-model"
          ? process.env.FORGE_LOCAL_MODEL_NAME?.trim() || "qwen2.5-coder:7b"
          : "manual-fallback";
    const timestamp =
      new Date().toISOString();
    const executionId = randomUUID();
    const reservedCostUsd = reservedExecutionCost(
      providerId,
      composition.content.length,
      status.maxOutputTokens,
    );
    const normalizedMandate = spendMandate === null
      ? null
      : Object.freeze({
          id: spendMandate.id.trim(),
          maximumRunCostUsd: mandateMoney(
            spendMandate.maximumRunCostUsd,
            "spendMandate.maximumRunCostUsd",
          ),
          maximumDailyCostUsd: mandateMoney(
            spendMandate.maximumDailyCostUsd,
            "spendMandate.maximumDailyCostUsd",
          ),
        });
    if (normalizedMandate !== null && normalizedMandate.id.length === 0) {
      throw new Error("spendMandate.id is required");
    }

    const running: AiExecutionRecord =
      Object.freeze({
        id: executionId,
        missionId,
        compositionId,
        projectId: composition.projectId,
        routeProfileId:
          composition.route.selectedProfile.id,
        providerId,
        model: providerModel,
        status: status.configured
          ? "running"
          : "unavailable",
        inputChars: composition.content.length,
        outputText: null,
        usage: emptyUsage(),
        estimatedCostUsd: 0,
        reservedCostUsd,
        spendMandateId: normalizedMandate?.id ?? null,
        maximumRunCostUsd: normalizedMandate?.maximumRunCostUsd ?? null,
        maximumDailyCostUsd: normalizedMandate?.maximumDailyCostUsd ?? null,
        providerResponseId: null,
        error: status.configured
          ? null
          : status.note,
        createdAt: timestamp,
        startedAt: timestamp,
        completedAt: status.configured
          ? null
          : timestamp,
      });

    await this.#mutate(async () => {
      if (providerId === "openai-responses") {
        if (normalizedMandate === null) {
          throw new Error("Paid provider execution requires an explicit spend mandate");
        }
        const runSpentUsd = this.#state.executions
          .filter((execution) => execution.spendMandateId === normalizedMandate.id)
          .reduce((total, execution) => total + chargedOrReserved(execution), 0);
        const dailySpentUsd = this.#state.executions
          .filter((execution) =>
            execution.providerId === "openai-responses" &&
            utcDay(execution.createdAt) === utcDay(timestamp)
          )
          .reduce((total, execution) => total + chargedOrReserved(execution), 0);
        if (runSpentUsd + reservedCostUsd > normalizedMandate.maximumRunCostUsd) {
          throw new Error(
            `Provider run cost boundary exceeded before call: limit=${normalizedMandate.maximumRunCostUsd}; reserved=${runSpentUsd + reservedCostUsd}`,
          );
        }
        if (dailySpentUsd + reservedCostUsd > normalizedMandate.maximumDailyCostUsd) {
          throw new Error(
            `Provider daily cost boundary exceeded before call: limit=${normalizedMandate.maximumDailyCostUsd}; reserved=${dailySpentUsd + reservedCostUsd}`,
          );
        }
      }
      await this.#save({
        ...this.#state,
        executions: [
          ...this.#state.executions,
          running,
        ],
      });
    });

    if (!status.configured) {
      this.#events.publish(
        "ai.execution.unavailable",
        {
          executionId,
          missionId,
          compositionId,
        },
      );

      return cloneExecution(running);
    }

    if (
      composition.content.length >
      status.maxInputChars
    ) {
      return this.#finish(
        executionId,
        {
          status: "failed",
          error:
            `Composition exceeds maximum input size of ${status.maxInputChars} characters`,
        },
      );
    }

    const connector = this.#connectors.get(providerId);

    if (!connector) {
      return this.#finish(
        executionId,
        {
          status: "failed",
          error: "Configured provider connector is unavailable",
        },
      );
    }

    this.#events.publish("ai.execution.started", {
      executionId,
      missionId,
      compositionId,
      providerId: connector.id,
      model: providerModel,
    });

    try {
      const result =
        await connector.execute(
          composition,
          status,
        );

      return this.#finish(executionId, {
        status: "succeeded",
        outputText: result.outputText,
        usage: result.usage,
        providerId,
        providerResponseId:
          result.providerResponseId,
      });
    } catch (error) {
      return this.#finish(executionId, {
        status: "failed",
        error: errorMessage(error),
      });
    }
  }

  async #finish(
    executionId: string,
    update:
      | {
          readonly status: "succeeded";
          readonly outputText: string;
          readonly usage: AiUsage;
          readonly providerId: AiProviderId;
          readonly providerResponseId:
            string | null;
        }
      | {
          readonly status: "failed";
          readonly error: string;
        },
  ): Promise<AiExecutionRecord> {
    return this.#mutate(async () => {
      const index =
        this.#state.executions.findIndex(
          (execution) =>
            execution.id === executionId,
        );

      if (index < 0) {
        throw new Error(
          `AI execution not found: ${executionId}`,
        );
      }

      const current =
        this.#state.executions[index];
      const completedAt =
        new Date().toISOString();

      const completed: AiExecutionRecord =
        cloneExecution({
          ...current,
          status: update.status,
          outputText:
            update.status === "succeeded"
              ? update.outputText
              : null,
          usage:
            update.status === "succeeded"
              ? update.usage
              : emptyUsage(),
          estimatedCostUsd:
            update.status === "succeeded"
              ? executionCost(update.providerId, update.usage)
              : 0,
              reservedCostUsd: 0,
          providerResponseId:
            update.status === "succeeded"
              ? update.providerResponseId
              : null,
          error:
            update.status === "failed"
              ? update.error
              : null,
          completedAt,
        });

      const executions = [
        ...this.#state.executions,
      ];
      executions[index] = completed;

      await this.#save({
        ...this.#state,
        executions,
      });

      this.#events.publish(
        completed.status === "succeeded"
          ? "ai.execution.succeeded"
          : "ai.execution.failed",
        {
          executionId,
          missionId: completed.missionId,
          compositionId:
            completed.compositionId,
          providerId:
            completed.providerId,
          model: completed.model,
          error: completed.error,
        },
      );

      return completed;
    });
  }

  #selectProvider(
    composition: PromptComposition,
    status: AiGatewayStatus,
  ): AiProviderId {
    const localEnabled =
      this.#connectors.has("local-model") &&
      localModelEnabled();
    const openAiReady =
      this.#connectors.has("openai-responses") &&
      Boolean(process.env.OPENAI_API_KEY?.trim()) &&
      Boolean(process.env.OPENAI_MODEL?.trim());
    const manualEnabled = this.#connectors.has("manual-fallback");
    const budget = composition.route.request.budget;
    if (budget === "low") {
      if (localEnabled) {
        return "local-model";
      }

      if (manualEnabled) {
        return "manual-fallback";
      }

      return "openai-responses";
    }

    if (budget === "medium") {
      if (localEnabled) {
        return "local-model";
      }

      if (openAiReady) {
        return "openai-responses";
      }

      if (manualEnabled) {
        return "manual-fallback";
      }

      return "openai-responses";
    }

    if (openAiReady) {
      return "openai-responses";
    }

    if (localEnabled) {
      return "local-model";
    }

    if (manualEnabled) {
      return "manual-fallback";
    }

    return "manual-fallback";
  }
}
