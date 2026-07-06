import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc, count } from "drizzle-orm";
import {
  db,
  projectsTable,
  tasksTable,
  sandboxesTable,
  modulesTable,
  approvalsTable,
  testRunsTable,
  improvementsTable,
  memoryItemsTable,
  auditLogsTable,
  coreComponentsTable,
  dailyLoopRunsTable,
} from "@workspace/db";
import { GetDashboardSummaryResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [
    [projects],
    [activeTasks],
    [blockedTasks],
    [sandboxes],
    [modules],
    [activeModules],
    [pendingApprovals],
    [failedTests],
    [improvements],
    [memoryItems],
    [lockedCore],
    recentAuditLogs,
    [lastLoop],
  ] = await Promise.all([
    db.select({ n: count() }).from(projectsTable),
    db.select({ n: count() }).from(tasksTable).where(eq(tasksTable.status, "active")),
    db.select({ n: count() }).from(tasksTable).where(eq(tasksTable.status, "blocked")),
    db.select({ n: count() }).from(sandboxesTable),
    db.select({ n: count() }).from(modulesTable),
    db.select({ n: count() }).from(modulesTable).where(eq(modulesTable.active, true)),
    db.select({ n: count() }).from(approvalsTable).where(eq(approvalsTable.status, "pending")),
    db.select({ n: count() }).from(testRunsTable).where(eq(testRunsTable.status, "failed")),
    db.select({ n: count() }).from(improvementsTable).where(eq(improvementsTable.status, "open")),
    db.select({ n: count() }).from(memoryItemsTable),
    db.select({ n: count() }).from(coreComponentsTable).where(eq(coreComponentsTable.locked, true)),
    db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(10),
    db.select().from(dailyLoopRunsTable).orderBy(desc(dailyLoopRunsTable.startedAt)).limit(1),
  ]);

  res.json(
    GetDashboardSummaryResponse.parse({
      projects: projects.n,
      activeTasks: activeTasks.n,
      blockedTasks: blockedTasks.n,
      sandboxes: sandboxes.n,
      modules: modules.n,
      activeModules: activeModules.n,
      pendingApprovals: pendingApprovals.n,
      failedTests: failedTests.n,
      improvements: improvements.n,
      memoryItems: memoryItems.n,
      lockedCoreCount: lockedCore.n,
      lastDailyReport: lastLoop?.report ?? null,
      recentAuditLogs: jsonSafe(recentAuditLogs),
    }),
  );
});

export default router;
