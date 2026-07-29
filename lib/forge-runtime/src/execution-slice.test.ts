import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ForgeRuntime,
  type AiProviderConnector,
  type ForgeRuntimeOptions,
} from "./index.js";
import type { WorkspaceChangeExecutor } from "./workspace-bridge";
import type { WorkspaceExecutionResult } from "./workspace-executor";

const environmentKeys = [
  "STORAGE_DIR",
  "FORGE_WORKSPACE_ROOT",
  "FORGE_AI_PROVIDER",
  "FORGE_LOCAL_MODEL_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "FORGE_AUTONOMY_ENABLED",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for execution slice result");
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
    path.join(os.tmpdir(), "forge-execution-slice-"),
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

    await rm(storageRoot, { recursive: true, force: true });
  }
}

function proofRequest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "operator.autonomous-cycle" as const,
    title: "Execution slice proof mission",
    input: {
      projectId: "forge-core",
      objective:
        "Maak forge-proof.txt, lees het bestand terug en rapporteer de SHA-256 hash.",
      cycleIndex: 1,
      maxCycles: 1,
      files: [],
      ...overrides,
    },
  };
}

function successfulConnector(): AiProviderConnector {
  return {
    id: "openai-responses",
    async execute() {
      return Object.freeze({
        providerResponseId: "execution-slice-provider",
        outputText: [
          "# Workspace execution evidence",
          "## Assumptions",
          "The proof workspace and persisted mission evidence are authoritative.",
          "## Verification",
          "Confirm file path, exact content, SHA-256, execution log and verification result before acceptance.",
        ].join("\n"),
        usage: Object.freeze({
          inputTokens: 120,
          outputTokens: 80,
          totalTokens: 200,
        }),
      });
    },
  };
}

function buildExecutionResult(input: {
  missionId: string;
  path: string;
  afterSha: string;
  verification: WorkspaceExecutionResult["verification"];
}): WorkspaceExecutionResult {
  const timestamp = new Date().toISOString();

  return Object.freeze({
    id: "execution-slice-stub",
    missionId: input.missionId,
    status: "verified",
    branch: "proof-execution",
    changedFiles: Object.freeze([
      Object.freeze({
        path: input.path,
        beforeSha256: null,
        afterSha256: input.afterSha,
      }),
    ]),
    verification: input.verification,
    rollbackPerformed: false,
    commitSha: null,
    error: null,
    startedAt: timestamp,
    completedAt: timestamp,
  });
}

