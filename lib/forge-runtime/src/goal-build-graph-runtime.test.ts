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

test("build graph nodes use existing missions and dependency approval fails closed", async () => {
  const storage = await mkdtemp(path.join(os.tmpdir(), "forge-build-graph-state-"));
  const previousStorage = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = storage;

  try {
    const runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
    await runtime.start();

    const graph = await runtime.createGoalBuildGraph({
      objective: "Build a foundation and then its consumer.",
      desiredBehavior: ["The consumer starts only after the foundation is accepted."],
      constraints: ["Use one repository and sequential execution."],
      acceptanceCriteria: [criterion],
    }, {
      repositoryId: "forge-core",
      components: [
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
      ],
    });

    assert.equal(graph.nodes.length, 2);
    for (const node of graph.nodes) {
      assert.equal(runtime.getMission(node.missionId)?.status, "awaiting_approval");
    }

    const consumer = graph.nodes.find((node) => node.id === "consumer");
    assert.ok(consumer);
    const consumerApproval = runtime
      .listApprovals("pending")
      .find((approval) => approval.missionId === consumer.missionId);
    assert.ok(consumerApproval);

    await assert.rejects(
      runtime.approveApproval(consumerApproval.id, "build-graph-test"),
      /dependency mission .* is not accepted/,
    );
    assert.equal(runtime.getMission(consumer.missionId)?.status, "awaiting_approval");
    assert.equal(runtime.getApproval(consumerApproval.id)?.status, "pending");

    const integration = await runtime.evaluateGoalBuildGraph(graph);
    assert.equal(integration.decision, "blocked");
    assert.equal(integration.learningEligible, false);
    assert.equal(integration.evidenceMemoryId, null);

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