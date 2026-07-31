import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  ForgeRuntime,
  type AiProviderConnector,
  type MissionRecord,
  type WorkspaceVerificationRunner,
} from "./index.js";

const exec = promisify(execFile);

const environmentKeys = [
  "STORAGE_DIR",
  "FORGE_WORKSPACE_ROOT",
  "FORGE_AI_PROVIDER",
  "FORGE_LOCAL_MODEL_ENABLED",
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

    await removeWithRetry(storageRoot);
  }
}

async function removeWithRetry(pathToRemove: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(pathToRemove, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "";

      if (code !== "EBUSY" && code !== "EPERM") {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  await rm(pathToRemove, { recursive: true, force: true });
}

function autonomousRequest(maxCycles: number) {
  return {
    kind: "operator.autonomous-cycle" as const,
    title: `Autonomous provider loop 1/${maxCycles}`,
    input: {
      projectId: "forge-core",
      objective:
        "Identify the next evidence-backed Forge implementation step without modifying files.",
      cycleIndex: 1,
      maxCycles,
      files: [],
    },
  };
}

function proofRequest() {
  return {
    kind: "operator.autonomous-cycle" as const,
    title: "Autonomous proof mission",
    input: {
      projectId: "forge-core",
      objective:
        "Maak in een tijdelijke sandbox een bestand forge-proof.txt met een unieke tekst, lees het bestand terug en lever de SHA-256 hash.",
      cycleIndex: 1,
      maxCycles: 1,
      files: [],
    },
  };
}

async function createWorkspaceRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-generic-build-"));
  await exec("git", ["init", "-b", "test/generic-build"], { cwd: root });
  await exec("git", ["config", "user.name", "Forge Test"], { cwd: root });
  await exec("git", ["config", "user.email", "forge-test@example.invalid"], {
    cwd: root,
  });
  await writeFile(path.join(root, "README.txt"), "baseline\n", "utf8");
  await exec("git", ["add", "README.txt"], { cwd: root });
  await exec("git", ["commit", "-m", "test baseline"], { cwd: root });
  return root;
}

const successfulWorkspaceRunner: WorkspaceVerificationRunner = {
  async run(step) {
    return Object.freeze({
      command: `fake ${step}`,
      exitCode: 0,
      stdout: "passed",
      stderr: "",
      durationMs: 1,
    });
  },
};

function autonomousMissions(runtime: ForgeRuntime): MissionRecord[] {
  return runtime
    .listMissions()
    .filter((mission) => mission.kind === "operator.autonomous-cycle");
}

function assertNoExecutionEvidence(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoExecutionEvidence(item);
    }
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const evidenceKeys = [
    "receipts",
    "fileEffects",
    "verificationRuns",
    "artifacts",
  ] as const;

  if ("executionEvidence" in record) {
    assert.equal(record.executionEvidence, null);
  }

  for (const key of evidenceKeys) {
    if (key in record) {
      assert.ok(
        !Array.isArray(record[key]) || record[key].length === 0,
        `${key} must be empty before workspace approval`,
      );
    }
  }

  for (const nested of Object.values(record)) {
    assertNoExecutionEvidence(nested);
  }
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
              "Source: lib/forge-runtime/src/runtime.ts.",
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

        if (missions.some((mission) => mission.status === "failed")) {
          const detail = JSON.stringify(
            missions.map((mission) => ({
              status: mission.status,
              error: mission.lastError,
            })),
          );
          throw new Error(`Autonomous continuation failed: ${detail}`);
        }

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

  await t.test(
    "pauses after a learning exercise and resumes only explicitly",
    async () => {
      await withEnvironment(async () => {
        let providerCalls = 0;
        const connector: AiProviderConnector = {
          id: "openai-responses",
          async execute(composition) {
            providerCalls += 1;
            const evidenceId = /Required evidence ID:\s*([a-f0-9-]+)/i.exec(
              composition.content,
            )?.[1];

            return Object.freeze({
              providerResponseId: `pause-response-${providerCalls}`,
              outputText: [
                "# Evidence-backed implementation step",
                "Inspect the current integration boundary and implement only the missing link while preserving the authoritative runtime state.",
                "Source: lib/forge-runtime/src/runtime.ts.",
                "",
                "## Assumptions",
                "The supplied repository state and persistent project memory are authoritative. No unreported code or test result is assumed.",
                "",
                "## Verification",
                "Run typecheck, build, deterministic integration tests, restart the runtime, and verify mission, execution, evaluation and continuation identifiers.",
                ...(evidenceId
                  ? [
                      "",
                      `EVIDENCE: ${evidenceId}`,
                      "CAPABILITY_RESULT: PASS",
                    ]
                  : []),
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
        const created = await runtime.createMission(autonomousRequest(1));

        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "integration-test");
        await runtime.setAutonomyEnabled(true);

        await waitFor(() => {
          const missions = autonomousMissions(runtime);

          if (missions.some((mission) => mission.status === "failed")) {
            const detail = JSON.stringify(
              missions.map((mission) => ({
                status: mission.status,
                error: mission.lastError,
              })),
            );
            throw new Error(`Learning exercise setup failed: ${detail}`);
          }

          return (
            missions.length === 2 &&
            missions[0].status === "succeeded" &&
            missions[1].status === "awaiting_approval"
          );
        });

        assert.equal(providerCalls, 1);
        const awaitingSummary = runtime.autonomySummary();
        assert.ok(awaitingSummary.pendingApprovals > 0);
        assert.match(
          awaitingSummary.pauseReason ?? "",
          /approval|cooldown/i,
        );

        const learningMission = autonomousMissions(runtime)[1];
        const learningApproval = runtime
          .listApprovals("pending")
          .find((approval) => approval.missionId === learningMission.id);

        assert.ok(learningApproval);
        await runtime.approveApproval(
          learningApproval.id,
          "integration-test",
        );

        await waitFor(() => {
          const missions = autonomousMissions(runtime);

          return (
            missions.length === 2 &&
            (missions[1].status === "succeeded" ||
              missions[1].status === "failed")
          );
        });

        await waitFor(() => {
          const summary = runtime.autonomySummary();

          return (
            summary.loopPaused &&
            summary.pauseRequiresResume &&
            /learning exercise/i.test(summary.pauseReason ?? "")
          );
        });

        const missionCountAfterPause = autonomousMissions(runtime).length;
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(autonomousMissions(runtime).length, missionCountAfterPause);
        const providerCallsBeforeResume = providerCalls;

        runtime.resumeAutonomy();

        await waitFor(
          () => runtime.autonomySummary().pauseRequiresResume === false,
        );

        assert.equal(providerCalls, providerCallsBeforeResume);
        assert.equal(runtime.autonomySummary().pauseRequiresResume, false);

        await runtime.stop();
      });
    },
  );

  await t.test(
    "accepts proof mission only with concrete execution evidence",
    async () => {
      await withEnvironment(async () => {
        const connector: AiProviderConnector = {
          id: "openai-responses",
          async execute() {
            return Object.freeze({
              providerResponseId: "proof-response-1",
              outputText: [
                "# Proof execution summary",
                "Assumptions: the runtime action runner executed file write/read/hash in the mission sandbox.",
                "Verification guidance: inspect execution evidence and compare the persisted hash with the stored file content.",
                "CAPABILITY_RESULT: PASS",
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
          workspaceVerificationRunner: successfulWorkspaceRunner,
          missionLoopPollIntervalMs: 100,
        });

        try {
          await runtime.start();

          const created = await runtime.createMission(proofRequest());
          assert.ok(created.approval);
          await runtime.approveApproval(created.approval.id, "integration-test");

          await waitFor(() => {
            const mission = runtime.getMission(created.mission.id);
            return mission?.status === "succeeded";
          });

          const mission = runtime.getMission(created.mission.id);
          assert.equal(mission?.status, "succeeded");
          const evidence = mission?.output
            ?.executionEvidence as {
            receipts?: readonly unknown[];
            artifacts?: readonly { readonly kind?: unknown; readonly path?: unknown; readonly sha256?: unknown }[];
          } | undefined;
          assert.ok(evidence);
          assert.ok((evidence?.receipts?.length ?? 0) > 0);
          assert.ok((evidence?.artifacts?.length ?? 0) > 0);
          assert.equal(evidence?.artifacts?.[0]?.kind, "file-hash-proof");
          assert.match(String(evidence?.artifacts?.[0]?.path ?? ""), /forge-proof\.txt/i);
          assert.match(String(evidence?.artifacts?.[0]?.sha256 ?? ""), /^[a-f0-9]{64}$/);
        } finally {
          await runtime.stop();
        }
      });
    },
  );

  await t.test(
    "blocks build objective when provider route falls back to manual-fallback",
    async () => {
      await withEnvironment(async () => {
        delete process.env.FORGE_AI_PROVIDER;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_MODEL;
        delete process.env.FORGE_LOCAL_MODEL_ENABLED;

        const runtime = new ForgeRuntime({
          workspaceVerificationRunner: successfulWorkspaceRunner,
          missionLoopPollIntervalMs: 100,
        });

        try {
          await runtime.start();

          const created = await runtime.createMission(proofRequest());
          assert.ok(created.approval);
          await runtime.approveApproval(created.approval.id, "integration-test");

          await waitFor(() => {
            const mission = runtime.getMission(created.mission.id);
            return mission?.status === "failed";
          });

          const mission = runtime.getMission(created.mission.id);
          assert.equal(mission?.status, "failed");
          assert.equal(
            (mission?.output?.missionResult as { status?: unknown } | undefined)?.status,
            "blocked",
            JSON.stringify({
              lastError: mission?.lastError,
              missionResult: mission?.output?.missionResult,
            }),
          );
          assert.match(mission?.lastError ?? "", /manual-fallback/i);
        } finally {
          await runtime.stop();
        }
      });
    },
  );

  await t.test(
    "routes generic build through plan, approval, executor, and evaluator",
    async () => {
      await withEnvironment(async () => {
        const root = await createWorkspaceRepository();
        process.env.FORGE_WORKSPACE_ROOT = root;
        const liveObjective = [
          "Maak uitsluitend één nieuw testbestand aan:",
          "",
          "Pad: sandbox/mirror-generic-build-proof-10.txt",
          "",
          "Exacte inhoud: Forge generic-build live approval proof",
          "Datum: 2026-07-30",
          "Doel: tweede workspace approval en echte execution evidence aantonen",
          "",
          "Wijzig geen enkel ander bestand.",
          "Gebruik dit exacte pad als expliciet target met allowCreate=true.",
          "Voer typecheck uit als verificatie.",
          "Niet pushen.",
        ].join("\n");
        let providerCalls = 0;
        const connector: AiProviderConnector = {
          id: "openai-responses",
          async execute() {
            providerCalls += 1;
            return Object.freeze({
              providerResponseId: "generic-build-plan",
              outputText: JSON.stringify({
                schemaVersion: 1,
                summary:
                  "Assumptions: the approved target is a new sandbox file and no other repository content may change. Verification guidance: run the required typecheck and inspect the committed file, recorded hashes, action receipts, file effects, verification runs, and artifact evidence before accepting the result.",
                changes: [{
                  path: "sandbox/mirror-generic-build-proof-10.txt",
                  expectedSha256: null,
                  content: "Forge generic-build live approval proof\n",
                }],
                verification: ["typecheck"],
                commit: {
                  message: "test: generic build workspace execution",
                  push: false,
                },
              }),
              usage: Object.freeze({
                inputTokens: 20,
                outputTokens: 30,
                totalTokens: 50,
              }),
            });
          },
        };
        const runtime = new ForgeRuntime({
          aiProviderConnectors: [connector],
          workspaceVerificationRunner: successfulWorkspaceRunner,
          missionLoopPollIntervalMs: 100,
        });

        try {
          await runtime.start();
          const created = await runtime.createMission({
            kind: "operator.autonomous-cycle",
            title: "Governed generic sandbox build",
            input: {
              projectId: "forge-core",
              objective: liveObjective,
              proofTargetPath: "mirror-generic-build-proof-10.txt",
              cycleIndex: 1,
              maxCycles: 1,
              files: [],
            },
          });
          assert.ok(created.approval);
          assert.equal(created.mission.input.rawObjective, liveObjective);
          assert.deepEqual(created.mission.input.targets, [{
            path: "sandbox/mirror-generic-build-proof-10.txt",
            allowCreate: true,
          }]);
          assert.equal(
            created.mission.input.objectiveExecutionMode,
            "build-or-mutate",
          );
          assert.equal(created.mission.input.objectiveProfile, "generic-build");
          assert.equal(
            created.mission.input.proofTargetPath,
            "sandbox/mirror-generic-build-proof-10.txt",
          );
          await runtime.approveApproval(created.approval.id, "integration-test");

          await waitFor(
            () => runtime.getMission(created.mission.id)?.status === "succeeded",
          );

          const planningMission = runtime.getMission(created.mission.id);
          const executionMissionId = String(
            planningMission?.output?.workspaceExecutionMissionId ?? "",
          );
          const executionApprovalId = String(
            planningMission?.output?.workspaceExecutionApprovalId ?? "",
          );
          assert.equal(providerCalls, 1);
          assert.ok(executionMissionId);
          assert.ok(executionApprovalId);
          assert.equal(planningMission?.output?.executionEvidence, null);
          assert.equal(
            runtime.getMission(executionMissionId)?.status,
            "awaiting_approval",
          );
          assert.equal(
            runtime.getMission(executionMissionId)?.input.sourceAutonomousMissionId,
            created.mission.id,
          );
          assert.equal(runtime.getMission(executionMissionId)?.output, null);
          assert.ok(
            runtime.listApprovals("pending").some(
              (approval) =>
                approval.id === executionApprovalId &&
                approval.missionId === executionMissionId,
            ),
          );
          await assert.rejects(readFile(
            path.join(root, "sandbox", "mirror-generic-build-proof-10.txt"),
            "utf8",
          ));
          assertNoExecutionEvidence(
            runtime.listMissions().map((candidate) => candidate.output),
          );
          assertNoExecutionEvidence(
            runtime.snapshot().events.map((event) => event.payload),
          );
          assert.equal(
            runtime.snapshot().events.some(
              (event) =>
                event.type === "autonomous.cycle.evaluated" ||
                event.type.startsWith("workspace.execution."),
            ),
            false,
          );

          for (const memory of runtime.listProjectMemories(
            "forge-core",
            "evidence",
          )) {
            assertNoExecutionEvidence(JSON.parse(memory.content));
          }

          await runtime.approveApproval(executionApprovalId, "integration-test");
          await waitFor(
            () => runtime.getMission(executionMissionId)?.status === "succeeded",
          );

          const executionMission = runtime.getMission(executionMissionId);
          const evaluation = executionMission?.output?.evaluation as
            | { readonly score?: unknown; readonly decision?: unknown }
            | undefined;
          const evidence = executionMission?.output?.executionEvidence as
            | {
                readonly receipts?: readonly unknown[];
                readonly fileEffects?: readonly unknown[];
                readonly verificationRuns?: readonly unknown[];
                readonly artifacts?: readonly unknown[];
              }
            | undefined;

          assert.equal(
            await readFile(
              path.join(root, "sandbox", "mirror-generic-build-proof-10.txt"),
              "utf8",
            ),
            "Forge generic-build live approval proof\n",
          );
          assert.equal(evaluation?.score, 100);
          assert.equal(evaluation?.decision, "accepted");
          assert.ok((evidence?.receipts?.length ?? 0) > 0);
          assert.ok((evidence?.fileEffects?.length ?? 0) > 0);
          assert.ok((evidence?.verificationRuns?.length ?? 0) > 0);
          assert.ok((evidence?.artifacts?.length ?? 0) > 0);
          assert.equal(providerCalls, 1);
          await runtime.stop();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    },
  );

  await t.test(
    "blocks generic build without targets before provider execution",
    async () => {
      await withEnvironment(async () => {
        let providerCalls = 0;
        const connector: AiProviderConnector = {
          id: "openai-responses",
          async execute() {
            providerCalls += 1;
            throw new Error("Provider must not execute without targets");
          },
        };
        const runtime = new ForgeRuntime({
          aiProviderConnectors: [connector],
          missionLoopPollIntervalMs: 100,
        });

        await runtime.start();
        const created = await runtime.createMission({
          kind: "operator.autonomous-cycle",
          title: "Targetless generic build",
          input: {
            projectId: "forge-core",
            objective: "Bouw een nieuwe generieke runtimefunctie.",
            cycleIndex: 1,
            maxCycles: 1,
            files: [],
          },
        });
        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "integration-test");
        await waitFor(
          () => runtime.getMission(created.mission.id)?.status === "failed",
        );

        const mission = runtime.getMission(created.mission.id);
        assert.equal(providerCalls, 0);
        assert.equal(
          (mission?.output?.missionResult as { status?: unknown } | undefined)
            ?.status,
          "blocked",
        );
        assert.match(mission?.lastError ?? "", /validated target files/i);
        await runtime.stop();
      });
    },
  );

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

      const missions = autonomousMissions(runtime);
      assert.equal(missions.length, 1);
      assert.ok(missions[0].output);
      assert.equal(
        (missions[0].output?.missionResult as { status?: unknown } | undefined)
          ?.status,
        "rejected",
      );
      assert.equal(runtime.listAiExecutions().length, 1);
      assert.equal(runtime.listAiExecutions()[0].status, "failed");
      assert.equal(runtime.snapshot().kernel.status, "running");

      await runtime.stop();
    });
  });

  await t.test("persists rejected mission output when evaluation rejects", async () => {
    await withEnvironment(async () => {
      const connector: AiProviderConnector = {
        id: "openai-responses",
        async execute() {
          return Object.freeze({
            providerResponseId: "response-rejected",
            outputText: "",
            usage: Object.freeze({
              inputTokens: 5,
              outputTokens: 0,
              totalTokens: 5,
            }),
          });
        },
      };

      const runtime = new ForgeRuntime({
        aiProviderConnectors: [connector],
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission(autonomousRequest(1));
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "integration-test");

      await waitFor(() => {
        const missions = autonomousMissions(runtime);
        return missions.length === 1 && missions[0].status === "failed";
      });

      const mission = autonomousMissions(runtime)[0];
      assert.ok(mission.output);
      const missionResult = mission.output?.missionResult as {
        status?: unknown;
        cause?: unknown;
      };
      assert.equal(missionResult.status, "rejected");
      assert.equal(missionResult.cause, "evaluation");
      assert.equal(
        (mission.output?.evaluation as { decision?: unknown } | undefined)
          ?.decision,
        "rejected",
      );

      await runtime.stop();
    });
  });

  await t.test("uses manual fallback when local model is not explicitly enabled", async () => {
    await withEnvironment(async () => {
      delete process.env.FORGE_AI_PROVIDER;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_MODEL;
      delete process.env.FORGE_LOCAL_MODEL_ENABLED;

      const runtime = new ForgeRuntime({
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();

      const created = await runtime.createMission(autonomousRequest(1));
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "integration-test");

      await waitFor(() => {
        const mission = runtime.getMission(created.mission.id);
        return mission?.status === "succeeded";
      });

      const mission = runtime.getMission(created.mission.id);
      assert.equal(mission?.status, "succeeded");
      assert.equal(
        (mission?.output?.evaluation as { score?: unknown } | undefined)?.score,
        100,
      );

      const execution = runtime
        .listAiExecutions()
        .find((item) => item.missionId === created.mission.id);

      assert.ok(execution);
      assert.equal(execution?.providerId, "manual-fallback");
      assert.equal(execution?.status, "succeeded");

      await runtime.stop();
    });
  });
});
