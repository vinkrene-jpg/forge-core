import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime } from "./runtime";
import type { WorkspaceChangeExecutor } from "./workspace-bridge";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for capability goal run");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("one run approval executes ranked capability goals and resolves accepted gaps", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-capability-goal-run-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;
  const runtimeStorage = path.join(storage, "forge-runtime");
  await mkdir(runtimeStorage, { recursive: true });
  const failedMission = {
    id: "goal-run-historical-failure",
    kind: "operator.autonomous-cycle",
    title: "Historical provider and evaluation failure",
    status: "failed",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T01:00:00.000Z",
    startedAt: "2026-08-15T00:30:00.000Z",
    completedAt: "2026-08-15T01:00:00.000Z",
    attempts: 1,
    interruptedCount: 0,
    input: {},
    output: {
      missionResult: {
        status: "rejected",
        cause: "evaluation",
        message: "Evaluation rejected",
        producedAt: "2026-08-15T01:00:00.000Z",
      },
      evaluation: {
        decision: "rejected",
        checks: [{ id: "verification-explicit", passed: false }],
      },
    },
    lastError: "Evaluation rejected",
  };
  await writeFile(
    path.join(runtimeStorage, "missions.json"),
    JSON.stringify({ version: 1, missions: [failedMission] }),
  );

  const createdFiles: string[] = [];
  const executor: WorkspaceChangeExecutor = {
    async execute(rootPath, missionId, request) {
      const startedAt = new Date().toISOString();
      const changedFiles = [];
      for (const change of request.changes) {
        const absolutePath = path.join(rootPath, change.path);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, change.content, "utf8");
        createdFiles.push(absolutePath);
        changedFiles.push({
          path: change.path,
          beforeSha256: change.expectedSha256,
          afterSha256: sha256(change.content),
        });
      }
      return {
        id: randomUUID(),
        missionId,
        status: "verified",
        branch: "forge-sync-primary",
        changedFiles,
        verification: request.verification.map((step) => ({
          command: `pnpm run ${step}`,
          exitCode: 0,
          stdoutChars: 2,
          stderrChars: 0,
          stdoutSha256: sha256("ok"),
          stderrSha256: sha256(""),
          durationMs: 1,
        })),
        rollbackPerformed: false,
        commitSha: null,
        error: null,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    },
  };

  try {
    const plannedCandidateIds: string[] = [];
    const runtime = new ForgeRuntime({
      missionLoopPollIntervalMs: 100,
      workspaceChangeExecutor: executor,
      async goalRunPlanner(candidate) {
        plannedCandidateIds.push(candidate.id);
        const target = `artifacts/goal-run-test-${candidate.id}.json`;
        return {
          repositoryId: "forge-core",
          components: [{
            id: `close-${candidate.id}`,
            title: `Close ${candidate.capabilityName}`,
            dependsOn: [],
            targets: [target],
            acceptanceCriteria: candidate.proposedGoalSpec.acceptanceCriteria,
            requiredCapabilities: ["tool.workspace.write", "tool.workspace.verify"],
            workspaceChange: {
              changes: [{
                path: target,
                expectedSha256: null,
                content: JSON.stringify({ candidateId: candidate.id, resolved: true }) + "\n",
              }],
              verification: ["typecheck", "test", "build"],
              commit: null,
            },
          }],
        };
      },
    });
    await runtime.start();
    const initialCandidates = runtime.listCapabilityGapCandidates();
    assert.equal(initialCandidates.length, 2);

    const created = await runtime.createCapabilityGoalRun({
      allowedDirectories: ["lib/", "artifacts/"],
      maximumGoals: 2,
      maximumDurationMs: 60_000,
      maximumCostUsd: 0,
    });
    assert.equal(created.mission.status, "awaiting_approval");
    assert.ok(created.approval);
    await runtime.approveApproval(created.approval.id, "goal-run-test-operator");

    await waitFor(() => {
      const report = runtime.getMission(created.mission.id)?.output?.goals;
      if (!Array.isArray(report)) return false;
      return report.every((goal) => {
        const goalMissionId = (goal as { goalMissionId?: string }).goalMissionId;
        const goalMission = goalMissionId ? runtime.getMission(goalMissionId) : null;
        const graph = goalMission?.output?.graph as { nodes?: { missionId: string }[] } | undefined;
        return graph?.nodes?.every((node) => runtime.getMission(node.missionId)?.status === "succeeded") === true;
      });
    });

    assert.deepEqual(plannedCandidateIds, initialCandidates.map((candidate) => candidate.id));
    const report = runtime.getCapabilityGoalRunReport(created.mission.id) as {
      goals: readonly { status: string; gapResolved: boolean }[];
      resolvedGapIds: readonly string[];
    };
    assert.equal(report.goals.length, 2);
    assert.ok(report.goals.every((goal) => goal.status === "accepted" && goal.gapResolved));
    assert.equal(report.resolvedGapIds.length, 2);
    assert.equal(runtime.listCapabilityGapCandidates().length, 0);
    assert.equal(
      runtime.listApprovals().filter((approval) => approval.missionId !== created.mission.id).length,
      0,
    );
    await runtime.stop();
  } finally {
    for (const file of createdFiles) await rm(file, { force: true });
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await rm(storage, { recursive: true, force: true });
  }
});