import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ForgeRuntime,
  type AiProviderConnector,
  type MissionRecord,
} from "./index.js";

const environmentKeys = [
  "STORAGE_DIR",
  "FORGE_WORKSPACE_ROOT",
  "FORGE_AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
] as const;

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for autonomous missions");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function withEnvironment(
  run: (storageRoot: string) => Promise<void>,
): Promise<void> {
  const original = new Map(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const storageRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-autonomous-loop-"),
  );

  process.env.STORAGE_DIR = storageRoot;
  process.env.FORGE_WORKSPACE_ROOT = process.cwd();
  process.env.FORGE_AI_PROVIDER = "openai-responses";
  process.env.OPENAI_API_KEY = "test-only-not-a-real-secret";
  process.env.OPENAI_MODEL = "test-model";

  try {
    await run(storageRoot);
  } finally {
    for (const key of environmentKeys) {
      const value = original.get(key);

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await rm(storageRoot, { recursive: true, force: true });
  }
}

function autonomousRequest(maxCycles: number) {
  return {
    kind: "operator.autonomous-cycle" as const,
    title: `Autonomous provider loop 1/${maxCycles}`,
    input: {
      projectId: "forge-core",
      objective: "Identify the next evidence-backed Forge implementation step.",
      cycleIndex: 1,
      maxCycles,
      files: [],
    },
  };
}

function autonomousMissions(runtime: ForgeRuntime): MissionRecord[] {
  return runtime
    .listMissions()
    .filter((mission) => mission.kind === "operator.autonomous-cycle");
}

test("autonomous provider loop", { concurrency: false }, async (t) => {
  await t.test("completes, continues and survives restart", async () => {
    await withEnvironment(async () => {
      let providerCalls = 0;
      const connector: AiProviderConnector = {
        id: "openai-responses",
        async execute() {
          providerCalls += 1;

          return Object.freeze({
            providerResponseId: `response-${providerCalls}`,
            outputText: [
              "# Evidence-backed implementation step",
              "Inspect the current integration boundary and implement only the missing link while preserving the authoritative runtime state.",
              "",
              "## Assumptions",
              "The supplied repository state and persistent project memory are authoritative. No unreported code or test result is assumed.",
              "",
              "## Verification",
              "Run typecheck, build, deterministic integration tests, restart the runtime, and verify mission, execution, evaluation and continuation identifiers.",
            ].join("\n"),
            usage: Object.freeze({
              inputTokens: 120,
              outputTokens: 80,
              totalTokens: 200,
            }),
          });
        },
      };
      const runtime = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();

      const created = await runtime.createMission(autonomousRequest(2));

      assert.equal(created.mission.status, "awaiting_approval");
      assert.equal(created.governance.decision, "require_approval");
      assert.ok(created.approval);

      await runtime.approveApproval(
        created.approval.id,
        "integration-test",
        "Approve bounded two-cycle provider verification",
      );

      await waitFor(() => {
        const missions = autonomousMissions(runtime);
        return (
          missions.length === 2 &&
          missions.every((mission) => mission.status === "succeeded")
        );
      });

      const missions = autonomousMissions(runtime);
      assert.equal(providerCalls, 2);
      assert.equal(missions[1].attempts, 1);
      assert.equal(missions[1].input.continuationAuthorized, true);
      assert.equal(missions[1].input.previousMissionId, missions[0].id);
      assert.equal(missions[0].output?.nextMissionId, missions[1].id);
      assert.equal(missions[1].output?.nextMissionId, null);

      for (const mission of missions) {
        const evaluation = mission.output?.evaluation as {
          decision?: unknown;
          score?: unknown;
        };

        assert.equal(evaluation.decision, "accepted");
        assert.equal(evaluation.score, 100);
      }

      const executions = runtime.listAiExecutions();
      assert.deepEqual(
        executions.map((execution) => execution.missionId),
        missions.map((mission) => mission.id),
      );

      const evidence = runtime
        .listProjectMemories("forge-core", "evidence")
        .filter((memory) => memory.source.startsWith("autonomous-cycle:"));
      assert.equal(evidence.length, 2);
      assert.ok(
        runtime
          .snapshot()
          .events.some(
            (event) => event.type === "autonomous.cycle.continuation.scheduled",
          ),
      );

      await runtime.stop();

      const restarted = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });
      await restarted.start();

      assert.equal(autonomousMissions(restarted).length, 2);
      assert.equal(restarted.listAiExecutions().length, 2);
      assert.equal(
        restarted
          .listProjectMemories("forge-core", "evidence")
          .filter((memory) => memory.source.startsWith("autonomous-cycle:"))
          .length,
        2,
      );

      await restarted.stop();
    });
  });

  await t.test("contains provider failure without continuation", async () => {
    await withEnvironment(async () => {
      const connector: AiProviderConnector = {
        id: "openai-responses",
        async execute() {
          throw new Error("Simulated quota failure");
        },
      };
      const runtime = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission(autonomousRequest(2));
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "integration-test");

      await waitFor(() => {
        const missions = autonomousMissions(runtime);
        return missions.length === 1 && missions[0].status === "failed";
      });

      assert.equal(autonomousMissions(runtime).length, 1);
      assert.equal(runtime.listAiExecutions().length, 1);
      assert.equal(runtime.listAiExecutions()[0].status, "failed");
      assert.equal(runtime.snapshot().kernel.status, "running");

      await runtime.stop();
    });
  });
});
