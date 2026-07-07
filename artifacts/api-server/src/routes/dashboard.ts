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
    allTestRuns,
    allModules,
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
    db.select({ id: testRunsTable.id, moduleId: testRunsTable.moduleId, sandboxId: testRunsTable.sandboxId, status: testRunsTable.status }).from(testRunsTable).orderBy(desc(testRunsTable.id)),
    db.select({ id: modulesTable.id, name: modulesTable.name }).from(modulesTable),
    db.select({ n: count() }).from(improvementsTable).where(eq(improvementsTable.status, "open")),
    db.select({ n: count() }).from(memoryItemsTable),
    db.select({ n: count() }).from(coreComponentsTable).where(eq(coreComponentsTable.locked, true)),
    db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(10),
    db.select().from(dailyLoopRunsTable).orderBy(desc(dailyLoopRunsTable.startedAt)).limit(1),
  ]);

  // Current test health, not history: a failure only counts while it is the
  // LATEST test run for its module (or sandbox, for module-less runs).
  // Module names are the version lineage in this system (re-proposals reuse
  // the name), so a failing module is considered superseded ONLY if a newer
  // module with the same name exists whose own latest test run passed —
  // a newer same-name module that is untested or failing never hides a failure.
  const latestByTarget = new Map<string, { moduleId: number | null; status: string }>();
  for (const t of allTestRuns) {
    // Runs without module or sandbox are counted individually (keyed by run id)
    // so malformed rows can never collapse into one bucket.
    const key = t.moduleId != null ? `m:${t.moduleId}` : t.sandboxId != null ? `s:${t.sandboxId}` : `r:${t.id}`;
    if (!latestByTarget.has(key)) latestByTarget.set(key, { moduleId: t.moduleId, status: t.status });
  }
  const moduleName = new Map(allModules.map((m) => [m.id, m.name]));
  const failedTestsCurrent = [...latestByTarget.values()].filter((t) => {
    if (t.status !== "failed") return false;
    if (t.moduleId == null) return true;
    const name = moduleName.get(t.moduleId);
    const supersededByGreen = allModules.some(
      (m) => m.name === name && m.id > t.moduleId! && latestByTarget.get(`m:${m.id}`)?.status === "passed",
    );
    return !supersededByGreen;
  }).length;

  res.json(
    GetDashboardSummaryResponse.parse({
      projects: projects.n,
      activeTasks: activeTasks.n,
      blockedTasks: blockedTasks.n,
      sandboxes: sandboxes.n,
      modules: modules.n,
      activeModules: activeModules.n,
      pendingApprovals: pendingApprovals.n,
      failedTests: failedTestsCurrent,
      improvements: improvements.n,
      memoryItems: memoryItems.n,
      lockedCoreCount: lockedCore.n,
      lastDailyReport: lastLoop?.report ?? null,
      recentAuditLogs: jsonSafe(recentAuditLogs),
    }),
  );
});

export default router;
