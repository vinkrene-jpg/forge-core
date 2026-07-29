import { createHash, randomUUID } from "node:crypto";
import {
  parseWorkspaceChangeRequest,
  type WorkspaceChangeRequest,
} from "./workspace-executor";

export interface WorkspacePlanningTarget {
  readonly path: string;
  readonly expectedSha256: string | null;
  readonly exists: boolean;
}

export interface WorkspaceChangePlan {
  readonly id: string;
  readonly missionId: string;
  readonly projectId: string;
  readonly objective: string;
  readonly summary: string;
  readonly targets: readonly WorkspacePlanningTarget[];
  readonly request: WorkspaceChangeRequest;
  readonly compositionId: string;
  readonly executionId: string;
  readonly providerOutputSha256: string;
  readonly createdAt: string;
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }

  if (value.length > maximum) {
    throw new Error(`${field} exceeds ${maximum} characters`);
  }

  return value.trim();
}

function assertSecretFree(value: string): void {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\bsk-[a-z0-9_-]{20,}\b/i,
    /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[a-z0-9_./+=-]{16,}/i,
  ];

  if (patterns.some((pattern) => pattern.test(value))) {
    throw new Error("Workspace provider plan contains secret-like material");
  }
}

export function parseWorkspaceProviderPlan(input: {
  readonly missionId: string;
  readonly projectId: string;
  readonly objective: string;
  readonly targets: readonly WorkspacePlanningTarget[];
  readonly compositionId: string;
  readonly executionId: string;
  readonly outputText: string;
}): WorkspaceChangePlan {
  assertSecretFree(input.outputText);

  let decoded: unknown;

  try {
    decoded = JSON.parse(input.outputText);
  } catch {
    throw new Error("Workspace provider output must be one raw JSON object");
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("Workspace provider plan must be a JSON object");
  }

  const candidate = decoded as Readonly<Record<string, unknown>>;

  if (candidate.schemaVersion !== 1) {
    throw new Error("Unsupported workspace provider plan schemaVersion");
  }

  const allowedKeys = new Set([
    "schemaVersion",
    "summary",
    "changes",
    "verification",
    "commit",
  ]);
  const unexpected = Object.keys(candidate).filter((key) => !allowedKeys.has(key));

  if (unexpected.length > 0) {
    throw new Error(`Unexpected workspace plan fields: ${unexpected.join(", ")}`);
  }

  const request = parseWorkspaceChangeRequest({
    changes: candidate.changes,
    verification: candidate.verification,
    commit: candidate.commit,
  });

  if (request.commit?.push === true) {
    throw new Error("A provider-generated workspace plan may not request Git push");
  }

  if (request.commit === null) {
    throw new Error("A provider-generated workspace plan must request a verified local commit");
  }

  if (!request.verification.includes("typecheck")) {
    throw new Error("A provider-generated workspace plan must include typecheck");
  }

  const targets = new Map(input.targets.map((target) => [target.path, target]));

  for (const change of request.changes) {
    const target = targets.get(change.path);

    if (!target) {
      throw new Error(`Provider planned an unapproved target path: ${change.path}`);
    }

    if (target.expectedSha256 !== change.expectedSha256) {
      throw new Error(`Provider changed the source precondition for ${change.path}`);
    }
  }

  return Object.freeze({
    id: randomUUID(),
    missionId: input.missionId,
    projectId: input.projectId,
    objective: requiredText(input.objective, "objective", 10_000),
    summary: requiredText(candidate.summary, "summary", 2_000),
    targets: Object.freeze(input.targets.map((target) => Object.freeze({ ...target }))),
    request,
    compositionId: input.compositionId,
    executionId: input.executionId,
    providerOutputSha256: createHash("sha256")
      .update(input.outputText, "utf8")
      .digest("hex"),
    createdAt: new Date().toISOString(),
  });
}
