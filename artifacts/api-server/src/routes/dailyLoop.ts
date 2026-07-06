import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc } from "drizzle-orm";
import {
  db,
  dailyLoopRunsTable,
  tasksTable,
  improvementsTable,
  approvalsTable,
  modulesTable,
  memoryItemsTable,
  testRunsTable,
} from "@workspace/db";
import { ListDailyLoopRunsResponse, StartDailyLoopResponse } from "@workspace/api-zod";
import { audit } from "../lib/audit";

const router: IRouter = Router();

router.get("/daily-loop/runs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(dailyLoopRunsTable).orderBy(desc(dailyLoopRunsTable.startedAt));
  res.json(ListDailyLoopRunsResponse.parse(jsonSafe(rows)));
});

router.post("/daily-loop/run", async (req, res): Promise<void> => {
  const [run] = await db.insert(dailyLoopRunsTable).values({ status: "running" }).returning();
  req.log.info({ runId: run.id }, "Daily autonomous loop started");

  const reportLines: string[] = [];
  let tasksCreated = 0;

  // 1. Analyze current state
  const [allTasks, openImprovements, pendingApprovals, modules, failedTests] = await Promise.all([
    db.select().from(tasksTable),
    db.select().from(improvementsTable).where(eq(improvementsTable.status, "open")).orderBy(desc(improvementsTable.createdAt)),
    db.select().from(approvalsTable).where(eq(approvalsTable.status, "pending")),
    db.select().from(modulesTable),
    db.select().from(testRunsTable).where(eq(testRunsTable.status, "failed")),
  ]);

  const blocked = allTasks.filter((t) => t.status === "blocked");
  const active = allTasks.filter((t) => t.status === "active" || t.status === "planned");
  reportLines.push(`ANALYSIS — tasks: ${allTasks.length} total, ${active.length} active/planned, ${blocked.length} blocked.`);
  reportLines.push(`Modules: ${modules.length} registered, ${modules.filter((m) => m.active).length} active, ${modules.filter((m) => m.installStatus === "installed").length} installed.`);
  reportLines.push(`Failed test runs on record: ${failedTests.length}. Pending approvals: ${pendingApprovals.length}.`);

  // 2. Convert the highest-priority open improvement into a task
  const priorityOrder = ["critical", "high", "medium", "low"];
  const sorted = [...openImprovements].sort(
    (a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority),
  );
  const top = sorted[0];
  if (top) {
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: top.proposedModule ? `Build module: ${top.proposedModule}` : `Improve: ${top.problem.slice(0, 100)}`,
        goal: top.expectedImprovement ?? top.problem,
        risk: top.risk,
        ownerAgent: "planner",
        status: "planned",
        acceptanceCriteria: top.requiredTests ?? "All mandatory test types pass.",
        source: `daily-loop:${run.id}`,
      })
      .returning();
    await db.update(improvementsTable).set({ status: "converted" }).where(eq(improvementsTable.id, top.id));
    tasksCreated += 1;
    reportLines.push(`PLANNED — converted improvement #${top.id} into task #${task.id}: ${task.title}`);
  } else {
    reportLines.push("PLANNED — no open improvements to convert today.");
  }

  // 3. Surface blockades
  if (blocked.length > 0) {
    reportLines.push(
      `BLOCKADES — ${blocked.length} blocked task(s): ${blocked
        .slice(0, 5)
        .map((t) => `#${t.id} ${t.title}${t.blockedReason ? ` (${t.blockedReason})` : ""}`)
        .join("; ")}`,
    );
  } else {
    reportLines.push("BLOCKADES — none.");
  }

  // 4. Approvals waiting for the owner
  if (pendingApprovals.length > 0) {
    reportLines.push(`OWNER ACTION REQUIRED — ${pendingApprovals.length} approval(s) waiting in the queue.`);
  } else {
    reportLines.push("OWNER ACTION REQUIRED — nothing waiting.");
  }

  // 5. Store a lesson in memory
  if (failedTests.length > 0) {
    await db.insert(memoryItemsTable).values({
      category: "test_result",
      title: `Daily loop #${run.id}: ${failedTests.length} failed test run(s) on record`,
      content: "Failed test runs block installation. Review the failing modules and fix findings before requesting install again.",
      tags: ["daily-loop", "tests"],
    });
    reportLines.push("MEMORY — stored a lesson about failing test runs.");
  }

  const report = reportLines.join("\n");
  const [finished] = await db
    .update(dailyLoopRunsTable)
    .set({
      status: "completed",
      report,
      tasksCreated,
      approvalsRequested: pendingApprovals.length,
      finishedAt: new Date(),
    })
    .where(eq(dailyLoopRunsTable.id, run.id))
    .returning();

  await audit({
    actor: "daily-loop",
    action: "daily_loop_completed",
    targetType: "daily-loop-run",
    targetId: run.id,
    details: `Tasks created: ${tasksCreated}; approvals pending: ${pendingApprovals.length}`,
  });

  res.status(201).json(StartDailyLoopResponse.parse(jsonSafe(finished)));
});

export default router;
