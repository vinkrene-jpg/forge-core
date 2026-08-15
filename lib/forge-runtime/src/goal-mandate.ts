import { randomUUID } from "node:crypto";
import path from "node:path";

export type GoalMandateBoundary =
  | "path"
  | "mission-count"
  | "capability-improvements"
  | "improvement-depth"
  | "duration"
  | "cost"
  | "hard-protection";

export interface GoalMandateRequest {
  readonly allowedPaths: readonly string[];
  readonly maximumMissions: number;
  readonly maximumDurationMs: number;
  readonly maximumCostUsd: number;
}

export interface AuthorizedGoalMandate extends GoalMandateRequest {
  readonly id: string;
  readonly goalMissionId: string;
  readonly approvalId: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly baselineCostUsd: number;
}

export class GoalMandateBoundaryError extends Error {
  readonly boundary: GoalMandateBoundary;
  readonly limit: string | number;
  readonly actual: string | number;

  constructor(
    boundary: GoalMandateBoundary,
    limit: string | number,
    actual: string | number,
  ) {
    super(`Goal mandate boundary ${boundary} exceeded: limit=${limit}; actual=${actual}`);
    this.name = "GoalMandateBoundaryError";
    this.boundary = boundary;
    this.limit = limit;
    this.actual = actual;
  }
}

export const HARD_PROTECTED_FORGE_FILES = [
  "artifacts/api-server/src/lib/corelock.ts",
  "lib/forge-runtime/src/goal-build-graph.ts",
  "lib/forge-runtime/src/goal-mandate.ts",
  "lib/forge-runtime/src/governance.ts",
  "lib/forge-runtime/src/governance-engine.ts",
  "lib/forge-runtime/src/governance-store.ts",
  "lib/forge-runtime/src/kernel.ts",
  "lib/forge-runtime/src/mission-ai-review.ts",
  "lib/forge-runtime/src/mission-review.ts",
  "lib/forge-runtime/src/runtime-state.ts",
  "lib/forge-runtime/src/workspace-executor.ts",
] as const;

const hardProtectedPaths = [
  "GOVERNANCE/",
  ...HARD_PROTECTED_FORGE_FILES,
] as const;

const allowedMutationRoots = new Set(["sandbox", "lib", "artifacts"]);

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error("goalMandate.maximumCostUsd must be between 0 and 1000000");
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function normalizeGoalMandatePath(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
    throw new Error("Goal mandate path is required and may contain at most 500 characters");
  }
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (
    normalized.length === 0 ||
    normalized === "." ||
    path.isAbsolute(value) ||
    segments.some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe goal mandate path: ${value}`);
  }
  return segments.join("/");
}

export function isHardProtectedGoalPath(targetPath: string): boolean {
  const normalized = normalizeGoalMandatePath(targetPath);
  return hardProtectedPaths.some((protectedPath) =>
    protectedPath.endsWith("/")
      ? normalized.startsWith(protectedPath)
      : normalized === protectedPath
  );
}

export function parseGoalMandateRequest(value: unknown): GoalMandateRequest {
  const candidate = record(value, "goalMandate");
  if (!Array.isArray(candidate.allowedPaths) || candidate.allowedPaths.length === 0 || candidate.allowedPaths.length > 20) {
    throw new Error("goalMandate.allowedPaths must contain between 1 and 20 exact paths");
  }
  const allowedPaths = candidate.allowedPaths.map(normalizeGoalMandatePath);
  if (new Set(allowedPaths).size !== allowedPaths.length) {
    throw new Error("goalMandate.allowedPaths contains duplicate paths");
  }
  const protectedTarget = allowedPaths.find(isHardProtectedGoalPath);
  if (protectedTarget) {
    throw new GoalMandateBoundaryError("hard-protection", "core-and-guardians", protectedTarget);
  }
  const outsideAllowedRoots = allowedPaths.find((targetPath) => {
    const segments = targetPath.split("/");
    return segments.length < 2 || !allowedMutationRoots.has(segments[0].toLowerCase());
  });
  if (outsideAllowedRoots) {
    throw new GoalMandateBoundaryError(
      "path",
      "sandbox/,lib/,artifacts/",
      outsideAllowedRoots,
    );
  }

  return Object.freeze({
    allowedPaths: Object.freeze(allowedPaths),
    maximumMissions: boundedInteger(candidate.maximumMissions, "goalMandate.maximumMissions", 1, 20),
    maximumDurationMs: boundedInteger(candidate.maximumDurationMs, "goalMandate.maximumDurationMs", 1_000, 86_400_000),
    maximumCostUsd: money(candidate.maximumCostUsd),
  });
}

export function authorizeGoalMandate(input: {
  readonly request: GoalMandateRequest;
  readonly goalMissionId: string;
  readonly approvalId: string;
  readonly authorizedAt: string;
  readonly baselineCostUsd: number;
}): AuthorizedGoalMandate {
  const authorizedAtMs = Date.parse(input.authorizedAt);
  if (!Number.isFinite(authorizedAtMs)) {
    throw new Error("Goal mandate authorization time is invalid");
  }
  return Object.freeze({
    ...input.request,
    id: randomUUID(),
    goalMissionId: input.goalMissionId,
    approvalId: input.approvalId,
    authorizedAt: input.authorizedAt,
    expiresAt: new Date(authorizedAtMs + input.request.maximumDurationMs).toISOString(),
    baselineCostUsd: money(input.baselineCostUsd),
  });
}

export function assertGoalMandateBoundaries(input: {
  readonly mandate: GoalMandateRequest | AuthorizedGoalMandate;
  readonly targets: readonly string[];
  readonly missionCount: number;
  readonly now?: string;
  readonly actualCostUsd: number;
}): void {
  const allowed = new Set(input.mandate.allowedPaths);
  for (const rawTarget of input.targets) {
    const target = normalizeGoalMandatePath(rawTarget);
    if (isHardProtectedGoalPath(target)) {
      throw new GoalMandateBoundaryError("hard-protection", "core-and-guardians", target);
    }
    if (!allowed.has(target)) {
      throw new GoalMandateBoundaryError("path", [...allowed].join(","), target);
    }
  }
  if (input.missionCount > input.mandate.maximumMissions) {
    throw new GoalMandateBoundaryError("mission-count", input.mandate.maximumMissions, input.missionCount);
  }
  if ("expiresAt" in input.mandate) {
    const now = Date.parse(input.now ?? new Date().toISOString());
    if (!Number.isFinite(now) || now >= Date.parse(input.mandate.expiresAt)) {
      throw new GoalMandateBoundaryError("duration", input.mandate.expiresAt, input.now ?? new Date().toISOString());
    }
  }
  const cost = money(input.actualCostUsd);
  if (cost > input.mandate.maximumCostUsd) {
    throw new GoalMandateBoundaryError("cost", input.mandate.maximumCostUsd, cost);
  }
}

export function assertGoalMandateTargetManifest(
  mandate: GoalMandateRequest,
  targets: readonly string[],
): void {
  const allowedPaths = mandate.allowedPaths.map(normalizeGoalMandatePath);
  const targetPaths = targets.map(normalizeGoalMandatePath);
  const allowed = new Set(allowedPaths);
  const requested = new Set(targetPaths);
  const exact =
    allowed.size === allowedPaths.length &&
    requested.size === targetPaths.length &&
    allowed.size === requested.size &&
    [...allowed].every((targetPath) => requested.has(targetPath));

  if (!exact) {
    throw new GoalMandateBoundaryError(
      "path",
      allowedPaths.join(","),
      targetPaths.join(","),
    );
  }
}