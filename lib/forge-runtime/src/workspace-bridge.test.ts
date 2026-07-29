import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  FileWorkspaceBridgeClient,
  RuntimeEventBus,
  WorkspaceBridgeHost,
  WorkspaceExecutionError,
  parseWorkspaceChangeRequest,
  type WorkspaceVerificationRunner,
} from "./index.js";

const exec = promisify(execFile);
const token = "test-only-workspace-bridge-token-0123456789abcdef";

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: root });
  return result.stdout.trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-bridge-repo-"));
  await git(root, "init", "-b", "test/provider-bridge");
  await git(root, "config", "user.name", "Forge Bridge Test");
  await git(root, "config", "user.email", "forge-bridge@example.invalid");
  await writeFile(path.join(root, "sample.txt"), "before\n", "utf8");
  await git(root, "add", "sample.txt");
  await git(root, "commit", "-m", "bridge baseline");
  return root;
}

function runner(exitCode: number): WorkspaceVerificationRunner {
  return {
    async run(step) {
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

test("authenticated file workspace bridge", { concurrency: false }, async (t) => {
  await t.test("executes and commits through the host boundary", async () => {
    const root = await repository();
    const directory = await mkdtemp(path.join(os.tmpdir(), "forge-bridge-files-"));
    const events = new RuntimeEventBus();
    const host = new WorkspaceBridgeHost({
      directory,
      rootPath: root,
      token,
      events,
      verificationRunner: runner(0),
      pollIntervalMs: 10,
    });

    try {
      await host.start();
      const client = new FileWorkspaceBridgeClient({
        directory,
        token,
        events,
        timeoutMs: 5_000,
      });
      const result = await client.execute(
        "container-root-is-not-used",
        "bridge-mission-success",
        parseWorkspaceChangeRequest({
          changes: [{
            path: "sample.txt",
            expectedSha256: hash("before\n"),
            content: "after\n",
          }],
          verification: ["typecheck"],
          commit: {
            message: "test: bridge self commit",
            push: false,
          },
        }),
        new AbortController().signal,
      );

      assert.equal(result.status, "committed");
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), "after\n");
      assert.equal(await git(root, "status", "--porcelain"), "");
      assert.ok(events.snapshot().some((event) => event.type === "workspace.bridge.requested"));
      assert.ok(events.snapshot().some((event) => event.type === "workspace.bridge.responded"));
    } finally {
      await host.stop();
      await rm(root, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });

  await t.test("returns rollback evidence across the bridge", async () => {
    const root = await repository();
    const directory = await mkdtemp(path.join(os.tmpdir(), "forge-bridge-files-"));
    const events = new RuntimeEventBus();
    const host = new WorkspaceBridgeHost({
      directory,
      rootPath: root,
      token,
      events,
      verificationRunner: runner(1),
      pollIntervalMs: 10,
    });

    try {
      await host.start();
      const client = new FileWorkspaceBridgeClient({
        directory,
        token,
        events,
        timeoutMs: 5_000,
      });

      await assert.rejects(
        client.execute(
          "container-root-is-not-used",
          "bridge-mission-failure",
          parseWorkspaceChangeRequest({
            changes: [{
              path: "sample.txt",
              expectedSha256: hash("before\n"),
              content: "unsafe\n",
            }],
            verification: ["test"],
            commit: null,
          }),
          new AbortController().signal,
        ),
        (error: unknown) => {
          assert.ok(error instanceof WorkspaceExecutionError);
          assert.equal(error.result.status, "rolled_back");
          assert.equal(error.result.rollbackPerformed, true);
          return true;
        },
      );

      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), "before\n");
      assert.equal(await git(root, "status", "--porcelain"), "");
    } finally {
      await host.stop();
      await rm(root, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});
