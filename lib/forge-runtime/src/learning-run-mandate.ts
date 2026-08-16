export interface LearningRunMandate {
  readonly track: string;
  readonly maximumExercises: number;
  readonly maximumDurationMs: number;
  readonly maximumRunCostUsd: number;
  readonly maximumDailyCostUsd: number;
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${field} must be ${integer ? "an integer" : "a number"} between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseLearningRunMandate(value: unknown): LearningRunMandate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Learning run mandate must be an object");
  const input = value as Readonly<Record<string, unknown>>;
  if (typeof input.track !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.track)) throw new Error("Learning run track is invalid");
  return Object.freeze({
    track: input.track,
    maximumExercises: boundedNumber(input.maximumExercises, "maximumExercises", 1, 100, true),
    maximumDurationMs: boundedNumber(input.maximumDurationMs, "maximumDurationMs", 60_000, 604_800_000, true),
    maximumRunCostUsd: boundedNumber(input.maximumRunCostUsd, "maximumRunCostUsd", 0.01, 1_000),
    maximumDailyCostUsd: boundedNumber(input.maximumDailyCostUsd, "maximumDailyCostUsd", 0.01, 1_000),
  });
}