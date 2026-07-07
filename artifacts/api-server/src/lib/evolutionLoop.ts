// Evolution Loop: one full self-evolution iteration, callable from the API
// route and from the Evolution Scheduler. Never installs anything by itself;
// installation stays behind the existing governance pipeline.

import { eq, sql } from "drizzle-orm";
import {
  db,
  evolutionRunsTable,
  evolutionPlansTable,
  proposalsTable,
  tasksTable,
  modulesTable,
  type EvolutionRunRow,
} from "@workspace/db";
import { runIntrospection, refreshCapabilities, scanSelf } from "./selfAwareness";
import { analyzeGaps } from "./gapAnalysis";
import { createEvolutionPlan } from "./evolutionPlanner";
import { generateProposal } from "./proposalGenerator";
import { executeRealTestRun } from "./realTestRunner";
import { runGuardian } from "./guardian";
import { governInstall } from "./governor";
import { storeLessons } from "./selfLearning";
import { getProviders } from "./aiGateway";
import { audit } from "./audit";
import { logger } from "./logger";

export class RunInProgressError extends Error {
  constructor(public readonly runId: number) {
    super(`Evolution run #${runId} is still running; only one run may execute at a time.`);
  }
}

// Advisory lock key that serializes the check-and-insert of the single-run
// guard across concurrent requests (API + scheduler).
const EVOLUTION_RUN_LOCK_KEY = 0x466f7267; // "Forg"

export async function executeEvolutionRun(trigger: "api" | "scheduler" = "api"): Promise<EvolutionRunRow> {
  // Single-run guard: only one evolution run may execute at a time. The
  // check + insert happen inside one transaction holding an advisory lock,
  // so two concurrent callers can never both create a running row.
  const run = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${EVOLUTION_RUN_LOCK_KEY})`);
    const running = await tx
      .select({ id: evolutionRunsTable.id })
      .from(evolutionRunsTable)
      .where(eq(evolutionRunsTable.status, "running"));
    if (running.length > 0) throw new RunInProgressError(running[0].id);
    const [created] = await tx.insert(evolutionRunsTable).values({ status: "running", phase: "introspect" }).returning();
    return created;
  });
  logger.info({ runId: run.id, trigger }, "Evolution run started");
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

  const finish = async (): Promise<EvolutionRunRow> => {
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
      details: `trigger=${trigger} status=${status} phase=${phase} plan=${state.planId ?? "-"} proposal=${state.proposalId ?? "-"} test=${state.testStatus ?? "-"} guardian=${state.guardianVerdict ?? "-"} governor=${state.governorDecision ?? "-"}`,
      outcome: status === "completed" ? "allowed" : "blocked",
    });

    return finished;
  };

  try {
    // 1. Observe & understand: introspect self, rebuild graph, refresh capabilities.
    const snapshot = await runIntrospection();
    state.snapshotId = snapshot.id;
    report.push(
      `OBSERVE — snapshot #${snapshot.id}: ${snapshot.sourceFiles} files, ${snapshot.endpoints} endpoints, ${snapshot.dbTables} tables, ${snapshot.docs} docs.`,
    );

    // 2. Evaluate & prioritize: gap analysis. When all capabilities are
    // working, fall back to backlog-driven evolution.
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
        return await finish();
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
      return await finish();
    }
    let proposal;
    try {
      proposal = await generateProposal({ sourceType: "task", sourceId: workTaskId!, instructions: workInstructions });
    } catch (err) {
      status = "blocked";
      state.errorMessage = err instanceof Error ? err.message : String(err);
      report.push(`GENERATE — failed: ${state.errorMessage}`);
      phase = "generate-failed";
      return await finish();
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
    return await finish();
  } catch (err) {
    status = "failed";
    state.errorMessage = err instanceof Error ? err.message : String(err);
    report.push(`ERROR — ${state.errorMessage}`);
    logger.error({ runId: run.id, err: state.errorMessage }, "Evolution run failed");
    return await finish();
  }
}
