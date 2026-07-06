import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc, or, ilike, and } from "drizzle-orm";
import { db, memoryItemsTable, improvementsTable, tasksTable } from "@workspace/db";
import {
  ListMemoryItemsQueryParams,
  ListMemoryItemsResponse,
  CreateMemoryItemBody,
  CreateMemoryItemResponse,
  DeleteMemoryItemParams,
  ListImprovementsResponse,
  CreateImprovementBody,
  CreateImprovementResponse,
  UpdateImprovementParams,
  UpdateImprovementBody,
  UpdateImprovementResponse,
  ConvertImprovementToTaskParams,
  ConvertImprovementToTaskResponse,
} from "@workspace/api-zod";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.get("/memory-items", async (req, res): Promise<void> => {
  const query = ListMemoryItemsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const conditions = [];
  if (query.data.q) {
    const pattern = `%${query.data.q}%`;
    conditions.push(or(ilike(memoryItemsTable.title, pattern), ilike(memoryItemsTable.content, pattern)));
  }
  if (query.data.category) {
    conditions.push(eq(memoryItemsTable.category, query.data.category));
  }
  const rows = conditions.length > 0
    ? await db.select().from(memoryItemsTable).where(and(...conditions)).orderBy(desc(memoryItemsTable.createdAt))
    : await db.select().from(memoryItemsTable).orderBy(desc(memoryItemsTable.createdAt));
  res.json(ListMemoryItemsResponse.parse(jsonSafe(rows)));
});

router.post("/memory-items", async (req, res): Promise<void> => {
  const body = CreateMemoryItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(memoryItemsTable)
    .values({ ...body.data, tags: body.data.tags ?? [] })
    .returning();
  await audit({ actor: "memory-engine", action: "memory_stored", targetType: "memory-item", targetId: row.id, details: `${row.category}: ${row.title}` });
  res.status(201).json(CreateMemoryItemResponse.parse(jsonSafe(row)));
});

router.delete("/memory-items/:id", async (req, res): Promise<void> => {
  const params = DeleteMemoryItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(memoryItemsTable).where(eq(memoryItemsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Memory item not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/improvements", async (_req, res): Promise<void> => {
  const rows = await db.select().from(improvementsTable).orderBy(desc(improvementsTable.createdAt));
  res.json(ListImprovementsResponse.parse(jsonSafe(rows)));
});

router.post("/improvements", async (req, res): Promise<void> => {
  const body = CreateImprovementBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(improvementsTable).values(body.data).returning();
  await audit({ actor: "self-improvement", action: "improvement_logged", targetType: "improvement", targetId: row.id, details: row.problem.slice(0, 120) });
  res.status(201).json(CreateImprovementResponse.parse(jsonSafe(row)));
});

router.patch("/improvements/:id", async (req, res): Promise<void> => {
  const params = UpdateImprovementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateImprovementBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(improvementsTable)
    .set(body.data)
    .where(eq(improvementsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Improvement not found" });
    return;
  }
  res.json(UpdateImprovementResponse.parse(jsonSafe(row)));
});

router.post("/improvements/:id/convert", async (req, res): Promise<void> => {
  const params = ConvertImprovementToTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [improvement] = await db.select().from(improvementsTable).where(eq(improvementsTable.id, params.data.id));
  if (!improvement) {
    res.status(404).json({ error: "Improvement not found" });
    return;
  }
  if (improvement.status === "converted") {
    res.status(400).json({ error: "Improvement was already converted to a task" });
    return;
  }
  const [task] = await db
    .insert(tasksTable)
    .values({
      title: improvement.proposedModule
        ? `Build module: ${improvement.proposedModule}`
        : `Improve: ${improvement.problem.slice(0, 100)}`,
      goal: improvement.expectedImprovement ?? improvement.problem,
      scope: improvement.cause ?? null,
      risk: improvement.risk,
      ownerAgent: "module-manager",
      status: "planned",
      acceptanceCriteria: improvement.requiredTests ?? "All mandatory test types pass; Guardian review passes.",
      source: `improvement:${improvement.id}`,
    })
    .returning();
  await db.update(improvementsTable).set({ status: "converted" }).where(eq(improvementsTable.id, improvement.id));
  await audit({
    actor: "self-improvement",
    action: "improvement_converted",
    targetType: "improvement",
    targetId: improvement.id,
    details: `Converted to task #${task.id}: ${task.title}`,
  });
  res.status(201).json(ConvertImprovementToTaskResponse.parse(jsonSafe(task)));
});

export default router;
