import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { forgeRuntime, type CreateMissionRequest, type ForgeRuntime } from "@workspace/forge-runtime";
import {
  MirrorProjectionService,
  MirrorProjectionTimeoutError,
  type MirrorProjectionSource,
} from "../lib/mirrorProjection";
import { selectMirrorResume } from "../lib/mirrorResume";
import { projectMirrorSession } from "../lib/mirrorSession";
import { audit } from "../lib/audit";

type MirrorIntakePriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

interface MirrorIntakeBody {
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

interface MirrorRouterDependencies {
  readonly projectExists: (projectId: number) => Promise<boolean>;
  readonly recordAudit: typeof audit;
}

const defaultDependencies: MirrorRouterDependencies = Object.freeze({
  projectExists: async (projectId: number) => {
    const [project] = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    return project !== undefined;
  },
  recordAudit: audit,
});

const FIELD_LIMITS = Object.freeze({
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

function normalizeText(value: unknown, field: string, maximum: number, required = false): string {
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

function normalizeList(value: unknown, field: string): readonly string[] {
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

export function createMirrorRouter(
  runtime: MirrorProjectionSource = forgeRuntime,
  dependencies: MirrorRouterDependencies = defaultDependencies,
): IRouter {
  const router: IRouter = Router();
  const projection = new MirrorProjectionService(runtime);

  router.post("/mirror/missions", async (req, res): Promise<void> => {
    const actor = String(req.header("x-forge-actor") ?? "").trim();
    const role = String(req.header("x-forge-role") ?? "").trim().toLowerCase();
    if (!actor || (role !== "owner" && role !== "operator")) {
      res.status(403).json({ error: "Mission intake requires an authorized operator actor" });
      return;
    }

    try {
      const intake = parseMirrorIntakeBody(req.body);
      if (actor !== intake.requestedBy) {
        res.status(403).json({ error: "requestedBy must match the authorized actor" });
        return;
      }
      const headerKey = req.header("idempotency-key")?.trim();
      if (headerKey && headerKey !== intake.requestId) {
        res.status(400).json({ error: "Idempotency-Key must match requestId" });
        return;
      }
      if (intake.projectId !== null) {
        if (!await dependencies.projectExists(intake.projectId)) {
          res.status(400).json({ error: "projectId does not reference an existing project" });
          return;
        }
      }

      const request: CreateMissionRequest = Object.freeze({
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
      const result = await (runtime as MirrorProjectionSource & Pick<ForgeRuntime, "createMission">)
        .createMission(request);
      await dependencies.recordAudit({
        actor,
        action: "mirror_mission_intake_created",
        targetType: "mission",
        targetId: result.mission.id,
        details: `sourceType=CLAUDE_MIRROR priority=${intake.priority} projectId=${intake.projectId ?? "none"}`,
      });
      res.status(201).json({
        missionId: result.mission.id,
        status: "NOT_STARTED",
        createdAt: result.mission.createdAt,
        detailUrl: `/mirror/${encodeURIComponent(result.mission.id)}`,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid mission intake" });
    }
  });

  router.get("/mirror/missions", (_req, res): void => {
    const startedAt = performance.now();
    try {
      const missions = projection.listMissions();
      const projectedAt = performance.now();
      const body = JSON.stringify({ missions });
      const serializedAt = performance.now();
      res.setHeader(
        "Server-Timing",
        `projection;dur=${(projectedAt - startedAt).toFixed(1)}, ` +
          `serialization;dur=${(serializedAt - projectedAt).toFixed(1)}`,
      );
      res.type("application/json").send(body);
    } catch (error) {
      if (error instanceof MirrorProjectionTimeoutError) {
        res.status(503).json({ error: "Mirror mission list projection timed out" });
        return;
      }
      throw error;
    }
  });

  router.get("/mirror/missions/:missionId", (req, res): void => {
    const mission = projection.getMission(req.params.missionId);
    if (!mission) {
      res.status(404).json({ error: "Mirror mission projection not found" });
      return;
    }

    res.json(mission);
  });

  router.get("/mirror/session/:missionId", (req, res): void => {
    const mission = projection.getMission(req.params.missionId);
    if (!mission) {
      res.status(404).json({ error: "Mirror session projection not found" });
      return;
    }

    res.json(projectMirrorSession(mission));
  });

  router.get("/mirror/resume", (_req, res): void => {
    try {
      res.json(selectMirrorResume(projection.listMissionProjections()));
    } catch (error) {
      if (error instanceof MirrorProjectionTimeoutError) {
        res.status(503).json({ error: "Mirror resume projection timed out" });
        return;
      }
      throw error;
    }
  });

  router.get("/mirror/resume/:missionId", (req, res): void => {
    const mission = projection.getMission(req.params.missionId);
    if (!mission) {
      res.status(404).json({ error: "Mirror resume projection not found" });
      return;
    }

    res.json(selectMirrorResume([mission], req.params.missionId));
  });

  return router;
}

export default createMirrorRouter();