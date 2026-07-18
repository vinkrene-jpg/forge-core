import type {
  AiGatewayStatus,
  AiProviderConnector,
  AiProviderResult,
} from "./ai-gateway";
import type { PromptComposition } from "./operator";

function extractObjective(composition: PromptComposition): string {
  const objective = composition.objective.trim();

  if (objective.length <= 240) {
    return objective;
  }

  return objective.slice(0, 237) + "...";
}

export class ManualFallbackConnector
  implements AiProviderConnector
{
  readonly id = "manual-fallback" as const;

  async execute(
    composition: PromptComposition,
    _status: AiGatewayStatus,
  ): Promise<AiProviderResult> {
    const timestamp = new Date().toISOString();
    const objective = extractObjective(composition);

    const output = [
      `Manual fallback response generated at ${timestamp}.`,
      `Objective: ${objective}`,
      "Assumptions:",
      "- External provider execution was unavailable or budget-constrained.",
      "- This response preserves runtime continuity and marks the capability as a gap until verified implementation evidence exists.",
      "Verification guidance:",
      "- Run pnpm --filter @workspace/forge-runtime test",
      "- Run pnpm --filter @workspace/forge-runtime typecheck",
      "- Confirm no secret material is persisted in runtime evidence",
      "CAPABILITY_RESULT: GAP",
      "Next step:",
      "- Schedule a bounded low-cost follow-up mission using the local model route.",
    ].join("\n");

    return Object.freeze({
      providerResponseId: null,
      outputText: output,
      usage: Object.freeze({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
    });
  }
}
