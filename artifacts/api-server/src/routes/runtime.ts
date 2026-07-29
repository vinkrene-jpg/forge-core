import { Router, type IRouter } from "express";
import { forgeRuntime } from "@workspace/forge-runtime";

const router: IRouter = Router();

router.get("/runtime", (_req, res): void => {
  res.json(forgeRuntime.snapshot());
});

export default router;
