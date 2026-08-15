import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ForgeRuntime } from "./index.js";
import {
  NodeWorkspaceVerificationRunner,
  type WorkspaceCommandResult,
  type WorkspaceVerificationRunner,
  type WorkspaceVerificationStep,
} from "./workspace-executor.js";

const exec = promisify(execFile);
const root = (
  await exec("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() })
).stdout.trim();
const storage = await mkdtemp(path.join(os.tmpdir(), "forge-self-mutation-live-"));
const target = "artifacts/self-mutation-live-proof.txt";
const targetPath = path.join(root, target);
const evidencePath = path.join(root, "reconstruction/SELF_MUTATION_VERIFICATION.json");
const previousStorage = process.env.STORAGE_DIR;
const previousWorkspace = process.env.FORGE_WORKSPACE_ROOT;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function git(...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
}

async function waitForTerminalMission(runtime: ForgeRuntime, missionId: string) {
  const startedAt = Date.now();

  while (true) {
    const mission = runtime.getMission(missionId);
    if (
      mission?.status === "succeeded" ||
      mission?.status === "failed" ||
      mission?.status === "cancelled"
    ) {
      return mission;
    }
    if (Date.now() - startedAt > 900_000) {
      throw new Error(`Timed out waiting for workspace mission ${missionId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

class BrokenSuiteVerificationRunner implements WorkspaceVerificationRunner {
  readonly #delegate = new NodeWorkspaceVerificationRunner();

  async run(
    step: WorkspaceVerificationStep,
    rootPath: string,
    signal: AbortSignal,
    fullRepository: boolean,
  ): Promise<WorkspaceCommandResult> {
    if (step !== "test") {
      return this.#delegate.run(step, rootPath, signal, fullRepository);
    }

    const output = "controlled live proof: full test suite failed";
    return Object.freeze({
      command: "pnpm -r --if-present test",
      exitCode: 1,
      stdoutChars: 0,
      stderrChars: output.length,
      stdoutSha256: sha256(""),
      stderrSha256: sha256(output),
      durationMs: 0,
    });
  }
}

process.env.STORAGE_DIR = storage;
process.env.FORGE_WORKSPACE_ROOT = root;

try {
  const sourceCommit = await git("rev-parse", "HEAD");
  const branch = await git("branch", "--show-current");
  if (branch === "main" || branch === "master") {
    throw new Error("Live self-mutation verification requires a non-main branch");
  }
  if (await git("status", "--porcelain")) {
    throw new Error("Live self-mutation verification requires a clean worktree");
  }

  const proofContent = [
    "Forge self-mutation live proof",
    `source=${sourceCommit}`,
    "scope=artifacts/",
    "verification=typecheck,test,build",
    "push=false",
    "",
  ].join("\n");
  const successRuntime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
  await successRuntime.start();

  let successMissionId = "";
  let successApprovalId = "";
  let dogfoodCommit = "";
  let successOutput: Readonly<Record<string, unknown>> = {};
  try {
    const created = await successRuntime.createMission({
      kind: "operator.workspace-change",
      title: "Forge self-mutation live proof",
      input: {
        projectId: "forge-core",
        changes: [{ path: target, expectedSha256: null, content: proofContent }],
        verification: ["typecheck", "test", "build"],
        commit: { message: "test(workspace): prove governed artifacts mutation", push: false },
      },
    });
    if (!created.approval) {
      throw new Error("Self-mutation mission did not request approval");
    }
    successMissionId = created.mission.id;
    successApprovalId = created.approval.id;
    await successRuntime.approveApproval(
      created.approval.id,
      "operator:self-mutation-proof",
      "Approve one bounded artifacts mutation with the complete verification suite",
    );
    const completed = await waitForTerminalMission(successRuntime, created.mission.id);
    if (
      completed.status !== "succeeded" ||
      completed.output?.status !== "committed" ||
      typeof completed.output.commitSha !== "string"
    ) {
      throw new Error(`Self-mutation mission failed: ${completed.lastError}`);
    }
    dogfoodCommit = completed.output.commitSha;
    successOutput = completed.output;
  } finally {
    await successRuntime.stop();
  }

  const acceptedContent = await readFile(targetPath, "utf8");
  const acceptedHead = await git("rev-parse", "HEAD");
  if (acceptedContent !== proofContent || acceptedHead !== dogfoodCommit) {
    throw new Error("Committed self-mutation proof does not match mission evidence");
  }

  const failureRuntime = new ForgeRuntime({
    missionLoopPollIntervalMs: 100,
    workspaceVerificationRunner: new BrokenSuiteVerificationRunner(),
  });
  await failureRuntime.start();

  let rollbackMissionId = "";
  let rollbackApprovalId = "";
  let rollbackOutput: Readonly<Record<string, unknown>> = {};
  try {
    const created = await failureRuntime.createMission({
      kind: "operator.workspace-change",
      title: "Forge self-mutation rollback proof",
      input: {
        projectId: "forge-core",
        changes: [{
          path: target,
          expectedSha256: sha256(acceptedContent),
          content: "This content must be rolled back.\n",
        }],
        verification: ["typecheck", "test", "build"],
        commit: { message: "test(workspace): this commit must not exist", push: false },
      },
    });
    if (!created.approval) {
      throw new Error("Rollback proof mission did not request approval");
    }
    rollbackMissionId = created.mission.id;
    rollbackApprovalId = created.approval.id;
    await failureRuntime.approveApproval(
      created.approval.id,
      "operator:self-mutation-proof",
      "Approve a controlled broken-suite rollback proof",
    );
    const failed = await waitForTerminalMission(failureRuntime, created.mission.id);
    if (failed.status !== "failed") {
      throw new Error(`Rollback proof unexpectedly ended as ${failed.status}`);
    }
    rollbackOutput = failed.output ?? {};
  } finally {
    await failureRuntime.stop();
  }

  const restoredContent = await readFile(targetPath, "utf8");
  const restoredHead = await git("rev-parse", "HEAD");
  const restoredStatus = await git("status", "--porcelain");
  if (
    restoredContent !== acceptedContent ||
    restoredHead !== acceptedHead ||
    restoredStatus !== ""
  ) {
    throw new Error("Broken-suite mission did not restore content, HEAD and worktree exactly");
  }

  await writeFile(evidencePath, `${JSON.stringify({
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    sourceCommit,
    branch,
    target,
    success: {
      missionId: successMissionId,
      approvalId: successApprovalId,
      commit: dogfoodCommit,
      output: successOutput,
    },
    rollback: {
      missionId: rollbackMissionId,
      approvalId: rollbackApprovalId,
      output: rollbackOutput,
      contentRestored: true,
      headRestored: true,
      worktreeClean: true,
    },
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    successMissionId,
    rollbackMissionId,
    dogfoodCommit,
    evidencePath: path.relative(root, evidencePath),
  })}\n`);
} finally {
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
  if (previousWorkspace === undefined) delete process.env.FORGE_WORKSPACE_ROOT;
  else process.env.FORGE_WORKSPACE_ROOT = previousWorkspace;
  await rm(storage, { recursive: true, force: true });
}