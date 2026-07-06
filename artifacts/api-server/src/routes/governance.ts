import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc } from "drizzle-orm";
import { db, testRunsTable, testRunStepsTable, approvalsTable, modulesTable } from "@workspace/db";
import {
  ListTestRunsQueryParams,
  ListTestRunsResponse,
  StartTestRunBody,
  StartTestRunResponse,
  GetTestRunParams,
  GetTestRunResponse,
  ListApprovalsQueryParams,
  ListApprovalsResponse,
  DecideApprovalParams,
  DecideApprovalBody,
  DecideApprovalResponse,
} from "@workspace/api-zod";
import { executeTestRun, TestTargetError } from "../lib/testRunner";
import { executeRealTestRun } from "../lib/realTestRunner";
import { governInstall } from "../lib/governor";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.get("/test-runs", async (req, res): Promise<void> => {
  const query = ListTestRunsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = query.data.moduleId != null
    ? await db.select().from(testRunsTable).where(eq(testRunsTable.moduleId, query.data.moduleId)).orderBy(desc(testRunsTable.createdAt))
    : await db.select().from(testRunsTable).orderBy(desc(testRunsTable.createdAt));
  res.json(ListTestRunsResponse.parse(jsonSafe(rows)));
});

router.post("/test-runs", async (req, res): Promise<void> => {
  const body = StartTestRunBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const row = body.data.mode === "real"
      ? await executeRealTestRun(body.data)
      : await executeTestRun(body.data);
    res.status(201).json(StartTestRunResponse.parse(jsonSafe(row)));
  } catch (err) {
    if (err instanceof TestTargetError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/test-runs/:id", async (req, res): Promise<void> => {
  const params = GetTestRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [run] = await db.select().from(testRunsTable).where(eq(testRunsTable.id, params.data.id));
  if (!run) {
    res.status(404).json({ error: "Test run not found" });
    return;
  }
  const steps = await db
    .select()
    .from(testRunStepsTable)
    .where(eq(testRunStepsTable.testRunId, run.id))
    .orderBy(testRunStepsTable.id);
  res.json(GetTestRunResponse.parse(jsonSafe({ run, steps })));
});

router.get("/approvals", async (req, res): Promise<void> => {
  const query = ListApprovalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = query.data.status != null
    ? await db.select().from(approvalsTable).where(eq(approvalsTable.status, query.data.status)).orderBy(desc(approvalsTable.createdAt))
    : await db.select().from(approvalsTable).orderBy(desc(approvalsTable.createdAt));
  const withNames = await Promise.all(
    rows.map(async (r) => {
      const [m] = await db.select({ name: modulesTable.name }).from(modulesTable).where(eq(modulesTable.id, r.moduleId));
      return { ...r, moduleName: m?.name ?? null };
    }),
  );
  res.json(ListApprovalsResponse.parse(jsonSafe(withNames)));
});

router.post("/approvals/:id/decide", async (req, res): Promise<void> => {
  const params = DecideApprovalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = DecideApprovalBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [approval] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, params.data.id));
  if (!approval) {
    res.status(404).json({ error: "Approval not found" });
    return;
  }
  if (approval.status !== "pending") {
    res.status(400).json({ error: `Approval already ${approval.status}` });
    return;
  }
  if (!body.data.approve && (!body.data.reason || body.data.reason.trim() === "")) {
    res.status(400).json({ error: "Rejection requires a reason. Every rejected approval must document why." });
    return;
  }
  // Single-owner platform: the decision identity is always the owner.
  // Never trust a caller-supplied identity for governance decisions.
  const decidedBy = "owner";
  const [updated] = await db
    .update(approvalsTable)
    .set({
      status: body.data.approve ? "approved" : "rejected",
      reason: body.data.reason ?? null,
      decidedBy,
      decidedAt: new Date(),
    })
    .where(eq(approvalsTable.id, approval.id))
    .returning();

  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, approval.moduleId));

  await audit({
    actor: decidedBy,
    action: body.data.approve ? "approval_granted" : "approval_rejected",
    targetType: "approval",
    targetId: approval.id,
    details: `Module '${module?.name ?? approval.moduleId}'${body.data.reason ? ` — ${body.data.reason}` : ""}`,
    outcome: body.data.approve ? "allowed" : "blocked",
  });

  if (body.data.approve && module) {
    // Approval granted → let the Governor complete the install pipeline.
    await governInstall(module);
  } else if (module) {
    await db
      .update(modulesTable)
      .set({ installStatus: "rejected", status: "rejected" })
      .where(eq(modulesTable.id, module.id));
  }

  res.json(DecideApprovalResponse.parse(jsonSafe({ ...updated, moduleName: module?.name ?? null })));
});

export default router;
