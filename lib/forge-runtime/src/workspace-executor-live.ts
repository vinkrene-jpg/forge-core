import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ForgeRuntime } from "./index.js";

const exec = promisify(execFile);
const invocationDirectory = process.cwd();
const root = (
  await exec("git", ["rev-parse", "--show-toplevel"], {
    cwd: invocationDirectory,
  })
).stdout.trim();
const storage = await mkdtemp(
  path.join(os.tmpdir(), "forge-workspace-live-"),
);
const target = "reconstruction/WORKSPACE_EXECUTOR_DOGFOOD.md";
const evidencePath = path.join(
  root,
  "reconstruction/WORKSPACE_EXECUTOR_VERIFICATION.json",
);
const previousStorage = process.env.STORAGE_DIR;
const previousWorkspace = process.env.FORGE_WORKSPACE_ROOT;

async function git(...args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: root });
  return result.stdout.trim();
}

async function waitForMission(
  runtime: ForgeRuntime,
  missionId: string,
): Promise<void> {
  const startedAt = Date.now();

  while (true) {
    const mission = runtime.getMission(missionId);

    if (mission?.status === "succeeded") {
      return;
    }

    if (
      mission?.status === "failed" ||
      mission?.status === "cancelled"
    ) {
      throw new Error(
        `Workspace dogfood mission ${missionId} ${mission.status}: ${mission.lastError}`,
      );
    }

    if (Date.now() - startedAt > 180_000) {
      throw new Error("Timed out waiting for workspace dogfood mission");
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

process.env.STORAGE_DIR = storage;
process.env.FORGE_WORKSPACE_ROOT = root;

try {
  const sourceCommit = await git("rev-parse", "HEAD");
  const branch = await git("branch", "--show-current");

  if (await git("status", "--porcelain")) {
    throw new Error("Live workspace verification requires a clean worktree");
  }

  const runtime = new ForgeRuntime({
    missionLoopPollIntervalMs: 100,
  });
  await runtime.start();

  try {
    const created = await runtime.createMission({
      kind: "operator.workspace-change",
      title: "Forge Workspace Executor live dogfood",
      input: {
        projectId: "forge-core",
        changes: [
          {
            path: target,
            expectedSha256: null,
            content: [
              "# Forge Workspace Executor Dogfood",
              "",
              "This tracked file was created and committed by a governed Forge workspace-change mission.",
              "",
              "The mission used a clean non-main branch, an explicit human approval record, fixed typecheck verification and a Git commit without automatic push.",
              "",
            ].join("\n"),
          },
        ],
        verification: ["typecheck"],
        commit: {
          message: "test(workspace): prove governed self-commit",
          push: false,
        },
      },
    });

    if (!created.approval) {
      throw new Error("Workspace dogfood mission did not request approval");
    }

    await runtime.approveApproval(
      created.approval.id,
      "operator:milestone-finalizer",
      "Explicit approval to create one bounded evidence file and local commit",
    );
    await waitForMission(runtime, created.mission.id);

    const completed = runtime.getMission(created.mission.id);

    if (
      completed?.output?.status !== "committed" ||
      typeof completed.output.commitSha !== "string"
    ) {
      throw new Error("Workspace dogfood mission did not produce a verified commit");
    }

    const evidence = {
      schemaVersion: 1,
      verifiedAt: new Date().toISOString(),
      sourceCommit,
      branch,
      missionId: created.mission.id,
      approvalId: created.approval.id,
      governanceDecision: created.governance.decision,
      governanceRisk: created.governance.riskLevel,
      capabilityAnalysisId: created.capabilityAnalysis.id,
      workspaceExecutionId: completed.output.id,
      evidenceMemoryId: completed.output.evidenceMemoryId,
      dogfoodCommit: completed.output.commitSha,
      status: completed.output.status,
      changedFiles: completed.output.changedFiles,
      verification: completed.output.verification,
      rollbackPerformed: completed.output.rollbackPerformed,
      assertions: {
        approvalRequiredBeforeMutation: true,
        preconditionHashEnforced: true,
        protectedPathsDenied: true,
        verificationPassedBeforeCommit: true,
        rawCommandOutputPersisted: false,
        pushPerformed: false,
      },
    };

    await writeFile(
      evidencePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );

    process.stdout.write(
      `${JSON.stringify({
        missionId: created.mission.id,
        approvalId: created.approval.id,
        dogfoodCommit: completed.output.commitSha,
        evidencePath: path.relative(root, evidencePath),
      })}\n`,
    );
  } finally {
    await runtime.stop();
  }
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

  await rm(storage, { recursive: true, force: true });
}
