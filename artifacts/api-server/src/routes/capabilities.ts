import { Router, type IRouter } from "express";
import {
  forgeRuntime,
  type CapabilityAnalysisRequest,
  type UpsertCapabilityRequest,
} from "@workspace/forge-runtime";

const router: IRouter = Router();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

router.get("/capabilities", (_req, res): void => {
  res.json({
    capabilities: forgeRuntime.listCapabilities(),
  });
});

router.get(
  "/capabilities/:capabilityId",
  (req, res): void => {
    const capability = forgeRuntime.getCapability(
      req.params.capabilityId,
    );

    if (capability === null) {
      res.status(404).json({
        error: "Capability not found",
      });
      return;
    }

    res.json(capability);
  },
);

router.post(
  "/capabilities",
  async (req, res): Promise<void> => {
    try {
      const capability = await forgeRuntime.upsertCapability(
        req.body as UpsertCapabilityRequest,
      );

      res.status(201).json(capability);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.get(
  "/capability-analysis",
  (_req, res): void => {
    res.json({
      analyses: forgeRuntime.listCapabilityAnalyses(),
    });
  },
);

router.get(
  "/capability-analysis/:analysisId",
  (req, res): void => {
    const analysis = forgeRuntime.getCapabilityAnalysis(
      req.params.analysisId,
    );

    if (analysis === null) {
      res.status(404).json({
        error: "Capability analysis not found",
      });
      return;
    }

    res.json(analysis);
  },
);

router.get("/capability-gaps", (_req, res): void => {
  res.json({
    candidates: forgeRuntime.listCapabilityGapCandidates(),
  });
});

router.post(
  "/capability-gaps/:candidateId/release",
  async (req, res): Promise<void> => {
    try {
      const mission = await forgeRuntime.releaseCapabilityGapCandidate(
        req.params.candidateId,
        String(req.body?.actor ?? ""),
      );
      res.status(201).json({ mission });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  },
);

router.post(
  "/capability-analysis",
  async (req, res): Promise<void> => {
    try {
      const analysis =
        await forgeRuntime.analyzeCapabilities(
          req.body as CapabilityAnalysisRequest,
        );

      res.status(201).json(analysis);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.post(
  "/evolution-plans/:planId/approve",
  async (req, res): Promise<void> => {
    try {
      const actor = String(req.body?.actor ?? "").trim();

      if (actor.length === 0) {
        throw new Error("actor is required");
      }

      const plan =
        await forgeRuntime.approveEvolutionPlan(
          req.params.planId,
          actor,
        );

      res.json(plan);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

router.post(
  "/evolution-plans/:planId/execute",
  async (req, res): Promise<void> => {
    try {
      const plan =
        await forgeRuntime.executeEvolutionPlan(
          req.params.planId,
        );

      res.json(plan);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);
router.get("/evolution-plans", (_req, res): void => {
  res.json({
    plans: forgeRuntime.listEvolutionPlans(),
  });
});

router.get(
  "/evolution-plans/:planId",
  (req, res): void => {
    const plan = forgeRuntime.getEvolutionPlan(
      req.params.planId,
    );

    if (plan === null) {
      res.status(404).json({
        error: "Evolution plan not found",
      });
      return;
    }

    res.json(plan);
  },
);

router.post(
  "/evolution-plans",
  async (req, res): Promise<void> => {
    try {
      const analysisId = String(
        req.body?.analysisId ?? "",
      ).trim();

      if (analysisId.length === 0) {
        throw new Error("analysisId is required");
      }

      const plan =
        await forgeRuntime.createEvolutionPlan(
          analysisId,
        );

      res.status(201).json(plan);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

export default router;