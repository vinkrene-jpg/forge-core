import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ForgeRuntime, type AiProviderConnector } from "./index.js";

const environmentKeys = [
  "STORAGE_DIR",
  "FORGE_WORKSPACE_ROOT",
  "FORGE_AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "FORGE_AUTONOMY_ENABLED",
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
  process.env.FORGE_WORKSPACE_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  process.env.FORGE_AI_PROVIDER = "openai-responses";
  process.env.OPENAI_API_KEY = "test-only-not-a-real-secret";
  process.env.OPENAI_MODEL = "test-model";
  process.env.FORGE_AUTONOMY_ENABLED = "false";

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
        async execute(composition) {
          providerCalls += 1;
          const evidenceId = /Required evidence ID:\s*([a-f0-9-]+)/i.exec(
            composition.content,
          )?.[1];

          if (providerCalls === 3) {
            return Object.freeze({
              providerResponseId: "learning-response-rejected",
              outputText: [
                "# Incomplete learning result",
                "This provider-only answer cannot verify that the target capability executed successfully. It records a proposed next step but no concrete runtime evidence.",
                "The response intentionally omits the required premise declaration so deterministic evaluation must reject it safely.",
                "Verification must use persisted mission, execution and Project Memory identifiers before any capability score can be accepted.",
                `EVIDENCE: ${evidenceId}`,
                "CAPABILITY_RESULT: GAP",
              ].join("\n"),
              usage: Object.freeze({
                inputTokens: 90,
                outputTokens: 60,
                totalTokens: 150,
              }),
            });
          }

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
              ...(evidenceId
                ? [
                    "",
                    `EVIDENCE: ${evidenceId}`,
                    "CAPABILITY_RESULT: PASS",
                  ]
                : []),
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
          objective: "Produce one accepted evidence source for learning.",
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
      assert.equal(runtime.listLearningMatrix().length, 3);

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
      const targetBefore = reconciled
        .listLearningProfiles()
        .find(
          (profile) =>
            profile.capabilityId === reconciledProposal.targetCapabilityId,
        );
      assert.ok(targetBefore);

      const scheduled = await reconciled.scheduleLearningProposal(
        reconciledProposal.id,
      );

      assert.equal(scheduled.proposal.status, "scheduled");
      assert.equal(scheduled.mission.mission.status, "awaiting_approval");
      assert.equal(scheduled.mission.governance.decision, "require_approval");
      assert.ok(scheduled.mission.approval);
      assert.equal(providerCalls, 1);
      assert.equal(reconciled.learningSummary().scheduled, 1);
      assert.equal(scheduled.mission.mission.input.maxCycles, 1);
      assert.equal(
        scheduled.mission.mission.input.learningProposalId,
        reconciledProposal.id,
      );
      assert.equal(
        scheduled.mission.mission.input.targetCapabilityId,
        reconciledProposal.targetCapabilityId,
      );
      assert.ok(scheduled.mission.mission.input.reasonForSelection);
      assert.ok(
        scheduled.mission.mission.input.expectedNewEvidence.length > 0,
      );
      assert.match(
        scheduled.mission.mission.input.reasonForSelection,
        /open blockage|recent/i,
      );

      await assert.rejects(
        reconciled.scheduleLearningProposal(reconciledProposal.id),
        /already scheduled/,
      );

      await reconciled.approveApproval(
        scheduled.mission.approval.id,
        "learning-feedback-test",
      );

      await waitFor(
        () => {
          const status = reconciled.getMission(
            scheduled.mission.mission.id,
          )?.status;

          return status === "succeeded" || status === "failed";
        },
      );

      const feedbackMission = reconciled.getMission(
        scheduled.mission.mission.id,
      );
      assert.equal(
        feedbackMission?.status,
        "succeeded",
        feedbackMission?.lastError ?? "Learning feedback mission did not succeed",
      );

      assert.equal(providerCalls, 2);
      assert.equal(reconciled.listMissions().length, 2);
      assert.equal(reconciled.learningSummary().observations, 2);
      assert.equal(reconciled.learningSummary().scheduled, 0);
      assert.equal(reconciled.learningSummary().completed, 1);
      assert.equal(reconciled.learningSummary().proposed, 1);

      const completed = reconciled
        .listLearningProposals()
        .find((proposal) => proposal.id === reconciledProposal.id);
      const nextProposal = reconciled
        .listLearningProposals()
        .find((proposal) => proposal.id !== reconciledProposal.id);
      const feedback = reconciled
        .listLearningObservations()
        .find(
          (observation) =>
            observation.missionId === scheduled.mission.mission.id,
        );
      const targetAfter = reconciled
        .listLearningProfiles()
        .find(
          (profile) =>
            profile.capabilityId === reconciledProposal.targetCapabilityId,
        );

      assert.equal(completed?.status, "completed");
      assert.equal(completed?.resultObservationId, feedback?.id);
      assert.equal(feedback?.sourceProposalId, reconciledProposal.id);
      assert.equal(feedback?.capabilityResult, "pass");
      assert.ok(feedback?.toolEvidenceMemoryId);
      assert.equal(
        feedback?.targetCapabilityId,
        reconciledProposal.targetCapabilityId,
      );
      assert.ok(targetAfter);
      assert.equal(targetAfter.observations, targetBefore.observations + 1);
      assert.notEqual(targetAfter.score, targetBefore.score);
      assert.ok(nextProposal);
      assert.equal(nextProposal.status, "proposed");
      assert.ok(
        nextProposal.targetCapabilityId !==
          reconciledProposal.targetCapabilityId ||
          /deprioritized|without repeating|lowest evidence-backed gap|no recent successful repeat/i.test(
            nextProposal.mission.input.reasonForSelection,
          ),
      );
      assert.ok(nextProposal.reason.length > 0);
      assert.ok(nextProposal.mission.input.reasonForSelection.length > 0);
      assert.ok(nextProposal.mission.input.expectedNewEvidence.length > 0);

      const failedTargetBefore = reconciled
        .listLearningProfiles()
        .find(
          (profile) =>
            profile.capabilityId === nextProposal.targetCapabilityId,
        );
      assert.ok(failedTargetBefore);

      const failedScheduled = await reconciled.scheduleLearningProposal(
        nextProposal.id,
      );
      assert.ok(failedScheduled.mission.approval);
      await reconciled.approveApproval(
        failedScheduled.mission.approval.id,
        "learning-failure-test",
      );
      await waitFor(
        () =>
          reconciled.getMission(failedScheduled.mission.mission.id)?.status ===
          "failed",
      );

      assert.equal(providerCalls, 3);
      assert.equal(reconciled.learningSummary().scheduled, 1);

      const recovered = await reconciled.recordFailedLearningExercise(
        nextProposal.id,
      );
      const failedTargetAfter = reconciled
        .listLearningProfiles()
        .find(
          (profile) =>
            profile.capabilityId === nextProposal.targetCapabilityId,
        );

      assert.equal(recovered.failedProposal.status, "failed");
      assert.equal(recovered.observation.outcome, "failed");
      assert.equal(
        recovered.observation.sourceProposalId,
        nextProposal.id,
      );
      assert.ok(
        recovered.observation.signals[0].rationale.includes(
          "assumptions-explicit",
        ),
      );
      assert.equal(recovered.nextProposal.status, "proposed");
      assert.ok(failedTargetAfter);
      assert.equal(
        failedTargetAfter.observations,
        failedTargetBefore.observations + 1,
      );
      assert.equal(reconciled.learningSummary().scheduled, 0);
      assert.equal(reconciled.learningSummary().failed, 1);
      assert.equal(reconciled.learningSummary().completed, 1);
      assert.equal(reconciled.learningSummary().proposed, 1);

      await assert.rejects(
        reconciled.recordFailedLearningExercise(nextProposal.id),
        /scheduled learning proposal/,
      );

      await reconciled.stop();

      const feedbackRestart = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });
      await feedbackRestart.start();

      assert.equal(feedbackRestart.learningSummary().completed, 1);
      assert.equal(feedbackRestart.learningSummary().failed, 1);
      assert.equal(feedbackRestart.learningSummary().proposed, 1);
      assert.equal(providerCalls, 3);

      await feedbackRestart.stop();
    });
  },
);
