// AI-backed mission review (step 2). Wraps the deterministic rule-based
// Guardian/Governor from mission-review.ts with a specialised AI Guardian role
// that runs exclusively through the runtime's AI Gateway. The AI verdict can
// only make the outcome stricter, never milder, and any failure or missing
// provider falls back to the rule-based review — the mission chain never blocks
// merely because the AI is unavailable.
//
// The gateway is injected as plain functions so this orchestrator is portable
// and unit-testable without the full runtime.

import type { MissionRecord } from "./mission";
import type { PromptComposeRequest } from "./operator";
import {
  buildGuardianReviewContext,
  combineGuardianReview,
  deriveMissionGovernorDecision,
  deriveMissionGuardianReview,
  GUARDIAN_AI_INSTRUCTIONS,
  parseGuardianAiVerdict,
  type MissionReview,
} from "./mission-review";

export interface GuardianAiExecutionResult {
  readonly status: string;
  readonly outputText: string | null;
  readonly providerId: string | null;
  readonly model: string | null;
}

export interface GuardianAiReviewDeps {
  /** Whether AI mission review is enabled (FORGE_MISSION_AI_REVIEW_ENABLED). */
  readonly aiEnabled: boolean;
  /** Whether a provider route is currently configured on the gateway. */
  readonly gatewayConfigured: () => boolean;
  readonly composePrompt: (
    request: PromptComposeRequest,
  ) => Promise<{ readonly id: string }>;
  readonly executeComposition: (
    compositionId: string,
    missionId: string | null,
  ) => Promise<GuardianAiExecutionResult>;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasReviewableEvidence(
  output: Readonly<Record<string, unknown>>,
): boolean {
  return record(output.executionEvidence) !== null || record(output.evaluation) !== null;
}

/**
 * Runs the Guardian review for a completed mission, escalating to the AI
 * Guardian when it is enabled, a provider is configured, and there is real
 * evidence to review. Returns the persisted Guardian review + Governor
 * decision. Always resolves; never throws.
 */
export async function reviewMissionWithGuardianAi(
  deps: GuardianAiReviewDeps,
  mission: MissionRecord,
  output: Readonly<Record<string, unknown>>,
  reviewedAt: string,
): Promise<MissionReview> {
  const rulesReview = deriveMissionGuardianReview(mission.id, output, reviewedAt);

  const rulesOnly = (): MissionReview =>
    Object.freeze({
      guardianReview: rulesReview,
      governorDecision: deriveMissionGovernorDecision(mission.id, rulesReview, reviewedAt),
    });

  if (!deps.aiEnabled || !hasReviewableEvidence(output) || !deps.gatewayConfigured()) {
    return rulesOnly();
  }

  try {
    const projectId = text(mission.input.projectId) ?? "forge-core";
    const request: PromptComposeRequest = {
      projectId,
      objective: `${GUARDIAN_AI_INSTRUCTIONS}\n\n${buildGuardianReviewContext(
        mission.title,
        mission.input,
        output,
        rulesReview,
      )}`,
      taskType: "analysis",
      privacy: "standard",
      budget: "low",
      files: [],
      memoryKinds: ["evidence", "decision"],
    };
    const composition = await deps.composePrompt(request);
    const execution = await deps.executeComposition(composition.id, mission.id);

    if (execution.status !== "succeeded" || !text(execution.outputText)) {
      return rulesOnly();
    }

    const verdict = parseGuardianAiVerdict(execution.outputText ?? "");
    const model =
      execution.providerId || execution.model
        ? `${execution.providerId ?? "unknown"}/${execution.model ?? "unknown"}`
        : null;
    const guardianReview = combineGuardianReview(
      mission.id,
      rulesReview,
      verdict,
      model,
      reviewedAt,
    );
    return Object.freeze({
      guardianReview,
      governorDecision: deriveMissionGovernorDecision(mission.id, guardianReview, reviewedAt),
    });
  } catch {
    // Fail-safe: an AI or gateway error never blocks the chain.
    return rulesOnly();
  }
}
