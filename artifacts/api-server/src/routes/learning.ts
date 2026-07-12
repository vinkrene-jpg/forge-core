import { Router, type IRouter } from "express";
import { forgeRuntime } from "@workspace/forge-runtime";

const router: IRouter = Router();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

router.get("/learning", (_req, res): void => {
  res.json({
    summary: forgeRuntime.learningSummary(),
    profiles: forgeRuntime.listLearningProfiles(),
    observations: forgeRuntime.listLearningObservations(),
    proposals: forgeRuntime.listLearningProposals(),
  });
});

router.post(
  "/learning/proposals/:proposalId/schedule",
  async (req, res): Promise<void> => {
    try {
      const result = await forgeRuntime.scheduleLearningProposal(
        req.params.proposalId,
      );

      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  },
);

export default router;
