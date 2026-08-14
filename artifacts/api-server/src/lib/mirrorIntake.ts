// Claude Mirror intake contract — dependency-free (no database, no HTTP).
// Shared by the HTTP intake route and the incoming-folder intake service so
// both validate and build missions identically. Keeping this db-free lets the
// folder intake and its tests avoid the database layer entirely.

import type { CreateMissionRequest } from "@workspace/forge-runtime";

export type MirrorIntakePriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface MirrorIntakeBody {
  readonly requestId: string;
  readonly title: string;
  readonly objective: string;
  readonly context: string;
  readonly requestedBy: string;
  readonly priority: MirrorIntakePriority;
  readonly projectId: number | null;
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly string[];
}

export const FIELD_LIMITS = Object.freeze({
  requestId: 128,
  title: 160,
  objective: 4_000,
  context: 8_000,
  requestedBy: 120,
  listItem: 1_000,
  listItems: 50,
});

const PRIORITIES = new Set<MirrorIntakePriority>(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const UNSAFE_TEXT = /<\s*\/?\s*[a-z][^>]*>|javascript\s*:|on[a-z]+\s*=|[a-z]:\\|file:\/\/|\\\\/i;

export function normalizeText(
  value: unknown,
  field: string,
  maximum: number,
  required = false,
): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && normalized.length === 0) throw new Error(`${field} is required`);
  if (normalized.length > maximum) throw new Error(`${field} exceeds ${maximum} characters`);
  if (UNSAFE_TEXT.test(normalized)) throw new Error(`${field} contains unsafe markup or local path data`);
  return normalized;
}

export function normalizeList(value: unknown, field: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > FIELD_LIMITS.listItems) {
    throw new Error(`${field} must contain at most ${FIELD_LIMITS.listItems} items`);
  }
  return Object.freeze(value.map((item) => normalizeText(item, field, FIELD_LIMITS.listItem, true)));
}

export function parseMirrorIntakeBody(value: unknown): MirrorIntakeBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  const body = value as Readonly<Record<string, unknown>>;
  const requestId = normalizeText(body.requestId, "requestId", FIELD_LIMITS.requestId, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(requestId)) {
    throw new Error("requestId contains invalid characters");
  }
  const priority = normalizeText(body.priority, "priority", 16, true).toUpperCase();
  if (!PRIORITIES.has(priority as MirrorIntakePriority)) {
    throw new Error("priority is invalid");
  }
  let projectId: number | null = null;
  if (body.projectId !== undefined && body.projectId !== null && body.projectId !== "") {
    const candidate = typeof body.projectId === "number" ? body.projectId : Number(body.projectId);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new Error("projectId is invalid");
    projectId = candidate;
  }
  return Object.freeze({
    requestId,
    title: normalizeText(body.title, "title", FIELD_LIMITS.title, true),
    objective: normalizeText(body.objective, "objective", FIELD_LIMITS.objective, true),
    context: normalizeText(body.context, "context", FIELD_LIMITS.context),
    requestedBy: normalizeText(body.requestedBy, "requestedBy", FIELD_LIMITS.requestedBy, true),
    priority: priority as MirrorIntakePriority,
    projectId,
    constraints: normalizeList(body.constraints, "constraints"),
    acceptanceCriteria: normalizeList(body.acceptanceCriteria, "acceptanceCriteria"),
  });
}

/**
 * Builds the inert Claude Mirror intake mission request from a validated body.
 * The mission is recorded as `operator.mirror-intake` and is never executed
 * automatically; it only captures the request under governance.
 */
export function buildMirrorIntakeMissionRequest(
  intake: MirrorIntakeBody,
): CreateMissionRequest {
  return Object.freeze({
    kind: "operator.mirror-intake",
    title: intake.title,
    idempotencyKey: intake.requestId,
    input: Object.freeze({
      objective: intake.objective,
      context: intake.context,
      requestedBy: intake.requestedBy,
      priority: intake.priority,
      projectId: intake.projectId,
      constraints: intake.constraints,
      acceptanceCriteria: intake.acceptanceCriteria,
      sourceType: "CLAUDE_MIRROR",
      correlationId: intake.requestId,
    }),
  });
}
