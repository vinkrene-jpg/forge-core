import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GATEWAY_STORE_VERSION,
  AiGatewayEngine,
  AnthropicMessagesConnector,
  RuntimeEventBus,
  type AiGatewayStateStore,
  type PersistedAiGatewayState,
  type PromptComposition,
} from "./index.js";

class MemoryStateStore implements AiGatewayStateStore {
  state: PersistedAiGatewayState = Object.freeze({
    version: AI_GATEWAY_STORE_VERSION,
    executions: Object.freeze([]),
  });

  async load(): Promise<PersistedAiGatewayState> {
    return this.state;
  }

  async save(state: PersistedAiGatewayState): Promise<void> {
    this.state = state;
  }
}

function composition(): PromptComposition {
  const timestamp = new Date().toISOString();
  const content = "Confirm this response comes from Claude.";

  return Object.freeze({
    id: "anthropic-composition",
    projectId: "forge-core",
    objective: "Prove the Anthropic route.",
    route: Object.freeze({
      selectedProfile: Object.freeze({
        id: "external-reasoning",
        label: "External reasoning",
        executionMode: "routing-only",
        providerBinding: null,
        maxContextChars: 100_000,
        privacyModes: Object.freeze(["standard"] as const),
        taskStrengths: Object.freeze({
          analysis: 1,
          reasoning: 1,
          coding: 1,
          summarization: 1,
        }),
        costTier: 2,
        supportsTools: false,
      }),
      request: Object.freeze({
        taskType: "analysis",
        privacy: "standard",
        budget: "high",
        contextChars: content.length,
      }),
      candidates: Object.freeze([]),
      rationale: "Anthropic connector contract test",
      routedAt: timestamp,
    }),
    memoryIds: Object.freeze([]),
    sourceFiles: Object.freeze([]),
    content,
    createdAt: timestamp,
  });
}

test(
  "runtime gateway selects Anthropic, uses Messages API, and records cost",
  { concurrency: false },
  async () => {
    const keys = [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_BASE_URL",
      "FORGE_AI_PROVIDER",
      "FORGE_AI_MAX_OUTPUT_TOKENS",
      "FORGE_ANTHROPIC_INPUT_USD_PER_1K",
      "FORGE_ANTHROPIC_OUTPUT_USD_PER_1K",
    ] as const;
    const originalEnvironment = new Map(
      keys.map((key) => [key, process.env[key]]),
    );
    const originalFetch = globalThis.fetch;

    process.env.ANTHROPIC_API_KEY = "test-only-key";
    process.env.ANTHROPIC_MODEL = "claude-test";
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.test/v1/";
    process.env.FORGE_AI_PROVIDER = "anthropic";
    process.env.FORGE_AI_MAX_OUTPUT_TOKENS = "321";
    process.env.FORGE_ANTHROPIC_INPUT_USD_PER_1K = "0.5";
    process.env.FORGE_ANTHROPIC_OUTPUT_USD_PER_1K = "1";

    try {
      const requests: { url: string; init: RequestInit }[] = [];
      globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), init: init ?? {} });
        return new Response(
          JSON.stringify({
            id: "msg_runtime_proof",
            content: [{ type: "text", text: "Answer from Claude." }],
            usage: { input_tokens: 2, output_tokens: 3 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      };

      const prompt = composition();
      const engine = new AiGatewayEngine({
        events: new RuntimeEventBus(),
        getComposition: (id) => (id === prompt.id ? prompt : null),
        stateStore: new MemoryStateStore(),
        connectors: [new AnthropicMessagesConnector()],
      });
      await engine.initialize();

      assert.equal(engine.status().providerId, "anthropic");
      assert.equal(engine.status().model, "claude-test");

      const execution = await engine.executeComposition(
        prompt.id,
        null,
        {
          id: "anthropic-test-mandate",
          maximumRunCostUsd: 1,
          maximumDailyCostUsd: 1,
        },
      );

      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.ok(request);
      assert.equal(request.url, "https://anthropic.test/v1/messages");
      const headers = new Headers(request.init.headers);
      assert.equal(headers.get("x-api-key"), "test-only-key");
      assert.equal(headers.get("anthropic-version"), "2023-06-01");
      assert.equal(
        JSON.parse(String(request.init.body)).max_tokens,
        321,
      );
      assert.equal(execution.providerId, "anthropic");
      assert.equal(execution.outputText, "Answer from Claude.");
      assert.deepEqual(execution.usage, {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      });
      assert.equal(execution.estimatedCostUsd, 0.004);
      assert.deepEqual(engine.summary().byProvider, [
        {
          providerId: "anthropic",
          executions: 1,
          estimatedCostUsd: 0.004,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of keys) {
        const value = originalEnvironment.get(key);
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  },
);
