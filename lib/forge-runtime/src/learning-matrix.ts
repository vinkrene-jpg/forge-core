export type LearningExerciseType =
  | "evidence-review"
  | "ambiguity-analysis"
  | "success-criteria-design";

export interface LearningCapabilityMatrixEntry {
  readonly capabilityId: string;
  readonly name: string;
  readonly track: "human-intent";
  readonly maturity: "experimental";
  readonly dependencies: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly exerciseTypes: readonly LearningExerciseType[];
  readonly operationalAuthority: false;
}

const entries: readonly LearningCapabilityMatrixEntry[] = Object.freeze([
  Object.freeze({
    capabilityId: "human-intent.goal-clarification",
    name: "Goal Clarification",
    track: "human-intent" as const,
    maturity: "experimental" as const,
    dependencies: Object.freeze([]),
    evidenceRequirements: Object.freeze([
      "Explicit user goal",
      "Separated wishes and requirements",
      "Recorded unresolved questions",
    ]),
    exerciseTypes: Object.freeze(["ambiguity-analysis" as const]),
    operationalAuthority: false as const,
  }),
  Object.freeze({
    capabilityId: "human-intent.ambiguity-detection",
    name: "Ambiguity Detection",
    track: "human-intent" as const,
    maturity: "experimental" as const,
    dependencies: Object.freeze(["human-intent.goal-clarification"]),
    evidenceRequirements: Object.freeze([
      "Enumerated ambiguous statements",
      "Impact per ambiguity",
      "Clarification question per blocking ambiguity",
    ]),
    exerciseTypes: Object.freeze(["ambiguity-analysis" as const]),
    operationalAuthority: false as const,
  }),
  Object.freeze({
    capabilityId: "human-intent.success-criteria",
    name: "Stable Success Criteria",
    track: "human-intent" as const,
    maturity: "experimental" as const,
    dependencies: Object.freeze(["human-intent.goal-clarification"]),
    evidenceRequirements: Object.freeze([
      "Observable outcome",
      "Explicit constraints",
      "Testable acceptance criteria",
    ]),
    exerciseTypes: Object.freeze(["success-criteria-design" as const]),
    operationalAuthority: false as const,
  }),
]);

function cloneEntry(
  entry: LearningCapabilityMatrixEntry,
): LearningCapabilityMatrixEntry {
  return Object.freeze({
    ...entry,
    dependencies: Object.freeze([...entry.dependencies]),
    evidenceRequirements: Object.freeze([...entry.evidenceRequirements]),
    exerciseTypes: Object.freeze([...entry.exerciseTypes]),
  });
}

export function listLearningMatrixEntries():
  readonly LearningCapabilityMatrixEntry[] {
  return entries.map(cloneEntry);
}

export function getLearningMatrixEntry(
  capabilityId: string,
): LearningCapabilityMatrixEntry | null {
  const entry = entries.find(
    (candidate) => candidate.capabilityId === capabilityId,
  );

  return entry ? cloneEntry(entry) : null;
}
