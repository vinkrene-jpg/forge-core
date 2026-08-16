import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ForgeRuntime,
  type AiProviderConnector,
  type ForgeRuntimeOptions,
} from "./index.js";
import type { WorkspaceChangeExecutor } from "./workspace-bridge";
import type {
  WorkspaceExecutionResult,
  WorkspaceVerificationRunner,
} from "./workspace-executor";

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

function isTerminalMissionStatus(status: string | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
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
  run: (scope: {
    readonly createRuntime: (options?: ForgeRuntimeOptions) => ForgeRuntime;
    readonly stopRuntime: (runtime: ForgeRuntime) => Promise<void>;
    readonly storageRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const original = new Map(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const storageRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-execution-slice-"),
  );
  const runtimes: ForgeRuntime[] = [];

  const createRuntime = (options: ForgeRuntimeOptions = {}) => {
    const runtime = new ForgeRuntime(options);
    runtimes.push(runtime);
    return runtime;
  };
  const stopRuntime = async (runtime: ForgeRuntime) => {
    await runtime.stop();
    const index = runtimes.lastIndexOf(runtime);
    if (index >= 0) {
      runtimes.splice(index, 1);
    }
  };

  process.env.STORAGE_DIR = storageRoot;
  process.env.FORGE_WORKSPACE_ROOT = process.cwd();
  process.env.FORGE_AI_PROVIDER = "openai-responses";
  process.env.OPENAI_API_KEY = "test-only-not-a-real-secret";
  process.env.OPENAI_MODEL = "test-model";
  process.env.FORGE_AUTONOMY_ENABLED = "false";

  try {
    await run({ createRuntime, stopRuntime, storageRoot });
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const runtime of runtimes.reverse()) {
      try {
        await runtime.stop();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    for (const key of environmentKeys) {
      const value = original.get(key);

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await rm(storageRoot, { recursive: true, force: true });

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to stop execution-slice runtime instances",
      );
    }
  }
}

function proofRequest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "operator.autonomous-cycle" as const,
    title: "Execution slice proof mission",
    input: {
      projectId: "forge-core",
      objective:
        "Maak sandbox/forge-proof.txt, lees het bestand terug en rapporteer de SHA-256 hash.",
      cycleIndex: 1,
      maxCycles: 1,
      maximumCostUsd: 1,
      maximumDailyCostUsd: 1,
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

function proofVerificationRunner(): WorkspaceVerificationRunner {
  return {
    async run(step, rootPath) {
      const startedAt = Date.now();
      const proofContent = await readFile(
        path.join(rootPath, "sandbox", "forge-proof.txt"),
        "utf8",
      );
      const passed = step === "typecheck" && proofContent.trim().length > 0;

      return Object.freeze({
        command: "isolated proof content verification",
        exitCode: passed ? 0 : 1,
        stdout: passed ? "proof verification ok" : "",
        stderr: passed ? "" : "proof verification failed",
        durationMs: Date.now() - startedAt,
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

test(
  "real WorkspaceExecutor proof run stores full evidence and completes",
  { concurrency: false },
  async () => {
      await withEnvironment(async ({ createRuntime, stopRuntime }) => {
        const runtime = createRuntime({
          aiProviderConnectors: [successfulConnector()],
          workspaceVerificationRunner: proofVerificationRunner(),
          missionLoopPollIntervalMs: 100,
        });

        await runtime.start();

        const created = await runtime.createMission(proofRequest());
        assert.ok(created.approval);
        await runtime.approveApproval(created.approval.id, "execution-slice");

        await waitFor(() =>
          isTerminalMissionStatus(runtime.getMission(created.mission.id)?.status),
        );

        const mission = runtime.getMission(created.mission.id);
        assert.equal(mission?.status, "succeeded", mission?.lastError ?? undefined);
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

        await stopRuntime(runtime);
      });
  },
);

test("manual fallback without file is not completed", { concurrency: false }, async () => {
    await withEnvironment(async ({ createRuntime, stopRuntime }) => {
      delete process.env.FORGE_AI_PROVIDER;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_MODEL;
      delete process.env.FORGE_LOCAL_MODEL_ENABLED;

      const runtime = createRuntime({
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

      await stopRuntime(runtime);
    });
});

test("missing hash gate prevents completed", { concurrency: false }, async () => {
    await withEnvironment(async ({ createRuntime, stopRuntime }) => {
      const stubExecutor: WorkspaceChangeExecutor = {
        async execute(rootPath, missionId, request) {
          const proof = request.changes.find((change) => change.path === "sandbox/forge-proof.txt");
          const content = proof?.content ?? "";
          await mkdir(path.join(rootPath, "sandbox"), { recursive: true });
          await writeFile(path.join(rootPath, "sandbox", "forge-proof.txt"), content, "utf8");

          return buildExecutionResult({
            missionId,
            path: "sandbox/forge-proof.txt",
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

      const runtime = createRuntime({
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

      await stopRuntime(runtime);
    });
});

test("missing verification gate prevents completed", { concurrency: false }, async () => {
    await withEnvironment(async ({ createRuntime, stopRuntime }) => {
      const stubExecutor: WorkspaceChangeExecutor = {
        async execute(rootPath, missionId, request) {
          const proof = request.changes.find((change) => change.path === "sandbox/forge-proof.txt");
          const content = proof?.content ?? "";
          await mkdir(path.join(rootPath, "sandbox"), { recursive: true });
          await writeFile(path.join(rootPath, "sandbox", "forge-proof.txt"), content, "utf8");

          return buildExecutionResult({
            missionId,
            path: "sandbox/forge-proof.txt",
            afterSha: sha256(content),
            verification: Object.freeze([]),
          });
        },
      };

      const runtime = createRuntime({
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

      await stopRuntime(runtime);
    });
});

test("protected path is blocked", { concurrency: false }, async () => {
    await withEnvironment(async ({ createRuntime, stopRuntime }) => {
      const runtime = createRuntime({
        aiProviderConnectors: [successfulConnector()],
        missionLoopPollIntervalMs: 100,
      });

      await runtime.start();
      const created = await runtime.createMission(
        proofRequest({ proofTargetPath: "sandbox/.env" }),
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

      await stopRuntime(runtime);
    });
});

test("restart preserves execution evidence", { concurrency: false }, async () => {
    await withEnvironment(async ({ createRuntime, stopRuntime }) => {
      const options: ForgeRuntimeOptions = {
        aiProviderConnectors: [successfulConnector()],
        workspaceVerificationRunner: proofVerificationRunner(),
        missionLoopPollIntervalMs: 100,
      };
      const runtime = createRuntime(options);

      await runtime.start();
      const created = await runtime.createMission(proofRequest());
      assert.ok(created.approval);
      await runtime.approveApproval(created.approval.id, "execution-slice");

      await waitFor(() =>
        isTerminalMissionStatus(runtime.getMission(created.mission.id)?.status),
      );

      const before = runtime.getMission(created.mission.id);
      assert.equal(before?.status, "succeeded", before?.lastError ?? undefined);
      const evidenceId = String(before?.output?.evidenceMemoryId ?? "");
      assert.ok(evidenceId.length > 0);
      assert.ok(before?.output?.executionEvidence);

      await stopRuntime(runtime);

      const restarted = createRuntime(options);
      await restarted.start();

      const after = restarted.getMission(created.mission.id);
      assert.ok(after?.output?.executionEvidence);
      assert.equal(after?.output?.evidenceMemoryId, evidenceId);
      assert.ok(
        restarted
          .listProjectMemories("forge-core", "evidence")
          .some((memory) => memory.id === evidenceId),
      );

      await stopRuntime(restarted);
    });
});
