import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime } from "./runtime";
import type { WorkspaceChangeExecutor } from "./workspace-bridge";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for capability repair chain");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("builds a missing capability and resumes the original goal under one run mandate", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-capability-repair-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;
  await mkdir(path.join(storage, "forge-runtime"), { recursive: true });
  await writeFile(path.join(storage, "forge-runtime", "missions.json"), JSON.stringify({
    version: 1,
    missions: [{
      id: "repair-chain-source-failure",
      kind: "operator.autonomous-cycle",
      title: "Original task needs a missing renderer",
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
          message: "Original task could not render its proof",
          producedAt: "2026-08-15T01:00:00.000Z",
        },
        evaluation: {
          decision: "rejected",
          checks: [{ id: "renderer-available", passed: false }],
        },
      },
      lastError: "Original task could not render its proof",
    }],
  }));

  const executedTargets: string[] = [];
  const createdFiles: string[] = [];
  const executor: WorkspaceChangeExecutor = {
    async execute(rootPath, missionId, request) {
      const startedAt = new Date().toISOString();
      const changedFiles = [];
      for (const change of request.changes) {
        const absolutePath = path.join(rootPath, change.path);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, change.content, "utf8");
        executedTargets.push(change.path);
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

  const runtime = new ForgeRuntime({
    missionLoopPollIntervalMs: 100,
    workspaceChangeExecutor: executor,
    async goalRunPlanner(candidate) {
      const repairsRenderer = candidate.capabilityId === "tool.proof.render";
      const target = repairsRenderer
        ? "artifacts/capability-repair-renderer.ts"
        : "artifacts/capability-repair-original.json";
      return {
        repositoryId: "forge-core",
        components: [{
          id: repairsRenderer ? "build-renderer" : "finish-original",
          title: repairsRenderer ? "Build proof renderer" : "Finish original task",
          dependsOn: [],
          targets: [target],
          acceptanceCriteria: candidate.proposedGoalSpec.acceptanceCriteria,
          requiredCapabilities: repairsRenderer
            ? ["tool.workspace.write", "tool.workspace.verify"]
            : ["tool.proof.render", "tool.workspace.write", "tool.workspace.verify"],
          workspaceChange: {
            changes: [{
              path: target,
              expectedSha256: null,
              content: repairsRenderer ? "export const renderProof = true;\n" : "{\"completed\":true}\n",
            }],
            verification: ["typecheck", "test", "build"],
            commit: null,
          },
        }],
      };
    },
  });

  try {
    await runtime.start();
    await runtime.upsertCapability({
      id: "tool.proof.render",
      name: "Proof Renderer",
      description: "Renders deterministic proof artifacts.",
      status: "unavailable",
      version: "0.0.0",
      confidence: 0,
      source: "repair-chain-live-proof",
    });
    const created = await runtime.createCapabilityGoalRun({
      allowedDirectories: ["artifacts/"],
      maximumGoals: 1,
      maximumCapabilityImprovements: 2,
      maximumImprovementDepth: 2,
      maximumDurationMs: 60_000,
      maximumCostUsd: 0,
      maximumDailyCostUsd: 0,
    });
    assert.ok(created.approval);
    await runtime.approveApproval(created.approval.id, "repair-chain-operator");

    try {
      await waitFor(() => {
        if (!executedTargets.includes("artifacts/capability-repair-original.json")) return false;
        const report = runtime.getMission(created.mission.id)?.output?.goals;
        if (!Array.isArray(report)) return false;
        const goalMissionId = (report[0] as { goalMissionId?: string } | undefined)?.goalMissionId;
        const goalMission = goalMissionId ? runtime.getMission(goalMissionId) : null;
        const graph = goalMission?.output?.graph as { nodes?: { missionId: string }[] } | undefined;
        const accepted = graph?.nodes?.every((node) => {
          const child = runtime.getMission(node.missionId);
          return child?.status === "succeeded" &&
            (child.output?.evaluation as { decision?: string } | undefined)?.decision === "accepted";
        }) === true;
        return accepted && runtime.getCapability("tool.proof.render")?.status === "operational";
      });
    } catch (error) {
      assert.fail(`${String(error)}\n${JSON.stringify(runtime.listMissions().map((mission) => ({
        id: mission.id,
        kind: mission.kind,
        status: mission.status,
        error: mission.lastError,
        repairsCapabilityId: mission.input.repairsCapabilityId,
        predecessor: mission.input.capabilityRepairPredecessorMissionId,
      })), null, 2)}`);
    }

    assert.deepEqual(executedTargets, [
      "artifacts/capability-repair-renderer.ts",
      "artifacts/capability-repair-original.json",
    ]);
    assert.equal(runtime.getCapability("tool.proof.render")?.status, "operational");
    assert.match(runtime.getCapability("tool.proof.render")?.source ?? "", /^goal-run-repair:/);
    const report = runtime.getCapabilityGoalRunReport(created.mission.id) as {
      goals: readonly {
        status: string;
        repairChain: readonly {
          missionId: string;
          capabilityId: string;
          status: string;
          depth: number;
          commitShas: readonly string[];
          failureReason: string | null;
        }[];
      }[];
    };
    assert.equal(report.goals[0]?.status, "accepted");
    assert.equal(report.goals[0]?.repairChain.length, 1);
    assert.match(report.goals[0]?.repairChain[0]?.missionId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(report.goals[0]?.repairChain[0]?.capabilityId, "tool.proof.render");
    assert.equal(report.goals[0]?.repairChain[0]?.status, "accepted");
    assert.equal(report.goals[0]?.repairChain[0]?.depth, 1);
    assert.deepEqual(report.goals[0]?.repairChain[0]?.commitShas, []);
    assert.equal(report.goals[0]?.repairChain[0]?.failureReason, null);
  } finally {
    await runtime.stop().catch(() => undefined);
    for (const file of createdFiles) await rm(file, { force: true });
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await rm(storage, { recursive: true, force: true });
  }
});

test("failed capability repair stops the original goal with a complete chain report", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-capability-repair-failure-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;
  await mkdir(path.join(storage, "forge-runtime"), { recursive: true });
  await writeFile(path.join(storage, "forge-runtime", "missions.json"), JSON.stringify({
    version: 1,
    missions: [{
      id: "repair-chain-failure-source",
      kind: "operator.autonomous-cycle",
      title: "Original task needs an unavailable exporter",
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
          message: "Exporter unavailable",
          producedAt: "2026-08-15T01:00:00.000Z",
        },
        evaluation: { decision: "rejected", checks: [{ id: "exporter", passed: false }] },
      },
      lastError: "Exporter unavailable",
    }],
  }));
  const executedTargets: string[] = [];
  const createdFiles: string[] = [];
  const runtime = new ForgeRuntime({
    missionLoopPollIntervalMs: 100,
    workspaceChangeExecutor: {
      async execute(rootPath, missionId, request) {
        const startedAt = new Date().toISOString();
        const changedFiles = [];
        for (const change of request.changes) {
          const absolutePath = path.join(rootPath, change.path);
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, change.content, "utf8");
          executedTargets.push(change.path);
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
            exitCode: step === "test" ? 1 : 0,
            stdoutChars: 0,
            stderrChars: step === "test" ? 12 : 0,
            stdoutSha256: sha256(""),
            stderrSha256: sha256(step === "test" ? "test failed" : ""),
            durationMs: 1,
          })),
          rollbackPerformed: true,
          commitSha: null,
          error: "test verification failed",
          startedAt,
          completedAt: new Date().toISOString(),
        };
      },
    },
    async goalRunPlanner(candidate) {
      const repairsExporter = candidate.capabilityId === "tool.proof.export";
      const target = repairsExporter
        ? "artifacts/capability-repair-exporter.ts"
        : "artifacts/capability-repair-should-not-run.json";
      return {
        repositoryId: "forge-core",
        components: [{
          id: repairsExporter ? "build-exporter" : "finish-original",
          title: repairsExporter ? "Build proof exporter" : "Finish original task",
          dependsOn: [],
          targets: [target],
          acceptanceCriteria: candidate.proposedGoalSpec.acceptanceCriteria,
          requiredCapabilities: repairsExporter
            ? ["tool.workspace.write", "tool.workspace.verify"]
            : ["tool.proof.export", "tool.workspace.write", "tool.workspace.verify"],
          workspaceChange: {
            changes: [{ path: target, expectedSha256: null, content: "failure proof\n" }],
            verification: ["typecheck", "test", "build"],
            commit: null,
          },
        }],
      };
    },
  });

  try {
    await runtime.start();
    await runtime.upsertCapability({
      id: "tool.proof.export",
      name: "Proof Exporter",
      description: "Exports deterministic proof artifacts.",
      status: "unavailable",
      version: "0.0.0",
      confidence: 0,
      source: "repair-failure-proof",
    });
    const created = await runtime.createCapabilityGoalRun({
      allowedDirectories: ["artifacts/"],
      maximumGoals: 1,
      maximumCapabilityImprovements: 1,
      maximumImprovementDepth: 2,
      maximumDurationMs: 60_000,
      maximumCostUsd: 0,
      maximumDailyCostUsd: 0,
    });
    assert.ok(created.approval);
    await runtime.approveApproval(created.approval.id, "repair-failure-operator");
    await waitFor(() => {
      const rawGoals = runtime.getMission(created.mission.id)?.output?.goals;
      const goalMissionId = Array.isArray(rawGoals)
        ? (rawGoals[0] as { goalMissionId?: string } | undefined)?.goalMissionId
        : null;
      return goalMissionId ? runtime.getMission(goalMissionId)?.status === "failed" : false;
    });

    assert.deepEqual(executedTargets, ["artifacts/capability-repair-exporter.ts"]);
    assert.equal(runtime.getCapability("tool.proof.export")?.status, "unavailable");
    const rawGoals = runtime.getMission(created.mission.id)?.output?.goals as { goalMissionId: string }[];
    const original = runtime.getMission(rawGoals[0].goalMissionId);
    const failure = original?.output?.capabilityRepairReport as {
      capabilityId?: string;
      repairGoalMissionId?: string;
      failedMissionId?: string;
      reason?: string;
    } | undefined;
    assert.equal(failure?.capabilityId, "tool.proof.export");
    assert.match(failure?.repairGoalMissionId ?? "", /^[0-9a-f-]{36}$/);
    assert.match(failure?.failedMissionId ?? "", /^[0-9a-f-]{36}$/);
    assert.match(failure?.reason ?? "", /rejected by evaluation/);
    const report = runtime.getCapabilityGoalRunReport(created.mission.id) as {
      goals: readonly { repairChain: readonly { status: string; failureReason: string | null }[] }[];
    };
    assert.equal(report.goals[0]?.repairChain[0]?.status, "rejected");
    assert.match(report.goals[0]?.repairChain[0]?.failureReason ?? "", /rejected by evaluation/);
  } finally {
    await runtime.stop().catch(() => undefined);
    for (const file of createdFiles) await rm(file, { force: true });
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await rm(storage, { recursive: true, force: true });
  }
});