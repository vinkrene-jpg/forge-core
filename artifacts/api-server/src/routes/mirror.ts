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
import {
  buildMirrorIntakeMissionRequest,
  parseMirrorIntakeBody,
} from "../lib/mirrorIntake";

export { parseMirrorIntakeBody };

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

      const request: CreateMissionRequest = buildMirrorIntakeMissionRequest(intake);
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