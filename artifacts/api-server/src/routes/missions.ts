import { Router, type IRouter } from "express";
import {
  type ForgeRuntime,
  forgeRuntime,
  type CreateMissionRequest,
} from "@workspace/forge-runtime";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

type MissionsRuntime = Pick<
  ForgeRuntime,
  "listMissions" | "getMission" | "createMission"
>;

export function createMissionsRouter(
  runtime: MissionsRuntime = forgeRuntime,
): IRouter {
const router: IRouter = Router();

router.get("/missions", (_req, res): void => {
  res.json({
    missions: runtime.listMissions(),
  });
});

router.get("/missions/:missionId", (req, res): void => {
  const mission = runtime.getMission(
    req.params.missionId,
  );

  if (mission === null) {
    res.status(404).json({
      error: "Mission not found",
    });
    return;
  }

  res.json(mission);
});

router.post("/missions", async (req, res): Promise<void> => {
  try {
    const request = req.body as CreateMissionRequest;
    const result = await runtime.createMission(request);

    res.status(202).json({
      ...result.mission,
      governance: result.governance,
      approval: result.approval,
      capabilityAnalysis: result.capabilityAnalysis,
    });
  } catch (error) {
    res.status(400).json({
      error: message(error),
    });
  }
});

return router;
}

export default createMissionsRouter();