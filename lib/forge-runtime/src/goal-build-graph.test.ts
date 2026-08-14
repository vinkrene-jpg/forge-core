import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityRecord } from "./capability";
import {
  createBuildGraph,
  evaluateBuildGraphComponent,
  evaluateBuildGraphIntegration,
  parseBuildGraphProposal,
  parseGoalSpec,
} from "./goal-build-graph";
import type { MissionRecord } from "./mission";

const capability = Object.freeze({
  id: "workspace.execute",
  name: "Workspace execution",
  description: "Executes governed workspace changes.",
  status: "operational",
  version: "1.0.0",
  confidence: 1,
  source: "test",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
}) satisfies CapabilityRecord;

const criterion = {
  id: "accepted-output",
  statement: "The generated output is accepted by deterministic evaluation.",
  evidence: "Persisted accepted evaluation record",
};

function component(id: string, dependsOn: readonly string[] = []) {
  return {
    id,
    title: `Build ${id}`,
    dependsOn,
    targets: [`sandbox/${id}.txt`],
    acceptanceCriteria: [criterion],
    requiredCapabilities: [capability.id],
    workspaceChange: {
      changes: [{
        path: `sandbox/${id}.txt`,
        expectedSha256: null,
        content: `${id}\n`,
      }],
      verification: ["typecheck", "test", "build"],
      commit: null,
    },
  };
}

test("validates a bounded two-component Goal-to-Software graph", () => {
  const goalSpec = parseGoalSpec({
    objective: "Build two dependent proof components.",
    desiredBehavior: ["The second component uses the accepted first component."],
    constraints: ["Use only the forge-core repository."],
    acceptanceCriteria: [criterion],
  });
  const graph = parseBuildGraphProposal({
    repositoryId: "forge-core",
    components: [component("foundation"), component("consumer", ["foundation"])],
  }, [capability]);

  assert.equal(goalSpec.acceptanceCriteria.length, 1);
  assert.deepEqual(graph.components[1].dependsOn, ["foundation"]);
  assert.deepEqual(graph.components[1].workspaceChange.verification, ["typecheck", "test", "build"]);
});

test("rejects graph authority when deterministic build gates are incomplete", () => {
  const invalid = component("foundation");
  assert.throws(
    () => parseBuildGraphProposal({
      repositoryId: "forge-core",
      components: [{
        ...invalid,
        workspaceChange: { ...invalid.workspaceChange, verification: ["typecheck", "test"] },
      }],
    }, [capability]),
    /must require build verification/,
  );
});

test("rejects duplicate ids, cycles, unsafe targets and unavailable capabilities", () => {
  assert.throws(
    () => parseBuildGraphProposal({
      repositoryId: "forge-core",
      components: [component("same"), component("same")],
    }, [capability]),
    /Duplicate component id/,
  );
  assert.throws(
    () => parseBuildGraphProposal({
      repositoryId: "forge-core",
      components: [component("self", ["self"])],
    }, [capability]),
    /cannot depend on itself/,
  );
  assert.throws(
    () => parseBuildGraphProposal({
      repositoryId: "forge-core",
      components: [{
        ...component("unsafe"),
        targets: ["../outside.txt"],
        workspaceChange: {
          ...component("unsafe").workspaceChange,
          changes: [{ path: "../outside.txt", expectedSha256: null, content: "unsafe\n" }],
        },
      }],
    }, [capability]),
    /Unsafe workspace path/,
  );
  assert.throws(
    () => parseBuildGraphProposal({
      repositoryId: "forge-core",
      components: [{ ...component("missing"), requiredCapabilities: ["missing.capability"] }],
    }, [capability]),
    /requires unavailable capability/,
  );
});

test("derives integration authority only from accepted component missions", () => {
  const goalSpec = parseGoalSpec({
    objective: "Build one accepted component.",
    desiredBehavior: ["The component produces verified output."],
    constraints: ["Use only the forge-core repository."],
    acceptanceCriteria: [criterion],
  });
  const proposal = parseBuildGraphProposal({
    repositoryId: "forge-core",
    components: [component("foundation")],
  }, [capability]);
  const graph = createBuildGraph(
    goalSpec,
    proposal,
    new Map([["foundation", "mission-1"]]),
    (missionId) => missionId === "mission-1",
    "graph-1",
  );
  const mission = (status: MissionRecord["status"], decision?: string): MissionRecord => ({
    id: "mission-1",
    kind: "operator.workspace-change",
    title: "Foundation",
    status,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    attempts: 0,
    interruptedCount: 0,
    input: {},
    output: decision ? { evaluation: { decision } } : null,
    lastError: null,
  });

  const blocked = evaluateBuildGraphIntegration(graph, () => mission("awaiting_approval"));
  const accepted = evaluateBuildGraphIntegration(graph, () => mission("succeeded", "accepted"));

  assert.equal(blocked.decision, "blocked");
  assert.equal(blocked.learningEligible, false);
  assert.equal(accepted.decision, "accepted");
  assert.equal(accepted.learningEligible, true);
});

test("rejects missing goal coverage and non-existing or duplicate mission ids", () => {
  const goalSpec = parseGoalSpec({
    objective: "Build one accepted component.",
    desiredBehavior: ["The component produces verified output."],
    constraints: ["Use only the forge-core repository."],
    acceptanceCriteria: [criterion],
  });
  const uncoveredProposal = parseBuildGraphProposal({
    repositoryId: "forge-core",
    components: [{
      ...component("foundation"),
      acceptanceCriteria: [{ ...criterion, id: "different-criterion" }],
    }],
  }, [capability]);
  assert.throws(
    () => createBuildGraph(goalSpec, uncoveredProposal, new Map([["foundation", "mission-1"]]), () => true, "graph-1"),
    /not covered by a component/,
  );

  const proposal = parseBuildGraphProposal({
    repositoryId: "forge-core",
    components: [component("foundation"), component("consumer", ["foundation"])],
  }, [capability]);
  assert.throws(
    () => createBuildGraph(
      goalSpec,
      proposal,
      new Map([["foundation", "mission-1"], ["consumer", "mission-2"]]),
      () => false,
      "graph-1",
    ),
    /no existing missionId/,
  );
  assert.throws(
    () => createBuildGraph(
      goalSpec,
      proposal,
      new Map([["foundation", "mission-1"], ["consumer", "mission-1"]]),
      () => true,
      "graph-1",
    ),
    /duplicate missionId/,
  );
});

test("accepts a component only with exact targets and all fixed verification receipts", () => {
  const request = component("foundation").workspaceChange;
  const execution = {
    id: "execution-1",
    missionId: "mission-1",
    status: "committed" as const,
    branch: "forge-sync-primary",
    changedFiles: [{
      path: "sandbox/foundation.txt",
      beforeSha256: null,
      afterSha256: "a".repeat(64),
    }],
    verification: ["typecheck", "test", "build"].map((command) => ({
      command: `pnpm run ${command}`,
      exitCode: 0,
      stdoutChars: 0,
      stderrChars: 0,
      stdoutSha256: "a".repeat(64),
      stderrSha256: "a".repeat(64),
      durationMs: 1,
    })),
    rollbackPerformed: false,
    commitSha: "a".repeat(40),
    error: null,
    startedAt: "2026-08-14T00:00:00.000Z",
    completedAt: "2026-08-14T00:00:01.000Z",
  };

  assert.equal(evaluateBuildGraphComponent("mission-1", request, execution).decision, "accepted");
  assert.equal(evaluateBuildGraphComponent("mission-1", request, {
    ...execution,
    verification: execution.verification.slice(0, 2),
  }).decision, "rejected");
});