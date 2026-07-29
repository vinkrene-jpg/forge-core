import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ForgeRuntime,
  parseWorkspaceProviderPlan,
  type AiProviderConnector,
} from "./index.js";
import type { WorkspaceChangeExecutor } from "./workspace-bridge.js";
import type { WorkspaceExecutionResult } from "./workspace-executor.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildExecutionResult(input: {
  missionId: string;
  path: string;
  beforeSha: string;
  afterSha: string;
}): WorkspaceExecutionResult {
  const now = new Date().toISOString();

  return Object.freeze({
    id: "workspace-plan-execution",
    missionId: input.missionId,
    status: "verified",
    branch: "planner-test",
    changedFiles: Object.freeze([
      Object.freeze({
        path: input.path,
        beforeSha256: input.beforeSha,
        afterSha256: input.afterSha,
      }),
    ]),
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
      Object.freeze({
        command: "pnpm run test",
        exitCode: 0,
        stdoutChars: 2,
        stderrChars: 0,
        stdoutSha256: sha256("ok"),
        stderrSha256: sha256(""),
        durationMs: 1,
      }),
    ]),
    rollbackPerformed: false,
    commitSha: null,
    error: null,
    startedAt: now,
    completedAt: now,
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for workspace plan mission");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("provider workspace planner", { concurrency: false }, async (t) => {
  await t.test("uses one provider call and requires separate execution approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forge-planner-root-"));
    const storage = await mkdtemp(path.join(os.tmpdir(), "forge-planner-state-"));
    const source = "before\n";
    await writeFile(path.join(root, "sample.txt"), source, "utf8");

    const original = new Map([
      ["STORAGE_DIR", process.env.STORAGE_DIR],
      ["FORGE_WORKSPACE_ROOT", process.env.FORGE_WORKSPACE_ROOT],
      ["FORGE_AI_PROVIDER", process.env.FORGE_AI_PROVIDER],
      ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
      ["OPENAI_MODEL", process.env.OPENAI_MODEL],
    ]);
    process.env.STORAGE_DIR = storage;
    process.env.FORGE_WORKSPACE_ROOT = root;
    process.env.FORGE_AI_PROVIDER = "openai-responses";
    process.env.OPENAI_API_KEY = "test-only-provider-key";
    process.env.OPENAI_MODEL = "test-model";
    let providerCalls = 0;

    const connector: AiProviderConnector = {
      id: "openai-responses",
      async execute() {
        providerCalls += 1;
        return Object.freeze({
          providerResponseId: "workspace-plan-response",
          outputText: JSON.stringify({
            schemaVersion: 1,
            summary: "Update the approved sample",
            changes: [{
              path: "sample.txt",
              expectedSha256: sha256(source),
              content: "after\n",
            }],
            verification: ["typecheck", "test"],
            commit: {
              message: "test: provider planned change",
              push: false,
            },
          }),
          usage: Object.freeze({
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
          }),
        });
      },
    };
    const stubExecutor: WorkspaceChangeExecutor = {
      async execute(rootPath, missionId, request) {
        const change = request.changes.find((candidate) => candidate.path === "sample.txt");
        const nextContent = change?.content ?? source;
        await writeFile(path.join(rootPath, "sample.txt"), nextContent, "utf8");

        return buildExecutionResult({
          missionId,
          path: "sample.txt",
          beforeSha: sha256(source),
          afterSha: sha256(nextContent),
        });
      },
    };
    const runtime = new ForgeRuntime({
      aiProviderConnectors: [connector],
      workspaceChangeExecutor: stubExecutor,
      missionLoopPollIntervalMs: 100,
    });

    try {
      await runtime.start();
      const created = await runtime.createMission({
        kind: "operator.workspace-plan",
        title: "Plan one bounded source change",
        input: {
          projectId: "forge-core",
          objective: "Change the sample only.",
          targets: [{ path: "sample.txt" }],
        },
      });

      assert.equal(created.mission.status, "awaiting_approval");
      assert.ok(created.approval);
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), source);

      await runtime.approveApproval(created.approval.id, "planner-test");
      await waitFor(
        () => runtime.getMission(created.mission.id)?.status === "succeeded",
      );

      assert.equal(providerCalls, 1);
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), source);

      const scheduled = await runtime.scheduleWorkspacePlan(created.mission.id);
      assert.equal(scheduled.executionMission.mission.status, "awaiting_approval");
      assert.ok(scheduled.executionMission.approval);
      assert.equal(scheduled.plan.request.commit?.push, false);
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), source);
      assert.ok(
        runtime.snapshot().events.some(
          (event) => event.type === "workspace.plan.scheduled",
        ),
      );
      await runtime.approveApproval(
        scheduled.executionMission.approval.id,
        "planner-test",
      );
      await waitFor(
        () =>
          runtime.getMission(scheduled.executionMission.mission.id)?.status ===
          "succeeded",
      );

      const executed = runtime.getMission(scheduled.executionMission.mission.id);
      assert.equal(executed?.status, "succeeded");
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), "after\n");
      const executionEvidence = executed?.output?.executionEvidence as
        | {
            receipts?: readonly unknown[];
            fileEffects?: readonly unknown[];
            verificationRuns?: readonly unknown[];
            artifacts?: readonly unknown[];
          }
        | undefined;
      assert.ok((executionEvidence?.receipts?.length ?? 0) > 0);
      assert.ok((executionEvidence?.fileEffects?.length ?? 0) > 0);
      assert.ok((executionEvidence?.verificationRuns?.length ?? 0) > 0);
      assert.ok((executionEvidence?.artifacts?.length ?? 0) > 0);
      await runtime.stop();
    } finally {
      for (const [key, value] of original) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      await rm(root, { recursive: true, force: true });
      await rm(storage, { recursive: true, force: true });
    }
  });

  await t.test("rejects unapproved paths and changed source hashes", () => {
    const target = {
      path: "sample.txt",
      expectedSha256: sha256("before\n"),
      exists: true,
    } as const;
    const base = {
      missionId: "plan-mission",
      projectId: "forge-core",
      objective: "Bounded change",
      targets: [target],
      compositionId: "composition",
      executionId: "execution",
    } as const;

    assert.throws(() => parseWorkspaceProviderPlan({
      ...base,
      outputText: JSON.stringify({
        schemaVersion: 1,
        summary: "Escape target",
        changes: [{ path: "other.txt", expectedSha256: null, content: "x" }],
        verification: ["typecheck"],
        commit: { message: "test: rejected path", push: false },
      }),
    }), /unapproved target path/);

    assert.throws(() => parseWorkspaceProviderPlan({
      ...base,
      outputText: JSON.stringify({
        schemaVersion: 1,
        summary: "Ignore precondition",
        changes: [{ path: "sample.txt", expectedSha256: null, content: "x" }],
        verification: ["typecheck"],
        commit: { message: "test: rejected hash", push: false },
      }),
    }), /changed the source precondition/);
  });
});
