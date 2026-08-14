import assert from "node:assert/strict";
import test from "node:test";
import type { AiGatewayStatus } from "./ai-gateway";
import { OpenAiResponsesConnector } from "./openai-responses-connector";
import type { PromptComposition } from "./operator";
import {
  workspacePlanJsonSchema,
  workspacePlanSystemPrompt,
} from "./workspace-plan-contract";

test("OpenAI Responses sends the workspace plan output contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  let requestBody: unknown;

  process.env.OPENAI_API_KEY = "test-api-key";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "response-1",
      output_text: "{}",
    }), { status: 200 });
  };

  try {
    const composition: PromptComposition = {
      id: "composition-1",
      projectId: "forge-core",
      objective: "WORKSPACE_PLAN_OUTPUT_CONTRACT_V1 create the approved target",
      route: {
        selectedProfileId: "openai-test",
        reason: "test",
        candidates: [],
      },
      memoryIds: [],
      sourceFiles: [],
      content: "Create the approved target.",
      createdAt: "2026-08-14T00:00:00.000Z",
    };
    const status: AiGatewayStatus = {
      providerId: "openai-responses",
      configured: true,
      model: "gpt-test",
      apiBase: "https://api.openai.test/v1",
      maxOutputTokens: 2_000,
    };

    await new OpenAiResponsesConnector().execute(composition, status);

    assert.deepEqual(requestBody, {
      model: "gpt-test",
      input: "Create the approved target.",
      max_output_tokens: 2_000,
      instructions: workspacePlanSystemPrompt,
      text: {
        format: {
          type: "json_schema",
          name: "forge_workspace_execution_plan",
          strict: true,
          schema: workspacePlanJsonSchema,
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});