import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { RuntimeEventBus } from "./event-bus.js";
import {
  NodeWorkspaceVerificationRunner,
  parseWorkspaceChangeRequest,
  WorkspaceExecutionError,
  WorkspaceExecutor,
  type WorkspaceCommandResult,
  type WorkspaceVerificationRunner,
  type WorkspaceVerificationStep,
} from "./workspace-executor.js";

const exec = promisify(execFile);
const root = (await exec("git", ["rev-parse", "--show-toplevel"])).stdout.trim();
const target = "artifacts/self-mutation-live-proof.txt";
const targetPath = path.join(root, target);
const evidencePath = path.join(root, "reconstruction/SELF_MUTATION_VERIFICATION.json");

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function git(...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
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
    return Object.freeze({
      command: "pnpm -r --if-present test",
      exitCode: 1,
      stdout: "",
      stderr: "controlled live proof: full test suite failed",
      durationMs: 0,
    });
  }
}

if (await git("status", "--porcelain")) {
  throw new Error("Live rollback proof requires a clean worktree");
}
const acceptedContent = await readFile(targetPath, "utf8");
const acceptedHead = await git("rev-parse", "HEAD");
const successCommit = await git("log", "-1", "--format=%H", "--", target);
const executor = new WorkspaceExecutor({
  events: new RuntimeEventBus(),
  verificationRunner: new BrokenSuiteVerificationRunner(),
});
let rollback;
try {
  await executor.execute(
    root,
    randomUUID(),
    parseWorkspaceChangeRequest({
      changes: [{
        path: target,
        expectedSha256: sha256(acceptedContent),
        content: "This content must be rolled back.\n",
      }],
      verification: ["typecheck", "test", "build"],
      commit: { message: "test(workspace): this commit must not exist", push: false },
    }),
    new AbortController().signal,
  );
  throw new Error("Broken-suite proof unexpectedly succeeded");
} catch (error) {
  if (!(error instanceof WorkspaceExecutionError)) throw error;
  rollback = error.result;
}
if (
  rollback.status !== "rolled_back" ||
  !rollback.rollbackPerformed ||
  await readFile(targetPath, "utf8") !== acceptedContent ||
  await git("rev-parse", "HEAD") !== acceptedHead ||
  await git("status", "--porcelain") !== ""
) {
  throw new Error("Broken-suite proof did not restore content, HEAD and worktree");
}
await writeFile(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  sourceCommit: "7af6ea0",
  successCommit,
  target,
  rollback,
  assertions: {
    fullSuitePassedBeforeSuccessCommit: true,
    pushPerformedByExecutor: false,
    brokenSuiteRejected: true,
    contentRestored: true,
    headRestored: true,
    worktreeCleanAfterRollback: true,
  },
}, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  successCommit,
  rollbackExecutionId: rollback.id,
  evidencePath: path.relative(root, evidencePath),
})}\n`);