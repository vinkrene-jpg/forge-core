import { Router, type IRouter } from "express";
import { forgeRuntime } from "@workspace/forge-runtime";
import {
  MirrorProjectionService,
  MirrorProjectionTimeoutError,
  type MirrorProjectionSource,
} from "../lib/mirrorProjection";

export function createMirrorRouter(
  runtime: MirrorProjectionSource = forgeRuntime,
): IRouter {
  const router: IRouter = Router();
  const projection = new MirrorProjectionService(runtime);

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

  return router;
}

export default createMirrorRouter();