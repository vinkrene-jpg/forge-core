import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  dbEngine,
  resolvedSqlitePath,
} from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isStorageWritable } from "../lib/storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function checkDatabaseConnection(): Promise<void> {
  if (dbEngine === "postgres") {
    await db.execute(sql`SELECT 1`);
    return;
  }

  if (!resolvedSqlitePath) {
    throw new Error("SQLite database path is unavailable");
  }

  const sqlite = (db as unknown as {
    readonly $client: {
      prepare(statement: string): { get(): unknown };
    };
  }).$client;
  sqlite.prepare("SELECT 1").get();
}

router.get("/healthz", async (_req, res): Promise<void> => {
  let database = "ok";
  try {
    await checkDatabaseConnection();
  } catch (error) {
    database = "unreachable";
    logger.error({ error }, "Database health check failed");
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
