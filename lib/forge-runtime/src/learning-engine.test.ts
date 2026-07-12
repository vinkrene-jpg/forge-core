import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime, type AiProviderConnector } from "./index.js";

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
      throw new Error("Timed out while waiting for learning evidence");
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
    path.join(os.tmpdir(), "forge-learning-engine-"),
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

test(
  "learning engine persists evidence and uses governance for proposals",
  { concurrency: false },
  async () => {
    await withEnvironment(async (storageRoot) => {
      let providerCalls = 0;
      const connector: AiProviderConnector = {
        id: "openai-responses",
        async execute() {
          providerCalls += 1;

          return Object.freeze({
            providerResponseId: `learning-response-${providerCalls}`,
            outputText: [
              "# Evidence-backed capability exercise",
              "The next reversible step is to validate the weakest capability using persisted runtime events and an isolated deterministic test.",
              "",
              "## Assumptions",
              "The capability registry and supplied runtime evidence are authoritative. No source change or test result is assumed.",
              "",
              "## Verification",
              "Record exact evidence identifiers, run typecheck and integration tests, replace the runtime, and verify that learning state is unchanged.",
            ].join("\n"),
            usage: Object.freeze({
              inputTokens: 100,
              outputTokens: 80,
              totalTokens: 180,
            }),
          });
        },
      };
      const runtime = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission({
        kind: "operator.autonomous-cycle",
        title: "Learning evidence source",
        input: {
          projectId: "forge-core",
          objective: "Create one accepted evidence source for learning.",
          cycleIndex: 1,
          maxCycles: 1,
          files: [],
        },
      });

      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "learning-test");

      await waitFor(
        () => runtime.getMission(created.mission.id)?.status === "succeeded",
      );

      assert.equal(providerCalls, 1);
      assert.equal(runtime.learningSummary().observations, 1);
      assert.equal(runtime.listLearningObservations().length, 1);
      assert.ok(runtime.listLearningProfiles().length > 3);
      assert.equal(runtime.listLearningProposals().length, 1);

      const observation = runtime.listLearningObservations()[0];
      const proposal = runtime.listLearningProposals()[0];
      const mission = runtime.getMission(created.mission.id);

      assert.equal(observation.missionId, created.mission.id);
      assert.equal(observation.outcome, "passed");
      assert.equal(observation.evaluationScore, 100);
      assert.equal(mission?.output?.learningObservationId, observation.id);
      assert.equal(mission?.output?.learningProposalId, proposal.id);
      assert.equal(proposal.status, "proposed");
      assert.ok(proposal.priority > 0);
      assert.equal(
        runtime.getCapability("learning.evidence.assess")?.status,
        "operational",
      );

      await runtime.stop();

      const restarted = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });
      await restarted.start();

      assert.equal(restarted.learningSummary().observations, 1);
      assert.deepEqual(
        restarted.listLearningObservations(),
        runtime.listLearningObservations(),
      );
      assert.deepEqual(
        restarted.listLearningProfiles(),
        runtime.listLearningProfiles(),
      );

      await restarted.stop();

      await rm(
        path.join(storageRoot, "forge-runtime", "learning-engine.json"),
        { force: true },
      );

      const reconciled = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });
      await reconciled.start();

      assert.equal(reconciled.learningSummary().observations, 1);
      assert.equal(providerCalls, 1);

      const reconciledProposal = reconciled.listLearningProposals()[0];
      assert.ok(reconciledProposal);

      const scheduled = await reconciled.scheduleLearningProposal(
        reconciledProposal.id,
      );

      assert.equal(scheduled.proposal.status, "scheduled");
      assert.equal(scheduled.mission.mission.status, "awaiting_approval");
      assert.equal(scheduled.mission.governance.decision, "require_approval");
      assert.ok(scheduled.mission.approval);
      assert.equal(providerCalls, 1);
      assert.equal(reconciled.learningSummary().scheduled, 1);

      await reconciled.stop();
    });
  },
);
