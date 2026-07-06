import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc, and } from "drizzle-orm";
import { db, tasksTable, decisionsTable, risksTable } from "@workspace/db";
import {
  ListTasksQueryParams,
  ListTasksResponse,
  CreateTaskBody,
  CreateTaskResponse,
  GetTaskParams,
  GetTaskResponse,
  UpdateTaskParams,
  UpdateTaskBody,
  UpdateTaskResponse,
  DeleteTaskParams,
  ListDecisionsQueryParams,
  ListDecisionsResponse,
  CreateDecisionBody,
  CreateDecisionResponse,
  ListRisksQueryParams,
  ListRisksResponse,
  CreateRiskBody,
  CreateRiskResponse,
  UpdateRiskParams,
  UpdateRiskBody,
  UpdateRiskResponse,
} from "@workspace/api-zod";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.get("/tasks", async (req, res): Promise<void> => {
  const query = ListTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const conditions = [];
  if (query.data.projectId != null) conditions.push(eq(tasksTable.projectId, query.data.projectId));
  if (query.data.status != null) conditions.push(eq(tasksTable.status, query.data.status));
  const rows = conditions.length > 0
    ? await db.select().from(tasksTable).where(and(...conditions)).orderBy(desc(tasksTable.createdAt))
    : await db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt));
  res.json(ListTasksResponse.parse(jsonSafe(rows)));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const body = CreateTaskBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(tasksTable).values(body.data).returning();
  await audit({ actor: "task-manager", action: "task_created", targetType: "task", targetId: row.id, details: row.title });
  res.status(201).json(CreateTaskResponse.parse(jsonSafe(row)));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(GetTaskResponse.parse(jsonSafe(row)));
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateTaskBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.status === "blocked" && !body.data.blockedReason) {
    res.status(400).json({ error: "A blocked task requires a blockedReason" });
    return;
  }
  const [row] = await db
    .update(tasksTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(tasksTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (body.data.status) {
    await audit({
      actor: "task-manager",
      action: "task_status_changed",
      targetType: "task",
      targetId: row.id,
      details: `Status → ${body.data.status}${body.data.blockedReason ? ` (${body.data.blockedReason})` : ""}`,
    });
  }
  res.json(UpdateTaskResponse.parse(jsonSafe(row)));
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/decisions", async (req, res): Promise<void> => {
  const query = ListDecisionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = query.data.projectId != null
    ? await db.select().from(decisionsTable).where(eq(decisionsTable.projectId, query.data.projectId)).orderBy(desc(decisionsTable.createdAt))
    : await db.select().from(decisionsTable).orderBy(desc(decisionsTable.createdAt));
  res.json(ListDecisionsResponse.parse(jsonSafe(rows)));
});

router.post("/decisions", async (req, res): Promise<void> => {
  const body = CreateDecisionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(decisionsTable).values(body.data).returning();
  await audit({ actor: row.madeBy, action: "decision_recorded", targetType: "decision", targetId: row.id, details: row.title });
  res.status(201).json(CreateDecisionResponse.parse(jsonSafe(row)));
});

router.get("/risks", async (req, res): Promise<void> => {
  const query = ListRisksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = query.data.projectId != null
    ? await db.select().from(risksTable).where(eq(risksTable.projectId, query.data.projectId))
    : await db.select().from(risksTable);
  res.json(ListRisksResponse.parse(jsonSafe(rows)));
});

router.post("/risks", async (req, res): Promise<void> => {
  const body = CreateRiskBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(risksTable).values(body.data).returning();
  res.status(201).json(CreateRiskResponse.parse(jsonSafe(row)));
});

router.patch("/risks/:id", async (req, res): Promise<void> => {
  const params = UpdateRiskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateRiskBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.update(risksTable).set(body.data).where(eq(risksTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Risk not found" });
    return;
  }
  res.json(UpdateRiskResponse.parse(jsonSafe(row)));
});

export default router;
