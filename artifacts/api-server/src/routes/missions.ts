import { Router, type IRouter } from "express";
import {
  forgeRuntime,
  type CreateMissionRequest,
} from "@workspace/forge-runtime";

const router: IRouter = Router();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

router.get("/missions", (_req, res): void => {
  res.json({
    missions: forgeRuntime.listMissions(),
  });
});

router.get("/missions/:missionId", (req, res): void => {
  const mission = forgeRuntime.getMission(
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
    const result = await forgeRuntime.createMission(request);

    res.status(202).json({
      ...result.mission,
      governance: result.assessment,
      approval: result.approval,
    });
  } catch (error) {
    res.status(400).json({
      error: message(error),
    });
  }
});

export default router;