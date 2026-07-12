import { randomUUID } from "node:crypto";
import type { RuntimeEventBus } from "./event-bus";
import {
  AI_GATEWAY_STORE_VERSION,
  FileAiGatewayStateStore,
  type AiGatewayStateStore,
  type PersistedAiGatewayState,
} from "./ai-gateway-store";
import type {
  AiExecutionRecord,
  AiGatewayStatus,
  AiGatewaySummary,
  AiProviderConnector,
  AiProviderId,
  AiUsage,
} from "./ai-gateway";
import type {
  PromptComposition,
} from "./operator";
import { OpenAiResponsesConnector } from "./openai-responses-connector";

export interface AiGatewayEngineOptions {
  readonly events: RuntimeEventBus;
  readonly getComposition: (
    compositionId: string,
  ) => PromptComposition | null;
  readonly stateStore?: AiGatewayStateStore;
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
    usage: Object.freeze({ ...execution.usage }),
  });
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

    const connectors: AiProviderConnector[] = [
      new OpenAiResponsesConnector(),
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
        state.executions
          .slice(-100)
          .map(cloneExecution),
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
    const providerValue =
      process.env.FORGE_AI_PROVIDER?.trim();
    const key =
      process.env.OPENAI_API_KEY?.trim();
    const model =
      process.env.OPENAI_MODEL?.trim();
    const inferredProvider =
      providerValue ||
      (key || model
        ? "openai-responses"
        : "");

    const providerId: AiProviderId | null =
      inferredProvider === "openai-responses"
        ? "openai-responses"
        : null;

    const apiBase =
      providerId === null
        ? null
        : (
            process.env.OPENAI_BASE_URL?.trim() ||
            "https://api.openai.com/v1"
          );

    const configured =
      providerId !== null &&
      Boolean(key) &&
      Boolean(model);

    return Object.freeze({
      providerId,
      configured,
      secretConfigured: Boolean(key),
      model: model || null,
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
        ? "Provider is configured for controlled execution."
        : "Gateway is operational, but provider execution is unavailable until provider, model and secret are configured.",
    });
  }

  summary(): AiGatewaySummary {
    this.#ensureInitialized();

    const status = this.status();
    let succeeded = 0;
    let failed = 0;
    let unavailable = 0;

    for (const execution of this.#state.executions) {
      if (execution.status === "succeeded") {
        succeeded += 1;
      } else if (execution.status === "failed") {
        failed += 1;
      } else if (execution.status === "unavailable") {
        unavailable += 1;
      }
    }

    return Object.freeze({
      configured: status.configured,
      providerId: status.providerId,
      model: status.model,
      executions: this.#state.executions.length,
      succeeded,
      failed,
      unavailable,
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
    const timestamp =
      new Date().toISOString();
    const executionId = randomUUID();

    const running: AiExecutionRecord =
      Object.freeze({
        id: executionId,
        compositionId,
        projectId: composition.projectId,
        routeProfileId:
          composition.route.selectedProfile.id,
        providerId: status.providerId,
        model: status.model,
        status: status.configured
          ? "running"
          : "unavailable",
        inputChars: composition.content.length,
        outputText: null,
        usage: emptyUsage(),
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

    const connector =
      status.providerId === null
        ? null
        : this.#connectors.get(
            status.providerId,
          );

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
      compositionId,
      providerId: connector.id,
      model: status.model,
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
}