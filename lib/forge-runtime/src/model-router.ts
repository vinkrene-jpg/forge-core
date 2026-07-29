import type {
  ModelBudget,
  ModelPrivacy,
  ModelProfile,
  ModelRouteCandidate,
  ModelRouteDecision,
  ModelRouteRequest,
  ModelTaskType,
} from "./operator";

function freezePrivacyModes(
  ...values: ModelPrivacy[]
): readonly ModelPrivacy[] {
  return Object.freeze(values);
}

const profiles: readonly ModelProfile[] = Object.freeze([
  Object.freeze({
    id: "local-private",
    label: "Local Private Route",
    executionMode: "routing-only",
    providerBinding: null,
    maxContextChars: 32_000,
    privacyModes: freezePrivacyModes(
      "local-only",
      "private",
      "standard",
    ),
    taskStrengths: Object.freeze({
      reasoning: 2,
      coding: 2,
      analysis: 3,
      summarization: 3,
    }),
    costTier: 1,
    supportsTools: false,
  }),
  Object.freeze({
    id: "balanced-reasoning",
    label: "Balanced Reasoning Route",
    executionMode: "routing-only",
    providerBinding: null,
    maxContextChars: 120_000,
    privacyModes: freezePrivacyModes(
      "private",
      "standard",
    ),
    taskStrengths: Object.freeze({
      reasoning: 5,
      coding: 3,
      analysis: 5,
      summarization: 4,
    }),
    costTier: 2,
    supportsTools: true,
  }),
  Object.freeze({
    id: "coding-specialist",
    label: "Coding Specialist Route",
    executionMode: "routing-only",
    providerBinding: null,
    maxContextChars: 200_000,
    privacyModes: freezePrivacyModes(
      "private",
      "standard",
    ),
    taskStrengths: Object.freeze({
      reasoning: 4,
      coding: 5,
      analysis: 4,
      summarization: 3,
    }),
    costTier: 3,
    supportsTools: true,
  }),
]);

function budgetLimit(budget: ModelBudget): number {
  if (budget === "low") {
    return 1;
  }

  if (budget === "medium") {
    return 2;
  }

  return 3;
}

function requiredTaskType(
  value: ModelTaskType,
): ModelTaskType {
  if (
    value !== "reasoning" &&
    value !== "coding" &&
    value !== "analysis" &&
    value !== "summarization"
  ) {
    throw new Error("Unsupported model task type");
  }

  return value;
}

export class ModelRouter {
  listProfiles(): readonly ModelProfile[] {
    return profiles;
  }

  route(request: ModelRouteRequest): ModelRouteDecision {
    const taskType = requiredTaskType(request.taskType);

    if (
      !Number.isInteger(request.contextChars) ||
      request.contextChars < 0
    ) {
      throw new Error(
        "contextChars must be a non-negative integer",
      );
    }

    const maximumCost = budgetLimit(request.budget);

    const candidates: ModelRouteCandidate[] =
      profiles.map((profile) => {
        const reasons: string[] = [];
        let eligible = true;
        let score = profile.taskStrengths[taskType] * 20;

        if (
          !profile.privacyModes.includes(request.privacy)
        ) {
          eligible = false;
          reasons.push("privacy mode unsupported");
        }

        if (
          request.contextChars >
          profile.maxContextChars
        ) {
          eligible = false;
          reasons.push("context limit exceeded");
        }

        if (profile.costTier > maximumCost) {
          eligible = false;
          reasons.push("budget tier exceeded");
        }

        if (
          request.requiresTools === true &&
          !profile.supportsTools
        ) {
          score -= 25;
          reasons.push("tool use unavailable");
        }

        score -= profile.costTier * 5;
        score += Math.max(
          0,
          Math.round(
            (
              profile.maxContextChars -
              request.contextChars
            ) /
              20_000,
          ),
        );

        if (eligible) {
          reasons.push(
            `task strength ${profile.taskStrengths[taskType]}/5`,
          );
        }

        return Object.freeze({
          profileId: profile.id,
          eligible,
          score,
          reasons: Object.freeze(reasons),
        });
      });

    const eligible = candidates
      .filter((candidate) => candidate.eligible)
      .sort((left, right) => right.score - left.score);

    if (eligible.length === 0) {
      throw new Error(
        "No model route satisfies privacy, context and budget constraints",
      );
    }

    const selectedCandidate = eligible[0];
    const selectedProfile = profiles.find(
      (profile) =>
        profile.id === selectedCandidate.profileId,
    );

    if (!selectedProfile) {
      throw new Error("Selected model profile is missing");
    }

    return Object.freeze({
      selectedProfile,
      request: Object.freeze({ ...request }),
      candidates: Object.freeze(candidates),
      rationale:
        `Selected ${selectedProfile.id}: ` +
        selectedCandidate.reasons.join(", ") +
        ". Provider execution is not yet bound.",
      routedAt: new Date().toISOString(),
    });
  }
}