import { db, coreComponentsTable } from "@workspace/db";
import { CORE_COMPONENTS } from "./corelock";
import { logger } from "./logger";

export async function seedCoreRegistry(): Promise<void> {
  const existing = await db.select().from(coreComponentsTable);
  if (existing.length >= CORE_COMPONENTS.length) return;
  const existingKeys = new Set(existing.map((c) => c.key));
  const missing = CORE_COMPONENTS.filter((c) => !existingKeys.has(c.key));
  if (missing.length === 0) return;
  await db.insert(coreComponentsTable).values(
    missing.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      locked: true,
      version: "1.0.0",
    })),
  );
  logger.info({ count: missing.length }, "Seeded locked core registry");
}
