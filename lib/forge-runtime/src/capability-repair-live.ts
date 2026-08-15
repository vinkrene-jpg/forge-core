import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ForgeRuntime } from "./runtime";

const repairTarget = "artifacts/capability-repair-live-tool.txt";
const originalTarget = "artifacts/capability-repair-live-result.json";
const missingCapabilityId = "tool.live-proof.render";

async function waitFor(predicate: () => boolean, timeoutMs = 20 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for live capability repair chain");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const storage = await mkdtemp(path.join(os.tmpdir(), "forge-capability-repair-live-"));
const previousStorage = process.env.STORAGE_DIR;
const previousConcurrency = process.env.PNPM_WORKSPACE_CONCURRENCY;
process.env.STORAGE_DIR = storage;
process.env.PNPM_WORKSPACE_CONCURRENCY = "1";
await mkdir(path.join(storage, "forge-runtime"), { recursive: true });
await writeFile(path.join(storage, "forge-runtime", "missions.json"), JSON.stringify({
  version: 1,
  missions: [{
    id: "capability-repair-live-source",
    kind: "operator.autonomous-cycle",
    title: "Render and persist the final live proof",
    status: "failed",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:01:00.000Z",
    startedAt: "2026-08-15T10:00:30.000Z",
    completedAt: "2026-08-15T10:01:00.000Z",
    attempts: 1,
    interruptedCount: 0,
    input: {},
    output: {
      missionResult: {
        status: "rejected",
        cause: "evaluation",
        message: "Live proof renderer is unavailable",
        producedAt: "2026-08-15T10:01:00.000Z"
      },
      evaluation: {
        decision: "rejected",
        checks: [{ id: "live-proof-renderer", passed: false }]
      }
    },
    lastError: "Live proof renderer is unavailable"
  }]
}));

const runtime = new ForgeRuntime({
  missionLoopPollIntervalMs: 100,
  async goalRunPlanner(candidate) {
    const repairsCapability = candidate.capabilityId === missingCapabilityId;
    const target = repairsCapability ? repairTarget : originalTarget;
    return {
      repositoryId: "forge-core",
      components: [{
        id: repairsCapability ? "build-live-renderer" : "complete-live-original",
        title: repairsCapability ? "Build live proof renderer" : "Complete original live proof",
        dependsOn: [],
        targets: [target],
        acceptanceCriteria: candidate.proposedGoalSpec.acceptanceCriteria,
        requiredCapabilities: repairsCapability
          ? ["tool.workspace.write", "tool.workspace.verify"]
          : [missingCapabilityId, "tool.workspace.write", "tool.workspace.verify"],
        workspaceChange: {
          changes: [{
            path: target,
            expectedSha256: null,
            content: repairsCapability
              ? "capability=tool.live-proof.render\nstatus=proven\n"
              : JSON.stringify({
                  originalTask: "Render and persist the final live proof",
                  missingCapabilityId,
                  capabilityBuiltFirst: true,
                  originalTaskCompleted: true,
                }, null, 2) + "\n",
          }],
          verification: ["typecheck", "test", "build"],
          commit: {
            message: repairsCapability
              ? "feat: prove live proof renderer capability"
              : "feat: complete resumed live proof goal",
            push: false,
          },
        },
      }],
    };
  },
});

try {
  await runtime.start();
  await runtime.upsertCapability({
    id: missingCapabilityId,
    name: "Live Proof Renderer",
    description: "Renders and persists a deterministic live proof artifact.",
    status: "unavailable",
    version: "0.0.0",
    confidence: 0,
    source: "capability-repair-live-precondition",
  });
  const initialCapability = runtime.getCapability(missingCapabilityId);
  const created = await runtime.createCapabilityGoalRun({
    allowedDirectories: ["artifacts/"],
    maximumGoals: 1,
    maximumCapabilityImprovements: 1,
    maximumImprovementDepth: 2,
    maximumDurationMs: 20 * 60_000,
    maximumCostUsd: 0,
  });
  if (!created.approval) throw new Error("Live goal run did not create its one required approval");
  await runtime.approveApproval(created.approval.id, "capability-repair-live-operator");
  await waitFor(() => {
    const report = runtime.getMission(created.mission.id)?.output?.goals;
    const goalMissionId = Array.isArray(report)
      ? (report[0] as { goalMissionId?: string } | undefined)?.goalMissionId
      : null;
    if (!goalMissionId) return false;
    const goalMission = runtime.getMission(goalMissionId);
    const graph = goalMission?.output?.graph as { nodes?: { missionId: string }[] } | undefined;
    return graph?.nodes?.every((node) => {
      const child = runtime.getMission(node.missionId);
      return child?.status === "succeeded" &&
        (child.output?.evaluation as { decision?: string } | undefined)?.decision === "accepted";
    }) === true;
  });

  const report = runtime.getCapabilityGoalRunReport(created.mission.id) as {
    goals: readonly {
      goalMissionId: string;
      status: string;
      repairChain: readonly {
        missionId: string;
        capabilityId: string;
        status: string;
        commitShas: readonly string[];
      }[];
    }[];
  };
  const originalGoal = runtime.getMission(report.goals[0].goalMissionId);
  const originalGraph = originalGoal?.output?.graph as { nodes?: { missionId: string }[] } | undefined;
  const originalCommitShas = originalGraph?.nodes?.flatMap((node) => {
    const commitSha = runtime.getMission(node.missionId)?.output?.commitSha;
    return typeof commitSha === "string" ? [commitSha] : [];
  }) ?? [];
  console.log(JSON.stringify({
    runMissionId: created.mission.id,
    approvalId: created.approval.id,
    initialCapability,
    finalCapability: runtime.getCapability(missingCapabilityId),
    gap: missingCapabilityId,
    repairChain: report.goals[0].repairChain,
    originalGoalMissionId: report.goals[0].goalMissionId,
    originalStatus: report.goals[0].status,
    originalCommitShas,
    repairTarget,
    originalTarget,
    pushed: false,
  }, null, 2));
} finally {
  await runtime.stop().catch(() => undefined);
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
  if (previousConcurrency === undefined) delete process.env.PNPM_WORKSPACE_CONCURRENCY;
  else process.env.PNPM_WORKSPACE_CONCURRENCY = previousConcurrency;
  await rm(storage, { recursive: true, force: true });
}