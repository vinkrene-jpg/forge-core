import { Router, type IRouter } from "express";
import { forgeRuntime } from "@workspace/forge-runtime";

const router: IRouter = Router();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

router.get("/autonomy", (_req, res): void => {
  res.json(forgeRuntime.autonomySummary());
});

router.post("/autonomy/start", async (_req, res): Promise<void> => {
  try {
    const summary = await forgeRuntime.setAutonomyEnabled(true);
    res.status(200).json(summary);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

router.post("/autonomy/stop", async (_req, res): Promise<void> => {
  try {
    const summary = await forgeRuntime.setAutonomyEnabled(false);
    res.status(200).json(summary);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

router.post("/autonomy/resume", async (_req, res): Promise<void> => {
  try {
    const summary = forgeRuntime.resumeAutonomy();
    res.status(200).json(summary);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

export default router;
