import type {
  AiGatewayStatus,
  AiProviderConnector,
  AiProviderResult,
  AiUsage,
} from "./ai-gateway";
import type { PromptComposition } from "./operator";
import {
  requiresWorkspacePlanContract,
  workspacePlanJsonSchema,
  workspacePlanSystemPrompt,
} from "./workspace-plan-contract";

interface ChatCompletionChoice {
  readonly message?: {
    readonly content?: unknown;
  };
}

interface ChatCompletionPayload {
  readonly id?: unknown;
  readonly choices?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

function usage(payload: ChatCompletionPayload): AiUsage {
  if (
    typeof payload.usage !== "object" ||
    payload.usage === null
  ) {
    return Object.freeze({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  }

  const raw = payload.usage as Record<string, unknown>;

  return Object.freeze({
    inputTokens:
      typeof raw.prompt_tokens === "number"
        ? raw.prompt_tokens
        : null,
    outputTokens:
      typeof raw.completion_tokens === "number"
        ? raw.completion_tokens
        : null,
    totalTokens:
      typeof raw.total_tokens === "number"
        ? raw.total_tokens
        : null,
  });
}

function outputText(payload: ChatCompletionPayload): string {
  if (!Array.isArray(payload.choices)) {
    return "";
  }

  for (const item of payload.choices as ChatCompletionChoice[]) {
    if (
      item?.message &&
      typeof item.message.content === "string" &&
      item.message.content.trim().length > 0
    ) {
      return item.message.content.trim();
    }
  }

  return "";
}

function errorMessage(payload: unknown, statusCode: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return `Local model request failed with HTTP ${statusCode}`;
}

export class LocalModelConnector
  implements AiProviderConnector
{
  readonly id = "local-model" as const;

  async execute(
    composition: PromptComposition,
    _status: AiGatewayStatus,
  ): Promise<AiProviderResult> {
    const model =
      process.env.FORGE_LOCAL_MODEL_NAME?.trim() ||
      "qwen2.5-coder:7b";
    const baseUrl = (
      process.env.FORGE_LOCAL_MODEL_BASE_URL?.trim() ||
      "http://127.0.0.1:11434/v1"
    ).replace(/\/$/, "");
    const apiKey = process.env.FORGE_LOCAL_MODEL_API_KEY?.trim();
    const requiresWorkspacePlan = requiresWorkspacePlanContract(
      composition.objective,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey
            ? { Authorization: `Bearer ${apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(requiresWorkspacePlan
              ? [{
                  role: "system",
                  content: workspacePlanSystemPrompt,
                }]
              : []),
            {
              role: "user",
              content: requiresWorkspacePlan
                ? [
                    composition.content,
                    "",
                    "Required output JSON Schema:",
                    JSON.stringify(workspacePlanJsonSchema),
                  ].join("\n")
                : composition.content,
            },
          ],
          temperature: requiresWorkspacePlan ? 0 : 0.2,
          ...(requiresWorkspacePlan
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "forge_workspace_execution_plan",
                    strict: true,
                    schema: workspacePlanJsonSchema,
                  },
                },
              }
            : {}),
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: ChatCompletionPayload = {};

      if (text.length > 0) {
        try {
          payload = JSON.parse(text) as ChatCompletionPayload;
        } catch {
          throw new Error(
            `Local model returned invalid JSON: ${text.slice(0, 300)}`,
          );
        }
      }

      if (!response.ok) {
        throw new Error(errorMessage(payload, response.status));
      }

      const content = outputText(payload);

      if (content.length === 0) {
        throw new Error("Local model response contains no output text");
      }

      return Object.freeze({
        providerResponseId:
          typeof payload.id === "string"
            ? payload.id
            : null,
        outputText: content,
        usage: usage(payload),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
