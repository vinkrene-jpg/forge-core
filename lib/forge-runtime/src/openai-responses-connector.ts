import type {
  AiGatewayStatus,
  AiProviderConnector,
  AiProviderResult,
  AiUsage,
} from "./ai-gateway";
import type { PromptComposition } from "./operator";

interface ResponsesApiContent {
  readonly type?: unknown;
  readonly text?: unknown;
}

interface ResponsesApiOutput {
  readonly type?: unknown;
  readonly content?: unknown;
}

interface ResponsesApiPayload {
  readonly id?: unknown;
  readonly output_text?: unknown;
  readonly output?: unknown;
  readonly usage?: unknown;
  readonly error?: unknown;
}

function extractOutputText(
  payload: ResponsesApiPayload,
): string {
  if (
    typeof payload.output_text === "string" &&
    payload.output_text.trim().length > 0
  ) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  const texts: string[] = [];

  for (const item of payload.output as ResponsesApiOutput[]) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content as ResponsesApiContent[]) {
      if (
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}

function usage(
  payload: ResponsesApiPayload,
): AiUsage {
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
      typeof raw.input_tokens === "number"
        ? raw.input_tokens
        : null,
    outputTokens:
      typeof raw.output_tokens === "number"
        ? raw.output_tokens
        : null,
    totalTokens:
      typeof raw.total_tokens === "number"
        ? raw.total_tokens
        : null,
  });
}

function providerError(
  statusCode: number,
  payload: unknown,
): string {
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

  return `Provider request failed with HTTP ${statusCode}`;
}

export class OpenAiResponsesConnector
  implements AiProviderConnector
{
  readonly id = "openai-responses" as const;

  async execute(
    composition: PromptComposition,
    status: AiGatewayStatus,
  ): Promise<AiProviderResult> {
    const apiKey =
      process.env.OPENAI_API_KEY?.trim();

    if (
      !apiKey ||
      !status.model ||
      !status.apiBase
    ) {
      throw new Error(
        "OpenAI Responses provider is not configured",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      90_000,
    );

    try {
      const response = await fetch(
        `${status.apiBase.replace(/\/$/, "")}/responses`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: status.model,
            input: composition.content,
            max_output_tokens:
              status.maxOutputTokens,
          }),
          signal: controller.signal,
        },
      );

      const text = await response.text();
      let payload: ResponsesApiPayload = {};

      if (text.length > 0) {
        try {
          payload = JSON.parse(text) as ResponsesApiPayload;
        } catch {
          throw new Error(
            `Provider returned invalid JSON: ${text.slice(0, 300)}`,
          );
        }
      }

      if (!response.ok) {
        throw new Error(
          providerError(response.status, payload),
        );
      }

      const outputText = extractOutputText(payload);

      if (outputText.length === 0) {
        throw new Error(
          "Provider response contains no output text",
        );
      }

      return Object.freeze({
        providerResponseId:
          typeof payload.id === "string"
            ? payload.id
            : null,
        outputText,
        usage: usage(payload),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}