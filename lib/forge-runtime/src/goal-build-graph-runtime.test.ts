import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime } from "./runtime";

const criterion = {
  id: "accepted-output",
  statement: "The component mission completes with an accepted evaluation.",
  evidence: "Persisted workspace execution and evaluation evidence",
};

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for goal build state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("one goal approval materializes governed children without child approvals", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-build-graph-state-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;

  try {
    const runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
    await runtime.start();

    const created = await runtime.createGoalBuildGraph({
      objective: "Build a foundation and then its consumer.",
      desiredBehavior: ["The consumer starts only after the foundation is accepted."],
      constraints: ["Use one repository and sequential execution."],
      acceptanceCriteria: [criterion],
    }, {
      repositoryId: "forge-core",
      components: [
        {
          id: "consumer",
          title: "Build graph consumer",
          dependsOn: ["foundation"],
          targets: ["sandbox/build-graph-consumer.txt"],
          acceptanceCriteria: [criterion],
          requiredCapabilities: ["tool.workspace.write", "tool.workspace.verify"],
          workspaceChange: {
            changes: [{
              path: "sandbox/build-graph-consumer.txt",
              expectedSha256: null,
              content: "consumer\n",
            }],
            verification: ["typecheck", "test", "build"],
            commit: null,
          },
        },
        {
          id: "foundation",
          title: "Build graph foundation",
          dependsOn: [],
          targets: ["sandbox/build-graph-foundation.txt"],
          acceptanceCriteria: [criterion],
          requiredCapabilities: ["tool.workspace.write", "tool.workspace.verify"],
          workspaceChange: {
            changes: [{
              path: "sandbox/build-graph-foundation.txt",
              expectedSha256: null,
              content: "foundation\n",
            }],
            verification: ["typecheck", "test", "build"],
            commit: null,
          },
        },
      ],
    }, {
      allowedPaths: [
        "sandbox/build-graph-foundation.txt",
        "sandbox/build-graph-consumer.txt",
      ],
      maximumMissions: 2,
      maximumDurationMs: 60_000,
      maximumCostUsd: 0,
    });

    assert.equal(created.mission.kind, "operator.goal-build");
    assert.equal(created.mission.status, "awaiting_approval");
    assert.ok(created.approval);
    assert.deepEqual(
      runtime.listApprovals("pending").map((approval) => approval.missionId),
      [created.mission.id],
    );

    await runtime.approveApproval(created.approval.id, "build-graph-test");
    await waitFor(() => runtime.getMission(created.mission.id)?.status === "succeeded");

    const goalMission = runtime.getMission(created.mission.id);
    assert.ok(goalMission);
    const graph = goalMission.output?.graph;
    assert.equal(typeof graph, "object");
    assert.ok(graph !== null && !Array.isArray(graph));
    const nodes = (graph as { readonly nodes: readonly { readonly id: string; readonly missionId: string }[] }).nodes;
    assert.equal(nodes.length, 2);
    assert.equal(
      runtime.listApprovals().filter((approval) =>
        nodes.some((node) => node.missionId === approval.missionId)
      ).length,
      0,
    );

    const consumer = nodes.find((node) => node.id === "consumer");
    assert.ok(consumer);
    const consumerMission = runtime.getMission(consumer.missionId);
    assert.ok(consumerMission);
    assert.equal(
      (consumerMission.input.goalBuildGraph as { readonly dependsOnMissionId: string }).dependsOnMissionId,
      nodes.find((node) => node.id === "foundation")?.missionId,
    );
    assert.notEqual(consumerMission.status, "awaiting_approval");

    const integration = await runtime.evaluateGoalBuildGraph(graph as Parameters<typeof runtime.evaluateGoalBuildGraph>[0]);
    assert.equal(integration.decision, "blocked");
    assert.equal(integration.learningEligible, false);
    assert.equal(integration.evidenceMemoryId, null);
    assert.equal(integration.report.graphId, (graph as { readonly id: string }).id);
    assert.equal(integration.report.decision, "blocked");
    assert.equal(integration.report.actualEstimatedCostUsd, 0);
    assert.deepEqual(integration.report.builtComponents, []);
    assert.deepEqual(integration.report.rejectedComponents, []);
    assert.deepEqual(integration.report.boundaryFailures, []);

    await runtime.stop();
  } finally {
    if (previousStorage === undefined) {
      delete process.env.STORAGE_DIR;
    } else {
      process.env.STORAGE_DIR = previousStorage;
    }
    await rm(storage, { recursive: true, force: true });
  }
});