import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  introspectionSnapshotsTable,
  knowledgeNodesTable,
  knowledgeEdgesTable,
  capabilitiesTable,
  evolutionPlansTable,
  evolutionRunsTable,
  approvalsTable,
  proposalsTable,
  testRunsTable,
  modulesTable,
  guardianReviewsTable,
  tasksTable,
} from "@workspace/db";
import {
  RunIntrospectionResponse,
  GetSelfModelResponse,
  GetKnowledgeGraphResponse,
  ListCapabilitiesResponse,
  GetGapAnalysisResponse,
  CreateEvolutionPlanResponse,
  ListEvolutionPlansResponse,
  StartEvolutionRunResponse,
  ListEvolutionRunsResponse,
  GetEvolutionStatusResponse,
  CreateEvolutionPlanBody,
} from "@workspace/api-zod";
import { jsonSafe } from "../lib/jsonSafe";
import { runIntrospection, refreshCapabilities, scanSelf } from "../lib/selfAwareness";
import { analyzeGaps } from "../lib/gapAnalysis";
import { createEvolutionPlan, NoGapError } from "../lib/evolutionPlanner";
import { generateProposal } from "../lib/proposalGenerator";
import { executeRealTestRun } from "../lib/realTestRunner";
import { runGuardian } from "../lib/guardian";
import { governInstall } from "../lib/governor";
import { storeLessons } from "../lib/selfLearning";
import { getProviders } from "../lib/aiGateway";
import { audit } from "../lib/audit";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/evolution/introspect", async (_req, res): Promise<void> => {
  const snapshot = await runIntrospection();
  res.status(201).json(RunIntrospectionResponse.parse(jsonSafe(snapshot)));
});

router.get("/evolution/self", async (_req, res): Promise<void> => {
  const [snapshot] = await db
    .select()
    .from(introspectionSnapshotsTable)
    .orderBy(desc(introspectionSnapshotsTable.createdAt))
    .limit(1);
  if (!snapshot) {
    res.status(404).json({ error: "No introspection has run yet. POST /evolution/introspect first." });
    return;
  }
  res.json(GetSelfModelResponse.parse(jsonSafe(snapshot)));
});

router.get("/evolution/graph", async (_req, res): Promise<void> => {
  const [snapshot] = await db
    .select()
    .from(introspectionSnapshotsTable)
    .orderBy(desc(introspectionSnapshotsTable.createdAt))
    .limit(1);
  if (!snapshot) {
    res.status(404).json({ error: "No introspection has run yet. POST /evolution/introspect first." });
    return;
  }
  const [nodes, edges] = await Promise.all([
    db.select().from(knowledgeNodesTable).where(eq(knowledgeNodesTable.snapshotId, snapshot.id)),
    db.select().from(knowledgeEdgesTable).where(eq(knowledgeEdgesTable.snapshotId, snapshot.id)),
  ]);
  res.json(
    GetKnowledgeGraphResponse.parse(
      jsonSafe({
        snapshotId: snapshot.id,
        nodes: nodes.map((n) => ({ nodeType: n.nodeType, key: n.key, label: n.label, meta: n.meta })),
        edges: edges.map((e) => ({ fromKey: e.fromKey, toKey: e.toKey, relation: e.relation })),
      }),
    ),
  );
});

router.get("/evolution/capabilities", async (_req, res): Promise<void> => {
  const rows = await db.select().from(capabilitiesTable).orderBy(capabilitiesTable.id);
  res.json(ListCapabilitiesResponse.parse(jsonSafe(rows)));
});

router.get("/evolution/gaps", async (_req, res): Promise<void> => {
  const analysis = await analyzeGaps();
  res.json(GetGapAnalysisResponse.parse(jsonSafe(analysis)));
});

router.post("/evolution/plan", async (req, res): Promise<void> => {
  const body = CreateEvolutionPlanBody.parse(req.body ?? {});
  try {
    const plan = await createEvolutionPlan({ capabilityKey: body.capabilityKey });
    res.status(201).json(CreateEvolutionPlanResponse.parse(jsonSafe(plan)));
  } catch (err) {
    if (err instanceof NoGapError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/evolution/plans", async (_req, res): Promise<void> => {
  const rows = await db.select().from(evolutionPlansTable).orderBy(desc(evolutionPlansTable.createdAt));
  res.json(ListEvolutionPlansResponse.parse(jsonSafe(rows)));
});

router.get("/evolution/runs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(evolutionRunsTable).orderBy(desc(evolutionRunsTable.startedAt));
  res.json(ListEvolutionRunsResponse.parse(jsonSafe(rows)));
});

router.get("/evolution/status", async (_req, res): Promise<void> => {
  const [caps, [latestSnapshot], [latestRun], pending] = await Promise.all([
    db.select().from(capabilitiesTable),
    db.select().from(introspectionSnapshotsTable).orderBy(desc(introspectionSnapshotsTable.createdAt)).limit(1),
    db.select().from(evolutionRunsTable).orderBy(desc(evolutionRunsTable.startedAt)).limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvalsTable)
      .where(eq(approvalsTable.status, "pending")),
  ]);
  const gaps = caps.filter((c) => c.status !== "working").length;
  res.json(
    GetEvolutionStatusResponse.parse(
      jsonSafe({
        capabilities: {
          total: caps.length,
          working: caps.filter((c) => c.status === "working").length,
          partial: caps.filter((c) => c.status === "partial").length,
          missing: caps.filter((c) => c.status === "missing").length,
        },
        gaps,
        latestSnapshotId: latestSnapshot?.id ?? null,
        latestRun: latestRun ?? null,
        pendingApprovals: pending[0]?.n ?? 0,
        aiConfigured: getProviders().some((p) => p.configured),
      }),
    ),
  );
});

