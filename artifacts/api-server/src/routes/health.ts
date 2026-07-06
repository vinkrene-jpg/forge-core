import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isStorageWritable } from "../lib/storage";

const router: IRouter = Router();

router.get("/healthz", async (_req, res): Promise<void> => {
  let database = "ok";
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    database = "unreachable";
  }
  const storage = isStorageWritable() ? "ok" : "unwritable";
  const data = HealthCheckResponse.parse({
    status: database === "ok" && storage === "ok" ? "ok" : "degraded",
    database,
    storage,
  });
  res.json(data);
});

export default router;
