import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGatewayEngine,
  RuntimeEventBus,
  createInitialAiGatewayState,
  type AiGatewayStateStore,
  type AiProviderConnector,
  type PersistedAiGatewayState,
  type PromptComposition,
} from "./index.js";

test("paid provider calls require and obey persisted spend boundaries", async () => {
  const original = new Map([
    ["FORGE_AI_PROVIDER", process.env.FORGE_AI_PROVIDER],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["OPENAI_MODEL", process.env.OPENAI_MODEL],
    ["FORGE_OPENAI_INPUT_USD_PER_1K", process.env.FORGE_OPENAI_INPUT_USD_PER_1K],
    ["FORGE_OPENAI_OUTPUT_USD_PER_1K", process.env.FORGE_OPENAI_OUTPUT_USD_PER_1K],
  ]);
  process.env.FORGE_AI_PROVIDER = "openai-responses";
  process.env.OPENAI_API_KEY = "test-only";
  process.env.OPENAI_MODEL = "test-model";
  process.env.FORGE_OPENAI_INPUT_USD_PER_1K = "0.001";
  process.env.FORGE_OPENAI_OUTPUT_USD_PER_1K = "0.001";

  let state: PersistedAiGatewayState = createInitialAiGatewayState();
  const store: AiGatewayStateStore = {
    async load() { return state; },
    async save(next) { state = next; },
  };
  let calls = 0;
  const connector: AiProviderConnector = {
    id: "openai-responses",
    async execute() {
      calls += 1;
      return {
        providerResponseId: "response",
        outputText: "bounded provider output",
        usage: { inputTokens: 500, outputTokens: 500, totalTokens: 1_000 },
      };
    },
  };
  const composition = {
    id: "composition",
    projectId: "forge-core",
    content: "x".repeat(100),
    route: { selectedProfile: { id: "profile" }, request: { budget: "high" } },
  } as PromptComposition;
  const gateway = new AiGatewayEngine({
    events: new RuntimeEventBus(),
    getComposition: (id) => id === composition.id ? composition : null,
    stateStore: store,
    connectors: [connector],
  });

  try {
    await gateway.initialize();
    await assert.rejects(
      gateway.executeComposition(composition.id, "mission"),
      /requires an explicit spend mandate/,
    );
    assert.equal(calls, 0);

    await assert.rejects(
      gateway.executeComposition(composition.id, "mission", {
        id: "too-small-run",
        maximumRunCostUsd: 0.001,
        maximumDailyCostUsd: 1,
      }),
      /run cost boundary exceeded before call/,
    );
    assert.equal(calls, 0);

    const mandate = {
      id: "run-1",
      maximumRunCostUsd: 1,
      maximumDailyCostUsd: 0.002,
    };
    const first = await gateway.executeComposition(composition.id, "mission", mandate);
    assert.equal(first.estimatedCostUsd, 0.001);
    assert.equal(first.spendMandateId, mandate.id);
    assert.equal(calls, 1);

    await assert.rejects(
      gateway.executeComposition(composition.id, "mission", mandate),
      /daily cost boundary exceeded before call/,
    );
    assert.equal(calls, 1);
    assert.equal(state.executions.length, 1);
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});