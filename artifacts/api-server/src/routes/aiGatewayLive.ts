import { Router, type IRouter } from "express";
import { forgeRuntime } from "@workspace/forge-runtime";

const router: IRouter = Router();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

router.get(
  "/ai-gateway/status",
  (_req, res): void => {
    res.json({
      status:
        forgeRuntime.aiGatewayStatus(),
      summary:
        forgeRuntime.aiGatewaySummary(),
    });
  },
);

router.get(
  "/ai-gateway/executions",
  (_req, res): void => {
    res.json({
      executions:
        forgeRuntime.listAiExecutions(),
    });
  },
);

router.get(
  "/ai-gateway/executions/:executionId",
  (req, res): void => {
    const execution =
      forgeRuntime.getAiExecution(
        req.params.executionId,
      );

    if (!execution) {
      res.status(404).json({
        error: "AI execution not found",
      });
      return;
    }

    res.json(execution);
  },
);

router.post(
  "/ai-gateway/executions",
  async (req, res): Promise<void> => {
    try {
      const compositionId = String(
        req.body?.compositionId ?? "",
      ).trim();

      if (compositionId.length === 0) {
        throw new Error(
          "compositionId is required",
        );
      }

      const execution =
        await forgeRuntime.executePromptComposition(
          compositionId,
        );

      res.status(202).json(execution);
    } catch (error) {
      res.status(400).json({
        error: message(error),
      });
    }
  },
);

export default router;