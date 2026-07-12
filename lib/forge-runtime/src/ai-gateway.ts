import type { PromptComposition } from "./operator";

export type AiProviderId =
  | "openai-responses";

export type AiExecutionStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "unavailable";

export interface AiGatewayStatus {
  readonly providerId: AiProviderId | null;
  readonly configured: boolean;
  readonly secretConfigured: boolean;
  readonly model: string | null;
  readonly apiBase: string | null;
  readonly maxInputChars: number;
  readonly maxOutputTokens: number;
  readonly note: string;
}

export interface AiUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface AiExecutionRecord {
  readonly id: string;
  readonly compositionId: string;
  readonly projectId: string;
  readonly routeProfileId: string;
  readonly providerId: AiProviderId | null;
  readonly model: string | null;
  readonly status: AiExecutionStatus;
  readonly inputChars: number;
  readonly outputText: string | null;
  readonly usage: AiUsage;
  readonly providerResponseId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface AiProviderResult {
  readonly providerResponseId: string | null;
  readonly outputText: string;
  readonly usage: AiUsage;
}

export interface AiProviderConnector {
  readonly id: AiProviderId;
  execute(
    composition: PromptComposition,
    status: AiGatewayStatus,
  ): Promise<AiProviderResult>;
}

export interface AiGatewaySummary {
  readonly configured: boolean;
  readonly providerId: AiProviderId | null;
  readonly model: string | null;
  readonly executions: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly unavailable: number;
  readonly lastExecutionAt: string | null;
}