import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  ForgeRuntime,
  RuntimeEventBus,
  WorkspaceExecutionError,
  WorkspaceExecutor,
  parseWorkspaceChangeRequest,
  type WorkspaceVerificationRunner,
} from "./index.js";

const exec = promisify(execFile);

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: root });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-workspace-executor-"),
  );
  await git(root, "init", "-b", "test/workspace-executor");
  await git(root, "config", "user.name", "Forge Test");
  await git(root, "config", "user.email", "forge-test@example.invalid");
  await mkdir(path.join(root, "sandbox"));
  await writeFile(path.join(root, "sandbox", "sample.txt"), "before\n", "utf8");
  await git(root, "add", "sandbox/sample.txt");
  await git(root, "commit", "-m", "test baseline");
  return root;
}

function runner(
  exitCode: number,
  calls: { step: string; fullRepository: boolean }[] = [],
): WorkspaceVerificationRunner {
  return {
    async run(step, _rootPath, _signal, fullRepository) {
      calls.push({ step, fullRepository });
      return Object.freeze({
        command: `fake ${step}`,
        exitCode,
        stdout: exitCode === 0 ? "passed" : "",
        stderr: exitCode === 0 ? "" : "failed",
        durationMs: 1,
      });
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for workspace mission");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("workspace executor", { concurrency: false }, async (t) => {
  await t.test("verifies and commits a preconditioned change", async () => {
    const root = await createRepository();

    try {
      const events = new RuntimeEventBus();
      const executor = new WorkspaceExecutor({
        events,
        verificationRunner: runner(0),
      });
      const request = parseWorkspaceChangeRequest({
        changes: [
          {
            path: "sandbox/sample.txt",
            expectedSha256: hash("before\n"),
            content: "after\n",
          },
        ],
        verification: ["typecheck", "test"],
        commit: {
          message: "test: verified workspace change",
          push: false,
        },
      });
      const result = await executor.execute(
        root,
        "mission-success",
        request,
        new AbortController().signal,
      );

      assert.equal(result.status, "committed");
      assert.equal(result.rollbackPerformed, false);
      assert.match(result.commitSha ?? "", /^[a-f0-9]{40}$/);
      assert.equal(
        await readFile(path.join(root, "sandbox", "sample.txt"), "utf8"),
        "after\n",
      );
      assert.equal(await git(root, "status", "--porcelain"), "");
      assert.equal(
        await git(root, "log", "-1", "--pretty=%s"),
        "test: verified workspace change",
      );
      assert.ok(
        events
          .snapshot()
          .some((event) => event.type === "workspace.execution.committed"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("rolls back exact content when verification fails", async () => {
    const root = await createRepository();

    try {
      const executor = new WorkspaceExecutor({
        events: new RuntimeEventBus(),
        verificationRunner: runner(1),
      });
      const request = parseWorkspaceChangeRequest({
        changes: [
          {
            path: "sandbox/sample.txt",
            expectedSha256: hash("before\n"),
            content: "unsafe\n",
          },
          {
            path: "sandbox/created.txt",
            expectedSha256: null,
            content: "temporary\n",
          },
        ],
        verification: ["test"],
        commit: null,
      });

      await assert.rejects(
        executor.execute(
          root,
          "mission-failure",
          request,
          new AbortController().signal,
        ),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceExecutionError);
          assert.equal(error.result.status, "rolled_back");
          assert.equal(error.result.rollbackPerformed, true);
          return true;
        },
      );

      assert.equal(
        await readFile(path.join(root, "sandbox", "sample.txt"), "utf8"),
        "before\n",
      );
      assert.equal(await git(root, "status", "--porcelain"), "");
      await assert.rejects(readFile(path.join(root, "sandbox", "created.txt")));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test(
    "runs only after governance approval and persists evidence",
    async () => {
      const root = await createRepository();
      const storage = await mkdtemp(
        path.join(os.tmpdir(), "forge-workspace-state-"),
      );
      const previousStorage = process.env.STORAGE_DIR;
      const previousWorkspace = process.env.FORGE_WORKSPACE_ROOT;
      process.env.STORAGE_DIR = storage;
      process.env.FORGE_WORKSPACE_ROOT = root;

      try {
        const runtime = new ForgeRuntime({
          workspaceVerificationRunner: runner(0),
          missionLoopPollIntervalMs: 100,
        });
        await runtime.start();
        const created = await runtime.createMission({
          kind: "operator.workspace-change",
          title: "Governed deterministic dogfood change",
          input: {
            projectId: "forge-core",
            changes: [
              {
                path: "sandbox/sample.txt",
                expectedSha256: hash("before\n"),
                content: "runtime-after\n",
              },
            ],
            verification: ["typecheck"],
            commit: {
              message: "test: runtime workspace mission",
              push: false,
            },
          },
        });

        assert.equal(created.mission.status, "awaiting_approval");
        assert.equal(created.governance.decision, "require_approval");
        assert.ok(created.approval);
        assert.equal(
          await readFile(path.join(root, "sandbox", "sample.txt"), "utf8"),
          "before\n",
        );

        await runtime.approveApproval(
          created.approval.id,
          "workspace-executor-test",
          "Approve bounded local dogfood change",
        );
        await waitFor(
          () => runtime.getMission(created.mission.id)?.status === "succeeded",
        );

        const mission = runtime.getMission(created.mission.id);
        assert.equal(mission?.output?.status, "committed");
        assert.equal(typeof mission?.output?.evidenceMemoryId, "string");
        assert.equal(
          runtime
            .listProjectMemories("forge-core", "evidence")
            .filter(
              (memory) =>
                memory.source === `workspace-execution:${created.mission.id}`,
            ).length,
          1,
        );
        await runtime.stop();
      } finally {
        if (previousStorage === undefined) {
          delete process.env.STORAGE_DIR;
        } else {
          process.env.STORAGE_DIR = previousStorage;
        }

        if (previousWorkspace === undefined) {
          delete process.env.FORGE_WORKSPACE_ROOT;
        } else {
          process.env.FORGE_WORKSPACE_ROOT = previousWorkspace;
        }

        await rm(root, { recursive: true, force: true });
        await rm(storage, { recursive: true, force: true });
      }
    },
  );

  await t.test("rejects protected and stale changes before mutation", () => {
    assert.throws(
      () =>
        parseWorkspaceChangeRequest({
          changes: [
            { path: ".env", expectedSha256: null, content: "SECRET=x" },
          ],
          verification: ["test"],
          commit: null,
        }),
      /Protected workspace path/,
    );
    assert.throws(
      () =>
        parseWorkspaceChangeRequest({
          changes: [
            {
              path: "GOVERNANCE/CONSTITUTION.md",
              expectedSha256: null,
              content: "changed",
            },
          ],
          verification: ["test"],
          commit: null,
        }),
      /Protected workspace path/,
    );
    assert.throws(
      () =>
        parseWorkspaceChangeRequest({
          changes: [
            { path: "scripts/example.ts", expectedSha256: null, content: "changed" },
          ],
          verification: ["typecheck", "test", "build"],
          commit: null,
        }),
      /must remain inside sandbox\/, lib\/, or artifacts\//,
    );
  });

  await t.test("requires the complete verification suite outside sandbox", () => {
    const change = {
      changes: [
        { path: "lib/example.ts", expectedSha256: null, content: "export {};" },
      ],
      commit: null,
    };
    assert.throws(
      () => parseWorkspaceChangeRequest({ ...change, verification: ["typecheck", "test"] }),
      /require typecheck, test, and build/,
    );
    assert.doesNotThrow(() => parseWorkspaceChangeRequest({
      ...change,
      verification: ["typecheck", "test", "build"],
    }));
  });

  await t.test("commits lib changes only after repository-wide verification", async () => {
    const root = await createRepository();
    const calls: { step: string; fullRepository: boolean }[] = [];
    try {
      const executor = new WorkspaceExecutor({
        events: new RuntimeEventBus(),
        verificationRunner: runner(0, calls),
      });
      const request = parseWorkspaceChangeRequest({
        changes: [{
          path: "lib/example.ts",
          expectedSha256: null,
          content: "export const example = true;\n",
        }],
        verification: ["typecheck", "test", "build"],
        commit: { message: "test: verified lib change", push: false },
      });

      const result = await executor.execute(
        root,
        "mission-lib-success",
        request,
        new AbortController().signal,
      );

      assert.equal(result.status, "committed");
      assert.deepEqual(calls, [
        { step: "typecheck", fullRepository: true },
        { step: "test", fullRepository: true },
        { step: "build", fullRepository: true },
      ]);
      assert.equal(await git(root, "status", "--porcelain"), "");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("rolls back a failed lib verification to a clean worktree", async () => {
    const root = await createRepository();
    const calls: { step: string; fullRepository: boolean }[] = [];
    try {
      const executor = new WorkspaceExecutor({
        events: new RuntimeEventBus(),
        verificationRunner: runner(1, calls),
      });
      const request = parseWorkspaceChangeRequest({
        changes: [{
          path: "lib/broken.ts",
          expectedSha256: null,
          content: "export const broken = ;\n",
        }],
        verification: ["typecheck", "test", "build"],
        commit: { message: "test: rejected lib change", push: false },
      });

      await assert.rejects(
        executor.execute(root, "mission-lib-failure", request, new AbortController().signal),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceExecutionError);
          assert.equal(error.result.status, "rolled_back");
          assert.equal(error.result.rollbackPerformed, true);
          return true;
        },
      );
      assert.deepEqual(calls, [{ step: "typecheck", fullRepository: true }]);
      await assert.rejects(readFile(path.join(root, "lib", "broken.ts")));
      assert.equal(await git(root, "status", "--porcelain"), "");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