router.post("/evolution/run", async (req, res): Promise<void> => {
  // Single-run guard: only one evolution run may execute at a time, otherwise
  // concurrent runs could pick up the same backlog task or gap.
  const running = await db.select({ id: evolutionRunsTable.id }).from(evolutionRunsTable).where(eq(evolutionRunsTable.status, "running"));
  if (running.length > 0) {
    res.status(409).json({ error: `Evolution run #${running[0].id} is still running; only one run may execute at a time.` });
    return;
  }
  const [run] = await db.insert(evolutionRunsTable).values({ status: "running", phase: "introspect" }).returning();
  req.log.info({ runId: run.id }, "Evolution run started");
  const report: string[] = [];
  const state: {
    snapshotId?: number;
    planId?: number;
    capabilityKey?: string;
    planSource?: string;
    taskId?: number;
    proposalId?: number;
    testRunId?: number;
    testStatus?: string;
    guardianVerdict?: string;
    governorDecision?: string;
    blockedFiles: string[];
    errorMessage?: string;
  } = { blockedFiles: [] };
  let status: "completed" | "blocked" | "failed" = "completed";
  let phase = "introspect";

  const finish = async (): Promise<void> => {
    const lessons = await storeLessons({
      runId: run.id,
      capabilityKey: state.capabilityKey,
      planCreated: state.planId != null,
      planSource: state.planSource,
      proposalGenerated: state.proposalId != null && state.testRunId != null,
      blockedFiles: state.blockedFiles,
      testStatus: state.testStatus,
      guardianVerdict: state.guardianVerdict,
      governorDecision: state.governorDecision,
      errorMessage: state.errorMessage,
    });
    report.push(`LEARN — ${lessons.length} lesson(s) stored in memory.`);

    // Refresh the capability map so NEXT reflects evidence produced during
    // this iteration (plans, proposals, tests, reviews, lessons).
    await refreshCapabilities(scanSelf());
    const analysis = await analyzeGaps();
    const next = analysis.gaps[0];
    const nextStep = next
      ? `Next gap: '${next.name}' (${next.capabilityKey}), impact ${next.impactScore}. ${next.reason}`
      : "All capabilities working: monitor, refine maturity and take on backlog improvements.";
    report.push(`NEXT — ${nextStep}`);

    const [finished] = await db
      .update(evolutionRunsTable)
      .set({
        status,
        phase,
        snapshotId: state.snapshotId,
        planId: state.planId,
        taskId: state.taskId,
        proposalId: state.proposalId,
        testRunId: state.testRunId,
        guardianVerdict: state.guardianVerdict,
        governorDecision: state.governorDecision,
        lessons,
        nextStep,
        report: report.join("\n"),
        finishedAt: new Date(),
      })
      .where(eq(evolutionRunsTable.id, run.id))
      .returning();

    await audit({
      actor: "evolution-loop",
      action: "evolution_run_finished",
      targetType: "evolution-run",
      targetId: run.id,
      details: `status=${status} phase=${phase} plan=${state.planId ?? "-"} proposal=${state.proposalId ?? "-"} test=${state.testStatus ?? "-"} guardian=${state.guardianVerdict ?? "-"} governor=${state.governorDecision ?? "-"}`,
      outcome: status === "completed" ? "allowed" : "blocked",
    });

    res.status(201).json(StartEvolutionRunResponse.parse(jsonSafe(finished)));
  };

  try {
    // 1. Observe & understand: introspect self, rebuild graph, refresh capabilities.
    const snapshot = await runIntrospection();
    state.snapshotId = snapshot.id;
    report.push(
      `OBSERVE — snapshot #${snapshot.id}: ${snapshot.sourceFiles} files, ${snapshot.endpoints} endpoints, ${snapshot.dbTables} tables, ${snapshot.docs} docs.`,
    );

    // 2. Evaluate & prioritize: gap analysis. When all capabilities are
    // working, fall back to backlog-driven evolution: pick up a planned
    // evolution task that has no proposal yet, so the loop keeps producing
    // value after bootstrap (recursive evolution).
    phase = "gap-analysis";
    const analysis = await analyzeGaps();
    let workTaskId: number | undefined;
    let workInstructions = "";

    if (analysis.gaps.length > 0) {
      const gap = analysis.gaps[0];
      state.capabilityKey = gap.capabilityKey;
      report.push(`EVALUATE — top gap: '${gap.name}' (impact ${gap.impactScore}): ${gap.reason}`);

      // 3. Design/plan.
      phase = "plan";
      const plan = await createEvolutionPlan({ capabilityKey: gap.capabilityKey });
      state.planId = plan.id;
      state.planSource = plan.source;
      state.taskId = plan.taskId ?? undefined;
      workTaskId = plan.taskId ?? undefined;
      workInstructions = `Follow this approved plan. Design: ${plan.design}\nSteps: ${plan.steps.join("; ")}\nTest strategy: ${plan.testStrategy}`;
      report.push(`PLAN — plan #${plan.id} (source: ${plan.source}, risk: ${plan.risk}); task #${plan.taskId}.`);
    } else {
      const proposedTaskIds = (await db.select({ id: proposalsTable.sourceId, t: proposalsTable.sourceType }).from(proposalsTable))
        .filter((p) => p.t === "task")
        .map((p) => p.id);
      const backlog = (
        await db.select().from(tasksTable).where(eq(tasksTable.status, "planned")).orderBy(tasksTable.createdAt)
      ).filter((t) => !proposedTaskIds.includes(t.id));
      const workTask = backlog[0];
      if (!workTask) {
        report.push("EVALUATE — no open gaps and no unproposed planned tasks; nothing to build this iteration.");
        status = "completed";
        phase = "done";
        await finish();
        return;
      }
      state.capabilityKey = workTask.source?.startsWith("evolution-gap:")
        ? workTask.source.slice("evolution-gap:".length)
        : undefined;
      state.taskId = workTask.id;
      workTaskId = workTask.id;
      workInstructions = `Backlog-driven evolution. Goal: ${workTask.goal}\nAcceptance criteria: ${workTask.acceptanceCriteria ?? "all mandatory tests pass"}`;
      report.push(`EVALUATE — no capability gaps; picked planned backlog task #${workTask.id}: ${workTask.title}`);
      const [existingPlan] = await db
        .select()
        .from(evolutionPlansTable)
        .where(eq(evolutionPlansTable.taskId, workTask.id));
      if (existingPlan) {
        state.planId = existingPlan.id;
        state.planSource = existingPlan.source;
        report.push(`PLAN — reusing existing plan #${existingPlan.id} (source: ${existingPlan.source}).`);
      }
    }

    // 4. Generate: proposal into a fresh sandbox (requires AI).
    phase = "generate";
    if (!getProviders().some((p) => p.configured)) {
      status = "blocked";
      state.errorMessage = "No AI provider configured: proposal generation requires an AI key. Plan and task are ready; rerun once a key is set.";
      report.push(`GENERATE — blocked: ${state.errorMessage}`);
      phase = "blocked-no-ai";
      await finish();
      return;
    }
    let proposal;
    try {
      proposal = await generateProposal({ sourceType: "task", sourceId: workTaskId!, instructions: workInstructions });
    } catch (err) {
      status = "blocked";
      state.errorMessage = err instanceof Error ? err.message : String(err);
      report.push(`GENERATE — failed: ${state.errorMessage}`);
      phase = "generate-failed";
      await finish();
      return;
    }
    state.proposalId = proposal.id;
    state.blockedFiles = proposal.blockedFiles;
    report.push(
      `GENERATE — proposal #${proposal.id}: module #${proposal.moduleId}, sandbox #${proposal.sandboxId}, ${proposal.filesGenerated.length} file(s)${proposal.blockedFiles.length > 0 ? `, ${proposal.blockedFiles.length} blocked` : ""}.`,
    );

    // 5. Test: real execution in the sandbox.
    phase = "test";
    const testRun = await executeRealTestRun({ sandboxId: proposal.sandboxId!, types: ["lint", "typecheck", "unit"] });
    state.testRunId = testRun.id;
    state.testStatus = testRun.status;
    report.push(`TEST — run #${testRun.id}: ${testRun.status} (${testRun.passed} passed, ${testRun.failed} failed).`);

    // 6. Review: Guardian.
    phase = "review";
    const [moduleRow] = await db.select().from(modulesTable).where(eq(modulesTable.id, proposal.moduleId!));
    const review = await runGuardian(moduleRow);
    state.guardianVerdict = review.outcome;
    report.push(`REVIEW — Guardian: ${review.outcome} (${review.findings.length} finding(s)).`);

    // 7. Govern: Governor decision (may auto-install only when low-risk all-green,
    // otherwise creates an approval for the owner — existing pipeline).
    phase = "govern";
    const decision = await governInstall(moduleRow);
    state.governorDecision = decision.decision;
    report.push(`GOVERN — Governor: ${decision.decision}. ${decision.rationale}`);
    if (decision.decision !== "install_allowed") {
      report.push("OWNER — approval/intervention required before installation (governance pipeline).");
    }

    phase = "done";
    if (state.testStatus !== "passed") status = "blocked";
    await finish();
  } catch (err) {
    status = "failed";
    state.errorMessage = err instanceof Error ? err.message : String(err);
    report.push(`ERROR — ${state.errorMessage}`);
    req.log.error({ runId: run.id, err: state.errorMessage }, "Evolution run failed");
    await finish();
  }
});

export default router;
