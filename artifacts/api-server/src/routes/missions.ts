import { Router, type IRouter } from "express";
import {
  type ForgeRuntime,
  forgeRuntime,
  type BuildGraph,
  type CreateMissionRequest,
} from "@workspace/forge-runtime";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

type MissionsRuntime = Pick<
  ForgeRuntime,
  | "listMissions"
  | "getMission"
  | "createMission"
  | "createGoalBuildGraph"
  | "evaluateGoalBuildGraph"
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

router.post("/goal-builds", async (req, res): Promise<void> => {
  try {
    const body = req.body as Readonly<Record<string, unknown>>;
    const result = await runtime.createGoalBuildGraph(
      body.goalSpec,
      body.proposal,
      body.mandate,
    );
    res.status(202).json({
      ...result.mission,
      governance: result.governance,
      approval: result.approval,
      capabilityAnalysis: result.capabilityAnalysis,
    });
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

router.get("/goal-builds/:missionId/report", async (req, res): Promise<void> => {
  const mission = runtime.getMission(req.params.missionId);
  const graph = mission?.kind === "operator.goal-build"
    ? mission.output?.graph as BuildGraph | undefined
    : undefined;
  if (!graph) {
    res.status(404).json({ error: "Goal build graph is not materialized" });
    return;
  }
  res.json(await runtime.evaluateGoalBuildGraph(graph));
});

return router;
}

export default createMissionsRouter();