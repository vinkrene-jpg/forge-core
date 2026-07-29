import { Router, type IRouter } from "express";
import { forgeRuntime } from "@workspace/forge-runtime";

const router: IRouter = Router();

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

router.get("/memory-bridge", (_req, res): void => {
  res.json({
    summary: forgeRuntime.memoryBridgeSummary(),
    currentContext: forgeRuntime.memoryBridgeCurrentContext(),
  });
});

router.get("/memory-bridge/context", (req, res): void => {
  const query =
    typeof req.query.query === "string"
      ? req.query.query
      : "";
  const limit = Number(req.query.limit ?? 8);

  res.json(
    forgeRuntime.memoryBridgeRelevantContext(
      query,
      Number.isFinite(limit) ? limit : 8,
    ),
  );
});

router.get("/memory-bridge/search", (req, res): void => {
  const query =
    typeof req.query.query === "string"
      ? req.query.query
      : "";
  const limit = Number(req.query.limit ?? 10);

  res.json({
    results: forgeRuntime.searchMemoryBridge({
      query,
      limit: Number.isFinite(limit) ? limit : 10,
    }),
  });
});

router.post("/memory-bridge/decisions", async (req, res): Promise<void> => {
  try {
    const entry = await forgeRuntime.recordMemoryBridgeDecision({
      title: String(req.body?.title ?? "").trim(),
      content: String(req.body?.content ?? "").trim(),
      tags: Array.isArray(req.body?.tags)
        ? req.body.tags.filter((value: unknown): value is string => typeof value === "string")
        : [],
      sourceMissionId:
        typeof req.body?.sourceMissionId === "string"
          ? req.body.sourceMissionId
          : null,
    });

    res.status(201).json(entry);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

router.post("/memory-bridge/learning", async (req, res): Promise<void> => {
  try {
    const entry = await forgeRuntime.recordMemoryBridgeLearning({
      title: String(req.body?.title ?? "").trim(),
      content: String(req.body?.content ?? "").trim(),
      tags: Array.isArray(req.body?.tags)
        ? req.body.tags.filter((value: unknown): value is string => typeof value === "string")
        : [],
      sourceMissionId:
        typeof req.body?.sourceMissionId === "string"
          ? req.body.sourceMissionId
          : null,
    });

    res.status(201).json(entry);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

router.post("/memory-bridge/capabilities", async (req, res): Promise<void> => {
  try {
    const entry = await forgeRuntime.recordMemoryBridgeCapability({
      title: String(req.body?.title ?? "").trim(),
      content: String(req.body?.content ?? "").trim(),
      tags: Array.isArray(req.body?.tags)
        ? req.body.tags.filter((value: unknown): value is string => typeof value === "string")
        : [],
      sourceMissionId:
        typeof req.body?.sourceMissionId === "string"
          ? req.body.sourceMissionId
          : null,
    });

    res.status(201).json(entry);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

router.put("/memory-bridge/current-context", async (req, res): Promise<void> => {
  try {
    const context = await forgeRuntime.upsertMemoryBridgeContext({
      summary: String(req.body?.summary ?? "").trim(),
      priorities: Array.isArray(req.body?.priorities)
        ? req.body.priorities.filter((value: unknown): value is string => typeof value === "string")
        : [],
      blockers: Array.isArray(req.body?.blockers)
        ? req.body.blockers.filter((value: unknown): value is string => typeof value === "string")
        : [],
      activeMissionIds: Array.isArray(req.body?.activeMissionIds)
        ? req.body.activeMissionIds.filter((value: unknown): value is string => typeof value === "string")
        : [],
    });

    res.status(200).json(context);
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

export default router;