test("execution slice", { concurrency: false }, async (t) => {
  await t.test(
    "real WorkspaceExecutor proof run stores full evidence and completes",
    async () => {
      await withEnvironment(async () => {
        const runtime = new ForgeRuntime({
          aiProviderConnectors: [successfulConnector()],
          missionLoopPollIntervalMs: 100,
        });

        await runtime.start();

        const created = await runtime.createMission(proofRequest());
        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "execution-slice");

        await waitFor(() => {
          const mission = runtime.getMission(created.mission.id);
          return mission?.status === "succeeded";
        });

        const mission = runtime.getMission(created.mission.id);
        assert.equal(mission?.status, "succeeded");
        assert.equal(
          (mission?.output?.missionResult as { status?: unknown } | undefined)
            ?.status,
          "completed",
        );

        const proofPath = String(mission?.output?.proofFilePath ?? "");
        const proofContent = String(mission?.output?.proofContent ?? "");
        const proofHash = String(mission?.output?.proofSha256 ?? "");
        const executionEvidence = mission?.output
          ?.executionEvidence as {
          receipts?: readonly { readonly ok?: boolean; readonly action?: string }[];
          verificationRuns?: readonly { readonly exitCode?: number }[];
          artifacts?: readonly { readonly path?: string; readonly content?: string; readonly sha256?: string }[];
        } | undefined;

        assert.ok(proofPath.length > 0);
        assert.ok(proofContent.length > 0);
        assert.match(proofHash, /^[a-f0-9]{64}$/);
        assert.equal(proofHash, sha256(proofContent));
        assert.ok((executionEvidence?.verificationRuns?.length ?? 0) > 0);
        assert.ok(
          executionEvidence?.verificationRuns?.every(
            (verification) => verification.exitCode === 0,
          ),
        );
        assert.ok((executionEvidence?.receipts?.length ?? 0) >= 4);
        assert.ok(
          executionEvidence?.receipts?.every((receipt) => receipt.ok === true),
        );
        assert.equal(executionEvidence?.artifacts?.[0]?.path, proofPath);
        assert.equal(executionEvidence?.artifacts?.[0]?.content, proofContent);
        assert.equal(executionEvidence?.artifacts?.[0]?.sha256, proofHash);

        const evidenceId = String(mission?.output?.evidenceMemoryId ?? "");
        assert.match(evidenceId, /^[a-f0-9-]{36}$/);
        assert.ok(
          runtime
            .listProjectMemories("forge-core", "evidence")
            .some((memory) => memory.id === evidenceId),
        );

        await runtime.stop();
      });
    },
  );

  await t.test("manual fallback without file is not completed", async () => {
    await withEnvironment(async () => {
      delete process.env.FORGE_AI_PROVIDER;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_MODEL;
      delete process.env.FORGE_LOCAL_MODEL_ENABLED;

      const runtime = new ForgeRuntime({
        missionLoopPollIntervalMs: 100,
      });
      await runtime.start();

      const created = await runtime.createMission({
        kind: "operator.autonomous-cycle",
        title: "Manual fallback without proof file",
        input: {
          projectId: "forge-core",
          objective: "Create a small build artifact and summarize it.",
          cycleIndex: 1,
          maxCycles: 1,
          files: [],
        },
      });

      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "execution-slice");

      await waitFor(() => runtime.getMission(created.mission.id)?.status === "failed");

      const mission = runtime.getMission(created.mission.id);
      assert.equal(mission?.status, "failed");
      assert.notEqual(
        (mission?.output?.missionResult as { status?: unknown } | undefined)
          ?.status,
        "completed",
      );
      assert.equal(mission?.output?.proofFilePath, undefined);

      await runtime.stop();
    });
  });

  await t.test("missing hash gate prevents completed", async () => {
    await withEnvironment(async () => {
      const stubExecutor: WorkspaceChangeExecutor = {
        async execute(rootPath, missionId, request) {
          const proof = request.changes.find((change) => change.path === "forge-proof.txt");
          const content = proof?.content ?? "";
          await mkdir(rootPath, { recursive: true });
          await writeFile(path.join(rootPath, "forge-proof.txt"), content, "utf8");

          return buildExecutionResult({
            missionId,
            path: "forge-proof.txt",
            afterSha: "",
            verification: Object.freeze([
              Object.freeze({
                command: "pnpm run typecheck",
                exitCode: 0,
                stdoutChars: 1,
                stderrChars: 0,
                stdoutSha256: sha256("ok"),
                stderrSha256: sha256(""),
                durationMs: 1,
              }),
            ]),
          });
        },
      };

      const runtime = new ForgeRuntime({
        aiProviderConnectors: [successfulConnector()],
        workspaceChangeExecutor: stubExecutor,
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission(proofRequest());
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "execution-slice");

      await waitFor(() => runtime.getMission(created.mission.id)?.status === "failed");

      const mission = runtime.getMission(created.mission.id);
      assert.equal(mission?.status, "failed");
      assert.notEqual(
        (mission?.output?.missionResult as { status?: unknown } | undefined)
          ?.status,
        "completed",
      );
      assert.ok(
        Array.isArray((mission?.output as { missingGates?: unknown } | undefined)?.missingGates),
      );
      assert.ok(
        ((mission?.output as { missingGates?: string[] } | undefined)
          ?.missingGates ?? []).includes("sha256"),
      );

      await runtime.stop();
    });
  });

  await t.test("missing verification gate prevents completed", async () => {
    await withEnvironment(async () => {
      const stubExecutor: WorkspaceChangeExecutor = {
        async execute(rootPath, missionId, request) {
          const proof = request.changes.find((change) => change.path === "forge-proof.txt");
          const content = proof?.content ?? "";
          await mkdir(rootPath, { recursive: true });
          await writeFile(path.join(rootPath, "forge-proof.txt"), content, "utf8");

          return buildExecutionResult({
            missionId,
            path: "forge-proof.txt",
            afterSha: sha256(content),
            verification: Object.freeze([]),
          });
        },
      };

      const runtime = new ForgeRuntime({
        aiProviderConnectors: [successfulConnector()],
        workspaceChangeExecutor: stubExecutor,
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission(proofRequest());
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "execution-slice");

      await waitFor(() => runtime.getMission(created.mission.id)?.status === "failed");

      const mission = runtime.getMission(created.mission.id);
      assert.equal(mission?.status, "failed");
      assert.notEqual(
        (mission?.output?.missionResult as { status?: unknown } | undefined)
          ?.status,
        "completed",
      );
      assert.ok(
        ((mission?.output as { missingGates?: string[] } | undefined)
          ?.missingGates ?? []).includes("verification-result"),
      );

      await runtime.stop();
    });
  });

  await t.test("protected path is blocked", async () => {
    await withEnvironment(async () => {
      const runtime = new ForgeRuntime({
        aiProviderConnectors: [successfulConnector()],
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission(
        proofRequest({ proofTargetPath: ".env" }),
      );
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "execution-slice");

      await waitFor(() => runtime.getMission(created.mission.id)?.status === "failed");

      const mission = runtime.getMission(created.mission.id);
      assert.equal(mission?.status, "failed");
      assert.equal(
        (mission?.output?.missionResult as { status?: unknown; cause?: unknown } | undefined)
          ?.status,
        "blocked",
      );
      assert.equal(
        (mission?.output?.missionResult as { status?: unknown; cause?: unknown } | undefined)
          ?.cause,
        "protected-path",
      );

      await runtime.stop();
    });
  });

  await t.test(
    "generic-build without targets is blocked before provider invocation",
    async () => {
      await withEnvironment(async () => {
        const runtime = new ForgeRuntime({
          aiProviderConnectors: [successfulConnector()],
          missionLoopPollIntervalMs: 100,
        });

        await runtime.start();
        const created = await runtime.createMission({
          kind: "operator.autonomous-cycle" as const,
          title: "Generic build without targets",
          input: {
            projectId: "forge-core",
            objective: "Create a TypeScript module with version export",
            cycleIndex: 1,
            maxCycles: 1,
            files: [],
            // no targets → must block before provider invocation
          },
        });
        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "execution-slice");

        await waitFor(
          () => runtime.getMission(created.mission.id)?.status === "failed",
        );

        const mission = runtime.getMission(created.mission.id);
        assert.equal(mission?.status, "failed");
        assert.equal(
          (
            mission?.output?.missionResult as
              | { status?: unknown; cause?: unknown }
              | undefined
          )?.status,
          "blocked",
        );
        assert.equal(
          (
            mission?.output?.missionResult as
              | { status?: unknown; cause?: unknown }
              | undefined
          )?.cause,
          "missing-targets",
        );

        await runtime.stop();
      });
    },
  );

  await t.test(
    "generic-build with protected target path is blocked",
    async () => {
      await withEnvironment(async () => {
        const runtime = new ForgeRuntime({
          aiProviderConnectors: [successfulConnector()],
          missionLoopPollIntervalMs: 100,
        });

        await runtime.start();
        const created = await runtime.createMission({
          kind: "operator.autonomous-cycle" as const,
          title: "Generic build protected path",
          input: {
            projectId: "forge-core",
            objective: "Create a TypeScript module with version export",
            cycleIndex: 1,
            maxCycles: 1,
            files: [],
            targets: [{ path: ".env", allowCreate: false }],
          },
        });
        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "execution-slice");

        await waitFor(
          () => runtime.getMission(created.mission.id)?.status === "failed",
        );

        const mission = runtime.getMission(created.mission.id);
        assert.equal(mission?.status, "failed");
        assert.equal(
          (
            mission?.output?.missionResult as
              | { status?: unknown; cause?: unknown }
              | undefined
          )?.status,
          "blocked",
        );
        assert.equal(
          (
            mission?.output?.missionResult as
              | { status?: unknown; cause?: unknown }
              | undefined
          )?.cause,
          "protected-path",
        );

        await runtime.stop();
      });
    },
  );

  await t.test(
    "generic-build stores full execution evidence and evaluator accepts at 100",
    async () => {
      await withEnvironment(async (storageRoot) => {
        process.env.FORGE_WORKSPACE_ROOT = storageRoot;
        const targetPath = "build-artifact.ts";
        const content =
          "// build artifact\nexport const version = '1.0.0';\n";
        const afterSha = sha256(content);

        let planCallDone = false;
        const buildConnector: AiProviderConnector = {
          id: "openai-responses",
          async execute() {
            if (!planCallDone) {
              planCallDone = true;
              return Object.freeze({
                providerResponseId: "generic-build-plan",
                outputText: JSON.stringify({
                  schemaVersion: 1,
                  summary: "Create a new build artifact module",
                  changes: [
                    {
                      path: targetPath,
                      expectedSha256: null,
                      content,
                    },
                  ],
                  verification: ["typecheck"],
                  commit: { message: "feat: add build artifact", push: false },
                }),
                usage: Object.freeze({
                  inputTokens: 100,
                  outputTokens: 50,
                  totalTokens: 150,
                }),
              });
            }

            return Object.freeze({
              providerResponseId: "generic-build-eval",
              outputText: [
                "# Generic build execution evidence",
                "## Assumptions",
                "The workspace executor wrote the planned build artifact to the target path using the validated workspace change plan.",
                "No pre-existing file was present; the new module was created with the specified content.",
                "## Verification",
                "Typecheck passed with exit code 0; the file was created and its SHA-256 hash was confirmed by the executor.",
              ].join("\n"),
              usage: Object.freeze({
                inputTokens: 120,
                outputTokens: 80,
                totalTokens: 200,
              }),
            });
          },
        };

        const stubExecutor: WorkspaceChangeExecutor = {
          async execute(rootPath, missionId, request) {
            const change = request.changes.find((c) => c.path === targetPath);
            const written = change?.content ?? content;
            await mkdir(rootPath, { recursive: true });
            await writeFile(path.join(rootPath, targetPath), written, "utf8");

            return buildExecutionResult({
              missionId,
              path: targetPath,
              afterSha: afterSha,
              verification: Object.freeze([
                Object.freeze({
                  command: "pnpm run typecheck",
                  exitCode: 0,
                  stdoutChars: 2,
                  stderrChars: 0,
                  stdoutSha256: sha256("ok"),
                  stderrSha256: sha256(""),
                  durationMs: 1,
                }),
              ]),
            });
          },
        };

        const runtime = new ForgeRuntime({
          aiProviderConnectors: [buildConnector],
          workspaceChangeExecutor: stubExecutor,
          missionLoopPollIntervalMs: 100,
        });

        await runtime.start();
        const created = await runtime.createMission({
          kind: "operator.autonomous-cycle" as const,
          title: "Generic build full evidence",
          input: {
            projectId: "forge-core",
            objective: "Create a TypeScript module with version export",
            cycleIndex: 1,
            maxCycles: 1,
            files: [],
            targets: [{ path: targetPath, allowCreate: true }],
          },
        });
        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "execution-slice");

        await waitFor(
          () =>
            runtime.getMission(created.mission.id)?.status === "succeeded",
        );

        const mission = runtime.getMission(created.mission.id);
        assert.equal(mission?.status, "succeeded");
        assert.equal(
          (
            mission?.output?.missionResult as { status?: unknown } | undefined
          )?.status,
          "completed",
        );

        const evidence = mission?.output?.executionEvidence as
          | {
              receipts?: readonly unknown[];
              fileEffects?: readonly unknown[];
              verificationRuns?: readonly unknown[];
              artifacts?: readonly unknown[];
            }
          | undefined;

        assert.ok((evidence?.receipts?.length ?? 0) > 0, "receipts must be non-empty");
        assert.ok(
          (evidence?.fileEffects?.length ?? 0) > 0,
          "fileEffects must be non-empty",
        );
        assert.ok(
          (evidence?.verificationRuns?.length ?? 0) > 0,
          "verificationRuns must be non-empty",
        );
        assert.ok(
          (evidence?.artifacts?.length ?? 0) > 0,
          "artifacts must be non-empty",
        );

        const evaluation = mission?.output?.evaluation as
          | { score?: unknown; decision?: unknown }
          | undefined;
        assert.equal(evaluation?.score, 100, "evaluator score must be 100");
        assert.equal(
          evaluation?.decision,
          "accepted",
          "evaluator must accept",
        );

        await runtime.stop();
      });
    },
  );

  await t.test("restart preserves execution evidence", async () => {
    await withEnvironment(async () => {
      const options: ForgeRuntimeOptions = {
        aiProviderConnectors: [successfulConnector()],
        missionLoopPollIntervalMs: 100,
      };
      const runtime = new ForgeRuntime(options);

      await runtime.start();
      const created = await runtime.createMission(proofRequest());
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "execution-slice");

      await waitFor(() => runtime.getMission(created.mission.id)?.status === "succeeded");

      const before = runtime.getMission(created.mission.id);
      const evidenceId = String(before?.output?.evidenceMemoryId ?? "");
      assert.ok(evidenceId.length > 0);
      assert.ok(before?.output?.executionEvidence);

      await runtime.stop();

      const restarted = new ForgeRuntime(options);
      await restarted.start();

      const after = restarted.getMission(created.mission.id);
      assert.ok(after?.output?.executionEvidence);
      assert.equal(after?.output?.evidenceMemoryId, evidenceId);
      assert.ok(
        restarted
          .listProjectMemories("forge-core", "evidence")
          .some((memory) => memory.id === evidenceId),
      );

      await restarted.stop();
    });
  });
});
