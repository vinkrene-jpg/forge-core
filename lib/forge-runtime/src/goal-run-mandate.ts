import path from "node:path";
import {
  GoalMandateBoundaryError,
  isHardProtectedGoalPath,
  normalizeGoalMandatePath,
} from "./goal-mandate";

export interface GoalRunMandateRequest {
  readonly allowedDirectories: readonly string[];
  readonly maximumGoals: number;
  readonly maximumCapabilityImprovements: number;
  readonly maximumImprovementDepth: number;
  readonly maximumDurationMs: number;
  readonly maximumCostUsd: number;
  readonly maximumDailyCostUsd: number;
}

const allowedMutationRoots = new Set(["sandbox", "lib", "artifacts"]);

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("runMandate must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function money(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${field} must be between 0 and 1000000`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeDirectory(value: unknown): string {
  const normalized = normalizeGoalMandatePath(value);
  const segments = normalized.split("/");
  if (
    isHardProtectedGoalPath(normalized) ||
    isHardProtectedGoalPath(`${normalized}/.goal-run-boundary-check`)
  ) {
    throw new GoalMandateBoundaryError("hard-protection", "core-and-guardians", normalized);
  }
  if (!allowedMutationRoots.has(segments[0].toLowerCase())) {
    throw new GoalMandateBoundaryError("path", "sandbox/,lib/,artifacts/", normalized);
  }
  return `${normalized.replace(/\/+$/, "")}/`;
}

export function parseGoalRunMandateRequest(value: unknown): GoalRunMandateRequest {
  const candidate = record(value);
  if (
    !Array.isArray(candidate.allowedDirectories) ||
    candidate.allowedDirectories.length === 0 ||
    candidate.allowedDirectories.length > 3
  ) {
    throw new Error("runMandate.allowedDirectories must contain between 1 and 3 directories");
  }
  const allowedDirectories = candidate.allowedDirectories.map(normalizeDirectory);
  if (new Set(allowedDirectories).size !== allowedDirectories.length) {
    throw new Error("runMandate.allowedDirectories contains duplicate directories");
  }
  const maximumGoals = boundedInteger(candidate.maximumGoals, "runMandate.maximumGoals", 1, 20);
  const maximumCapabilityImprovements = boundedInteger(
    candidate.maximumCapabilityImprovements ?? 0,
    "runMandate.maximumCapabilityImprovements",
    0,
    19,
  );
  if (maximumGoals + maximumCapabilityImprovements > 20) {
    throw new Error(
      "runMandate maximumGoals plus maximumCapabilityImprovements may not exceed 20",
    );
  }
  return Object.freeze({
    allowedDirectories: Object.freeze(allowedDirectories),
    maximumGoals,
    maximumCapabilityImprovements,
    maximumImprovementDepth: boundedInteger(
      candidate.maximumImprovementDepth ?? 2,
      "runMandate.maximumImprovementDepth",
      1,
      2,
    ),
    maximumDurationMs: boundedInteger(candidate.maximumDurationMs, "runMandate.maximumDurationMs", 1_000, 86_400_000),
    maximumCostUsd: money(candidate.maximumCostUsd, "runMandate.maximumCostUsd"),
    maximumDailyCostUsd: money(candidate.maximumDailyCostUsd, "runMandate.maximumDailyCostUsd"),
  });
}

export function assertGoalRunTargetAllowed(
  mandate: GoalRunMandateRequest,
  targetPath: string,
): string {
  const normalized = normalizeGoalMandatePath(targetPath);
  if (isHardProtectedGoalPath(normalized)) {
    throw new GoalMandateBoundaryError("hard-protection", "core-and-guardians", normalized);
  }
  const allowed = mandate.allowedDirectories.some((directory) => {
    const root = directory.slice(0, -1);
    return normalized === root || normalized.startsWith(directory);
  });
  if (!allowed || path.posix.dirname(normalized) === ".") {
    throw new GoalMandateBoundaryError(
      "path",
      mandate.allowedDirectories.join(","),
      normalized,
    );
  }
  return normalized;
}

export const GOAL_RUN_CAPABILITY_FAILURE_LIMIT = 3;