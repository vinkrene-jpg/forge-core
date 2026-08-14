import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ForgeRuntime } from "./index.js";
import type { AiExecutionRecord } from "./ai-gateway.js";
import type {
  WorkspaceCommandResult,
  WorkspaceVerificationRunner,
  WorkspaceVerificationStep,
} from "./workspace-executor.js";

type Behavior = "success" | "hang" | "fail";

const environmentKeys = [
  "STORAGE_DIR",
  "FORGE_WORKSPACE_ROOT",
  "FORGE_AUTONOMY_ENABLED",
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function providerOutputText(): string {
  return [
    "Assumptions: only approved workspace targets are authoritative and no unapproved paths may change.",
    "Verification guidance: run typecheck and test, then inspect receipts, file effects and artifact hashes.",
    "Evidence summary: this deterministic output is intentionally long enough to satisfy substantive output checks while remaining secret-free and traceable.",
  ].join("\n");
}

class SequencedRunner implements WorkspaceVerificationRunner {
  readonly #behaviors: readonly Behavior[];
  #index = 0;
  readonly calls: {
    readonly step: WorkspaceVerificationStep;
    readonly rootPath: string;
  }[] = [];

  constructor(behaviors: readonly Behavior[]) {
    this.#behaviors = behaviors;
  }

  async run(
    step: WorkspaceVerificationStep,
    rootPath: string,
    signal: AbortSignal,
  ): Promise<WorkspaceCommandResult> {
    this.calls.push(Object.freeze({ step, rootPath }));
    const behavior = this.#behaviors[this.#index] ?? "success";
    this.#index += 1;

    if (behavior === "hang") {
      return new Promise(() => undefined);
    }

    if (behavior === "fail") {
      return Object.freeze({
        command: `pnpm run ${step}`,
        exitCode: 1,
        stdout: "",
        stderr: "simulated failure",
        durationMs: 1,
      });
    }

    return Object.freeze({
      command: `pnpm run ${step}`,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 1,
    });
  }
}

async function withEnvironment(
  run: (input: { storageRoot: string; workspaceRoot: string }) => Promise<void>,
): Promise<void> {
  const original = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-recovery-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "forge-recovery-workspace-"));

  process.env.STORAGE_DIR = storageRoot;
  process.env.FORGE_WORKSPACE_ROOT = workspaceRoot;
  process.env.FORGE_AUTONOMY_ENABLED = "false";

  try {
    await run({ storageRoot, workspaceRoot });
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
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

interface LegacyFixture {
  readonly sourceMission: Record<string, unknown>;
  readonly workspaceMission: Record<string, unknown>;
  readonly sourceApproval: Record<string, unknown>;
  readonly workspaceApproval: Record<string, unknown>;
  readonly execution: AiExecutionRecord;
}

async function createLegacyFixture(input: {
  workspaceRoot: string;
  relativePath: string;
  content: string;
  workspaceMissionStatus?: "running" | "succeeded";
  verification?: readonly WorkspaceVerificationStep[];
}): Promise<LegacyFixture> {
  const sourceMissionId = randomUUID();
  const workspaceMissionId = randomUUID();
  const sourceApprovalId = randomUUID();
  const workspaceApprovalId = randomUUID();
  const planId = randomUUID();
  const compositionId = randomUUID();
  const executionId = randomUUID();
  const createdAt = now();
  const providerOutput = providerOutputText();
  const providerOutputSha256 = sha256(providerOutput);
  const verification = input.verification ?? ["typecheck"];

  const absoluteTargetPath = path.join(input.workspaceRoot, input.relativePath);
  await mkdir(path.dirname(absoluteTargetPath), { recursive: true });
  await writeFile(absoluteTargetPath, input.content, "utf8");

  const request = {
    changes: [
      {
        path: input.relativePath,
        expectedSha256: null,
        content: input.content,
      },
    ],
    verification,
    commit: {
      message: "recovery proof",
      push: false,
    },
  };

  const sourceMission = {
    id: sourceMissionId,
    kind: "operator.autonomous-cycle",
    title: `source mission ${sourceMissionId}`,
    status: "succeeded",
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    attempts: 1,
    interruptedCount: 0,
    input: {
      projectId: "forge-core",
      objective: "Create one proof file and verify.",
      cycleIndex: 1,
      maxCycles: 1,
      objectiveExecutionMode: "build-or-mutate",
      objectiveProfile: "generic-build",
      targets: [{ path: input.relativePath, allowCreate: true }],
    },
    output: {
      objectiveExecutionMode: "build-or-mutate",
      objectiveProfile: "generic-build",
      compositionId,
      executionId,
      plan: {
        id: planId,
        missionId: sourceMissionId,
        projectId: "forge-core",
        objective: "Create one proof file and verify.",
        summary: "Assumptions and verification guidance for workspace change.",
        assumptions: ["Only the approved workspace target may change."],
        targets: [{ path: input.relativePath, expectedSha256: null, exists: false }],
        request,
        compositionId,
        executionId,
        providerOutputSha256,
        createdAt,
      },
      workspaceExecutionMissionId: workspaceMissionId,
      workspaceExecutionApprovalId: workspaceApprovalId,
      missionResult: {
        status: "completed",
        cause: "execution",
        message: "Mission completed",
        producedAt: createdAt,
      },
    },
    lastError: null,
  };

  const workspaceMission = {
    id: workspaceMissionId,
    kind: "operator.workspace-change",
    title: `workspace mission ${workspaceMissionId}`,
    status: input.workspaceMissionStatus ?? "running",
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    completedAt: input.workspaceMissionStatus === "succeeded" ? createdAt : null,
    attempts: 1,
    interruptedCount: 0,
    input: {
      projectId: "forge-core",
      sourcePlanningMissionId: sourceMissionId,
      sourceAutonomousMissionId: sourceMissionId,
      sourcePlanId: planId,
      providerOutputSha256,
      objectiveExecutionMode: "build-or-mutate",
      objectiveProfile: "generic-build",
      ...request,
    },
    output: input.workspaceMissionStatus === "succeeded"
      ? {
          status: "verified",
          verification: [],
          executionEvidence: {
            objectiveProfile: "generic-build",
            receipts: [],
            fileEffects: [],
            verificationRuns: [],
            artifacts: [],
          },
          workspaceExecutionCheckpoint: {
            version: 1,
            persistedAt: createdAt,
            mutationCompleted: true,
          },
        }
      : null,
    lastError: null,
  };

  const sourceApproval = {
    id: sourceApprovalId,
    missionId: sourceMissionId,
    status: "approved",
    assessment: {
      policyVersion: "1.0.0",
      action: "mission.execute",
      missionKind: "operator.autonomous-cycle",
      riskLevel: "medium",
      decision: "require_approval",
      reason: "test",
      assessedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
    decidedAt: createdAt,
    decidedBy: "test",
    note: "approved",
  };

  const workspaceApproval = {
    id: workspaceApprovalId,
    missionId: workspaceMissionId,
    status: "approved",
    assessment: {
      policyVersion: "1.0.0",
      action: "mission.execute",
      missionKind: "operator.workspace-change",
      riskLevel: "high",
      decision: "require_approval",
      reason: "test",
      assessedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
    decidedAt: createdAt,
    decidedBy: "test",
    note: "approved",
  };

  const execution: AiExecutionRecord = Object.freeze({
    id: executionId,
    missionId: sourceMissionId,
    compositionId,
    projectId: "forge-core",
    routeProfileId: "test-route",
    providerId: "openai-responses",
    model: "test-model",
    status: "succeeded",
    inputChars: 300,
    outputText: providerOutput,
    usage: Object.freeze({
      inputTokens: 100,
      outputTokens: 120,
      totalTokens: 220,
    }),
    estimatedCostUsd: 0,
    providerResponseId: "provider-response",
    error: null,
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
  });

  return {
    sourceMission,
    workspaceMission,
    sourceApproval,
    workspaceApproval,
    execution,
  };
}

async function writeRuntimeState(input: {
  storageRoot: string;
  missions: readonly Record<string, unknown>[];
  approvals: readonly Record<string, unknown>[];
  executions: readonly AiExecutionRecord[];
}): Promise<void> {
  const stateRoot = path.join(input.storageRoot, "forge-runtime");
  await mkdir(stateRoot, { recursive: true });

  await writeFile(
    path.join(stateRoot, "missions.json"),
    JSON.stringify({ version: 1, missions: input.missions }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(stateRoot, "governance.json"),
    JSON.stringify({ version: 1, approvals: input.approvals }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(stateRoot, "ai-gateway.json"),
    JSON.stringify({ version: 1, executions: input.executions }, null, 2) + "\n",
    "utf8",
  );
}

test("runtime workspace recovery", { concurrency: false }, async (t) => {
  await t.test("1) geen herstelrecords", async () => {
    await withEnvironment(async ({ storageRoot }) => {
      await writeRuntimeState({
        storageRoot,
        missions: [],
        approvals: [],
        executions: [],
      });

      const runner = new SequencedRunner(["success"]);
      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: runner,
        missionLoopPollIntervalMs: 100,
        workspaceRecoveryTimeoutMs: 300,
      });

      const snapshot = await runtime.start();
      assert.equal(snapshot.status, "running");
      assert.equal(runner.calls.length, 0);
      await runtime.stop();
    });
  });

  await t.test("2) een geldig herstelrecord", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-valid.txt",
        content: "valid recovery",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["success"]),
        workspaceRecoveryTimeoutMs: 300,
      });

      await runtime.start();
      const recovered = runtime.getMission(String(fixture.workspaceMission.id));
      assert.equal(recovered?.status, "succeeded");
      assert.equal(
        (recovered?.output?.workspaceRecovery as { validated?: boolean } | undefined)
          ?.validated,
        true,
      );
      await runtime.stop();
    });
  });

  await t.test("3) een reeds afgerond record", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-done.txt",
        content: "already done",
        workspaceMissionStatus: "succeeded",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const runner = new SequencedRunner(["success"]);
      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: runner,
        workspaceRecoveryTimeoutMs: 300,
      });

      await runtime.start();
      const mission = runtime.getMission(String(fixture.workspaceMission.id));
      assert.equal(mission?.status, "succeeded");
      assert.equal(runner.calls.length, 0);
      await runtime.stop();
    });
  });

  await t.test("4) een hangend herstelrecord", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-hang.txt",
        content: "hang recovery",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["hang"]),
        workspaceRecoveryTimeoutMs: 120,
      });

      const startedAt = Date.now();
      const snapshot = await runtime.start();
      assert.equal(snapshot.status, "running");
      assert.ok(Date.now() - startedAt < 5_000);

      const mission = runtime.getMission(String(fixture.workspaceMission.id));
      assert.equal(mission?.status, "failed");
      assert.match(mission?.lastError ?? "", /timed out/i);
      const recovery = mission?.output?.workspaceRecovery as
        | { timedOut?: boolean; missionId?: string }
        | undefined;
      assert.equal(recovery?.timedOut, true);
      assert.equal(recovery?.missionId, fixture.workspaceMission.id);
      await runtime.stop();
    });
  });

  await t.test("5) een defect herstelrecord", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-defect.txt",
        content: "defect recovery",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["fail"]),
        workspaceRecoveryTimeoutMs: 300,
      });

      await runtime.start();
      const mission = runtime.getMission(String(fixture.workspaceMission.id));
      assert.equal(mission?.status, "failed");
      assert.match(mission?.lastError ?? "", /verification failed/i);
      const recovery = mission?.output?.workspaceRecovery as
        | { timedOut?: boolean }
        | undefined;
      assert.equal(recovery?.timedOut, false);
      await runtime.stop();
    });
  });

  await t.test("6) meerdere records waarvan er één hangt", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const hanging = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-multi-hang.txt",
        content: "hang multi",
      });
      const valid = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-multi-valid.txt",
        content: "valid multi",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [
          hanging.sourceMission,
          hanging.workspaceMission,
          valid.sourceMission,
          valid.workspaceMission,
        ],
        approvals: [
          hanging.sourceApproval,
          hanging.workspaceApproval,
          valid.sourceApproval,
          valid.workspaceApproval,
        ],
        executions: [hanging.execution, valid.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["hang", "success"]),
        workspaceRecoveryTimeoutMs: 120,
      });

      await runtime.start();
      assert.equal(
        runtime.getMission(String(hanging.workspaceMission.id))?.status,
        "failed",
      );
      assert.equal(
        runtime.getMission(String(valid.workspaceMission.id))?.status,
        "succeeded",
      );
      await runtime.stop();
    });
  });

  await t.test("7) meerdere records waarvan er één faalt", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const failing = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-multi-fail.txt",
        content: "fail multi",
      });
      const valid = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-multi-ok.txt",
        content: "ok multi",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [
          failing.sourceMission,
          failing.workspaceMission,
          valid.sourceMission,
          valid.workspaceMission,
        ],
        approvals: [
          failing.sourceApproval,
          failing.workspaceApproval,
          valid.sourceApproval,
          valid.workspaceApproval,
        ],
        executions: [failing.execution, valid.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["fail", "success"]),
        workspaceRecoveryTimeoutMs: 300,
      });

      await runtime.start();
      assert.equal(
        runtime.getMission(String(failing.workspaceMission.id))?.status,
        "failed",
      );
      assert.equal(
        runtime.getMission(String(valid.workspaceMission.id))?.status,
        "succeeded",
      );
      await runtime.stop();
    });
  });

  await t.test("8) geen dubbele hervatting", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-once.txt",
        content: "recover once",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const firstRuntime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["success"]),
        workspaceRecoveryTimeoutMs: 300,
      });
      await firstRuntime.start();
      const firstRecoveredEvents = firstRuntime
        .snapshot()
        .events.filter((event) => event.type === "mission.recovered").length;
      assert.equal(firstRecoveredEvents, 1);
      await firstRuntime.stop();

      const secondRuntime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["success"]),
        workspaceRecoveryTimeoutMs: 300,
      });
      await secondRuntime.start();
      const secondRecoveredEvents = secondRuntime
        .snapshot()
        .events.filter((event) => event.type === "mission.recovered").length;
      assert.equal(secondRecoveredEvents, 0);
      await secondRuntime.stop();
    });
  });

  await t.test("9) timeout wordt gelogd met record-ID", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-timeout-log.txt",
        content: "timeout logging",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["hang"]),
        workspaceRecoveryTimeoutMs: 120,
      });

      await runtime.start();
      const mission = runtime.getMission(String(fixture.workspaceMission.id));
      assert.match(mission?.lastError ?? "", new RegExp(String(fixture.workspaceMission.id)));
      const recovery = mission?.output?.workspaceRecovery as
        | { missionId?: string; error?: string }
        | undefined;
      assert.equal(recovery?.missionId, fixture.workspaceMission.id);
      assert.match(recovery?.error ?? "", new RegExp(String(fixture.workspaceMission.id)));
      await runtime.stop();
    });
  });

  await t.test("10) Forge-start gaat na recovery door", async () => {
    await withEnvironment(async ({ storageRoot, workspaceRoot }) => {
      const fixture = await createLegacyFixture({
        workspaceRoot,
        relativePath: "sandbox/recovery-continue.txt",
        content: "continue startup",
      });

      await writeRuntimeState({
        storageRoot,
        missions: [fixture.sourceMission, fixture.workspaceMission],
        approvals: [fixture.sourceApproval, fixture.workspaceApproval],
        executions: [fixture.execution],
      });

      const runtime = new ForgeRuntime({
        workspaceVerificationRunner: new SequencedRunner(["hang"]),
        workspaceRecoveryTimeoutMs: 120,
      });

      const kernel = await runtime.start();
      assert.equal(kernel.status, "running");
      const snapshot = runtime.snapshot();
      assert.equal(snapshot.kernel.status, "running");
      await runtime.stop();
    });
  });
});
