import type {
  AiGatewayStatus,
  AiProviderConnector,
  AiProviderResult,
  AiUsage,
} from "./ai-gateway";
import type { PromptComposition } from "./operator";

interface AnthropicPayload {
  readonly id?: unknown;
  readonly content?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

function outputText(payload: AnthropicPayload): string {
  if (!Array.isArray(payload.content)) {
    return "";
  }

  return payload.content
    .filter(
      (item): item is { readonly type: "text"; readonly text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("")
    .trim();
}

function usage(payload: AnthropicPayload): AiUsage {
  if (typeof payload.usage !== "object" || payload.usage === null) {
    return Object.freeze({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  }

  const raw = payload.usage as Record<string, unknown>;
  const inputTokens =
    typeof raw.input_tokens === "number" ? raw.input_tokens : null;
  const outputTokens =
    typeof raw.output_tokens === "number" ? raw.output_tokens : null;

  return Object.freeze({
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null,
  });
}

function providerError(statusCode: number, payload: unknown): string {
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

  return `Anthropic request failed with HTTP ${statusCode}`;
}

export class AnthropicMessagesConnector implements AiProviderConnector {
  readonly id = "anthropic" as const;

  async execute(
    composition: PromptComposition,
    status: AiGatewayStatus,
  ): Promise<AiProviderResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

    if (!apiKey || !status.model || !status.apiBase) {
      throw new Error("Anthropic Messages provider is not configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const response = await fetch(
        `${status.apiBase.replace(/\/$/, "")}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: status.model,
            max_tokens: status.maxOutputTokens,
            messages: [{ role: "user", content: composition.content }],
          }),
          signal: controller.signal,
        },
      );
      const text = await response.text();
      let payload: AnthropicPayload = {};

      if (text.length > 0) {
        try {
          payload = JSON.parse(text) as AnthropicPayload;
        } catch {
          throw new Error(
            `Anthropic returned invalid JSON: ${text.slice(0, 300)}`,
          );
        }
      }

      if (!response.ok) {
        throw new Error(providerError(response.status, payload));
      }

      const content = outputText(payload);
      if (content.length === 0) {
        throw new Error("Anthropic response contains no output text");
      }

      return Object.freeze({
        providerResponseId:
          typeof payload.id === "string" ? payload.id : null,
        outputText: content,
        usage: usage(payload),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
