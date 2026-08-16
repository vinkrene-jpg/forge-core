import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  DockerWorkspaceVerificationRunner,
  NodeWorkspaceVerificationRunner,
  RuntimeEventBus,
  WorkspaceExecutionError,
  WorkspaceExecutor,
  parseWorkspaceChangeRequest,
} from "./index.js";

const exec = promisify(execFile);
const image = process.env.FORGE_VERIFICATION_IMAGE?.trim() || "forge-verification:latest";
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const evidencePath = path.join(repositoryRoot, "reconstruction", "WORKSPACE_VERIFICATION_ISOLATION_PROOF.json");
const failureTarget = "lib/forge-runtime/src/source-mutation-proof.ts";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root })).stdout.trim();
}

const root = await mkdtemp(path.join(os.tmpdir(), "forge-docker-proof-"));
try {
  await Promise.all(["sandbox", "lib", "artifacts"].map((directory) =>
    mkdir(path.join(root, directory), { recursive: true })));
  await mkdir(path.join(root, "lib", "forge-runtime", "src"), { recursive: true });
  await writeFile(path.join(root, "sandbox", "proof.txt"), "before\n", "utf8");
  const failureBaseline = await readFile(path.join(repositoryRoot, failureTarget), "utf8");
  await writeFile(path.join(root, failureTarget), failureBaseline, "utf8");
  await git(root, "init", "-b", "proof/docker-verification");
  await git(root, "config", "core.autocrlf", "false");
  await git(root, "config", "user.name", "Forge Verification Proof");
  await git(root, "config", "user.email", "forge-proof@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "proof baseline");

  const runner = new DockerWorkspaceVerificationRunner({ image, timeoutMs: 300_000 });
  const executor = new WorkspaceExecutor({ events: new RuntimeEventBus(), verificationRunner: runner });
  const success = await executor.execute(root, "docker-proof-success", parseWorkspaceChangeRequest({
    changes: [{
      path: "sandbox/proof.txt",
      expectedSha256: sha256("before\n"),
      content: "verified\n",
    }],
    verification: ["typecheck"],
    commit: null,
  }), new AbortController().signal);

  await git(root, "checkout", "--", "sandbox/proof.txt");
  let failure: WorkspaceExecutionError | null = null;
  try {
    await executor.execute(root, "docker-proof-failure", parseWorkspaceChangeRequest({
      changes: [{
        path: failureTarget,
        expectedSha256: sha256(failureBaseline),
        content: "export const broken = ;\n",
      }],
      verification: ["typecheck", "test", "build"],
      commit: null,
    }), new AbortController().signal);
  } catch (error) {
    if (!(error instanceof WorkspaceExecutionError)) throw error;
    failure = error;
  }
  if (!failure || failure.result.status !== "rolled_back") {
    throw new Error("Broken-code verification did not roll back.");
  }

  const network = await exec("docker", [
    "run", "--rm", "--network", "none", "--entrypoint", "node", image,
    "-e", "fetch('https://registry.npmjs.org').then(()=>process.exit(1)).catch(()=>process.exit(0))",
  ]);
  let hostRefusal = "";
  try {
    await new NodeWorkspaceVerificationRunner().run(
      "typecheck", root, new AbortController().signal, true,
    );
  } catch (error) {
    hostRefusal = error instanceof Error ? error.message : String(error);
  }
  const cleanStatus = await git(root, "status", "--porcelain");
  const restoredContent = await readFile(path.join(root, "sandbox", "proof.txt"), "utf8");
  if (cleanStatus.length !== 0 || restoredContent !== "before\n") {
    throw new Error(
      `Proof repository was not restored exactly: status=${JSON.stringify(cleanStatus)} contentSha256=${sha256(restoredContent)}`,
    );
  }
  if (!hostRefusal.includes("Host verification is disabled")) {
    throw new Error("Host verifier did not refuse execution.");
  }

  await writeFile(evidencePath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    image,
    success,
    failure: failure.result,
    network: { blocked: network.stderr.length === 0, exitCode: 0 },
    host: { refused: true, error: hostRefusal },
    rollback: { cleanGitStatus: cleanStatus, restoredContent: "before\\n" },
  }, null, 2)}\n`, "utf8");
  console.log(evidencePath);
} finally {
  await rm(root, { recursive: true, force: true });
}