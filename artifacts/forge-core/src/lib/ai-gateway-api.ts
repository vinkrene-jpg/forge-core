export interface AiGatewayStatus {
  readonly providerId:
    | "openai-responses"
    | null;
  readonly configured: boolean;
  readonly secretConfigured: boolean;
  readonly model: string | null;
  readonly apiBase: string | null;
  readonly maxInputChars: number;
  readonly maxOutputTokens: number;
  readonly note: string;
}

export interface AiGatewaySummary {
  readonly configured: boolean;
  readonly providerId:
    | "openai-responses"
    | null;
  readonly model: string | null;
  readonly executions: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly unavailable: number;
  readonly lastExecutionAt: string | null;
}

export interface AiExecutionRecord {
  readonly id: string;
  readonly compositionId: string;
  readonly projectId: string;
  readonly routeProfileId: string;
  readonly providerId:
    | "openai-responses"
    | null;
  readonly model: string | null;
  readonly status:
    | "running"
    | "succeeded"
    | "failed"
    | "unavailable";
  readonly inputChars: number;
  readonly outputText: string | null;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
  };
  readonly providerResponseId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);

  if (
    init.body !== undefined &&
    !headers.has("Content-Type")
  ) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: unknown = null;

  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed: ${response.status}`;

    throw new Error(errorMessage);
  }

  return payload as T;
}

export const aiGatewayApi = {
  status(): Promise<{
    readonly status: AiGatewayStatus;
    readonly summary: AiGatewaySummary;
  }> {
    return requestJson(
      "/api/ai-gateway/status",
    );
  },

  executions(): Promise<{
    readonly executions:
      readonly AiExecutionRecord[];
  }> {
    return requestJson(
      "/api/ai-gateway/executions",
    );
  },

  execute(
    compositionId: string,
  ): Promise<AiExecutionRecord> {
    return requestJson(
      "/api/ai-gateway/executions",
      {
        method: "POST",
        body: JSON.stringify({
          compositionId,
        }),
      },
    );
  },
};