import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import express from "express";
import {
  ForgeRuntime,
  type AiProviderConnector,
  type MissionRecord,
  type WorkspaceVerificationRunner,
} from "@workspace/forge-runtime";
import { createMissionsRouter } from "../routes/missions";
import { createMissionIntakeRouter } from "../routes/operator";
import { createRuntimeGovernanceRouter } from "../routes/runtimeGovernance";

const exec = promisify(execFile);

async function waitForMission(
  baseUrl: string,
  missionId: string,
  status: MissionRecord["status"],
): Promise<MissionRecord> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    const response = await fetch(`${baseUrl}/api/missions/${missionId}`);
    const mission = await response.json() as MissionRecord;

    if (mission.status === status) {
      return mission;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for mission ${missionId} to become ${status}`);
}

async function startApi(runtime: ForgeRuntime): Promise<{
  readonly server: ReturnType<typeof createServer>;
  readonly baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use("/api", createMissionIntakeRouter(runtime));
  app.use("/api", createMissionsRouter(runtime));
  app.use("/api", createRuntimeGovernanceRouter(runtime));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeApi(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test(
  "Mission Console APIs expose workspace approval and evidence only after approval",
  { concurrency: false },
  async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-api-state-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "forge-api-workspace-"));
    const originalEnvironment = new Map(
      ["STORAGE_DIR", "FORGE_WORKSPACE_ROOT", "FORGE_AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "FORGE_AUTONOMY_ENABLED"]
        .map((key) => [key, process.env[key]]),
    );
    let runtime: ForgeRuntime | null = null;
    let server: ReturnType<typeof createServer> | null = null;

    try {
      await exec("git", ["init", "-b", "test/api-workspace-execution"], {
        cwd: workspaceRoot,
      });
      await exec("git", ["config", "user.name", "Forge API Test"], {
        cwd: workspaceRoot,
      });
      await exec("git", ["config", "user.email", "forge-api@example.invalid"], {
        cwd: workspaceRoot,
      });
      await writeFile(path.join(workspaceRoot, "README.txt"), "baseline\n", "utf8");
      await exec("git", ["add", "README.txt"], { cwd: workspaceRoot });
      await exec("git", ["commit", "-m", "test baseline"], { cwd: workspaceRoot });

      process.env.STORAGE_DIR = storageRoot;
      process.env.FORGE_WORKSPACE_ROOT = workspaceRoot;
      process.env.FORGE_AI_PROVIDER = "openai-responses";
      process.env.OPENAI_API_KEY = "test-only-not-a-real-secret";
      process.env.OPENAI_MODEL = "test-model";
      process.env.FORGE_AUTONOMY_ENABLED = "false";

      const connector: AiProviderConnector = {
        id: "openai-responses",
        async execute() {
          return Object.freeze({
            providerResponseId: "api-workspace-plan",
            outputText: JSON.stringify({
              schemaVersion: 1,
              summary:
                "Assumptions: the requested proof is confined to one new sandbox file and no other repository path may change. Verification guidance: inspect the persisted receipts, file effects, verification runs, artifacts, hashes, and accepted evaluation before treating execution as complete.",
              changes: [{
                path: "sandbox/mirror-generic-build-proof-8.txt",
                expectedSha256: null,
                content: "created through the governed WorkspaceExecutor\n",
              }],
              verification: ["typecheck"],
              commit: {
                message: "test: verify Mission Console workspace execution",
                push: false,
              },
            }),
            usage: Object.freeze({
              inputTokens: 20,
              outputTokens: 30,
              totalTokens: 50,
            }),
          });
        },
      };
      const verificationRunner: WorkspaceVerificationRunner = {
        async run(step) {
          return Object.freeze({
            command: `fake ${step}`,
            exitCode: 0,
            stdout: "passed",
            stderr: "",
            durationMs: 1,
          });
        },
      };

      runtime = new ForgeRuntime({
        aiProviderConnectors: [connector],
        workspaceVerificationRunner: verificationRunner,
        missionLoopPollIntervalMs: 100,
      });
      await runtime.start();

      const initialApi = await startApi(runtime);
      server = initialApi.server;
      let baseUrl = initialApi.baseUrl;

      const readOnlyPreviewResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command:
              "Analyseer uitsluitend sandbox/read-only.txt en wijzig geen bestanden.",
          }),
        },
      );
      assert.equal(
        readOnlyPreviewResponse.status,
        200,
        await readOnlyPreviewResponse.clone().text(),
      );
      const readOnlyPreview = await readOnlyPreviewResponse.json() as {
        readonly request: {
          readonly input?: Readonly<Record<string, unknown>>;
        };
      };
      assert.equal(readOnlyPreview.request.input?.targets, undefined);

      const postfixReadOnlyPreviewResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "Lees en wijzig sandbox/read-only.txt niet.",
          }),
        },
      );
      assert.equal(postfixReadOnlyPreviewResponse.status, 200);
      const postfixReadOnlyPreview = await postfixReadOnlyPreviewResponse.json() as {
        readonly request: {
          readonly input?: Readonly<Record<string, unknown>>;
        };
      };
      assert.equal(postfixReadOnlyPreview.request.input?.targets, undefined);

      const rootTargetPreviewResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "Maak output.json aan.",
          }),
        },
      );
      assert.equal(rootTargetPreviewResponse.status, 200);
      const rootTargetPreview = await rootTargetPreviewResponse.json() as {
        readonly request: {
          readonly input?: Readonly<Record<string, unknown>>;
        };
      };
      assert.deepEqual(rootTargetPreview.request.input?.targets, [{
        path: "output.json",
        allowCreate: true,
      }]);

      const inlineAmbiguousPreviewResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "Maak sandbox/first-proof.txt en sandbox/second-proof.txt.",
          }),
        },
      );
      assert.equal(inlineAmbiguousPreviewResponse.status, 400);

      const labeledPreviewResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: [
              "Maak uitsluitend het goedgekeurde proofbestand aan.",
              "Pad: sandbox/mirror-generic-build-proof-4.txt",
            ].join("\n"),
          }),
        },
      );
      assert.equal(labeledPreviewResponse.status, 200);
      const labeledPreview = await labeledPreviewResponse.json() as {
        readonly request: {
          readonly input?: Readonly<Record<string, unknown>>;
        };
      };
      assert.deepEqual(labeledPreview.request.input?.targets, [{
        path: "sandbox/mirror-generic-build-proof-4.txt",
        allowCreate: true,
      }]);

      const ambiguousPreviewResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: [
              "Maak het proofbestand aan.",
              "sandbox/first-proof.txt",
              "sandbox/second-proof.txt",
            ].join("\n"),
          }),
        },
      );
      assert.equal(ambiguousPreviewResponse.status, 400);

      const missingManifestResponse = await fetch(
        `${baseUrl}/api/operator/mission-intake/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command:
              "Maak het bestand in sandbox/missing-extension aan en wijzig niets anders.",
          }),
        },
      );
      assert.equal(missingManifestResponse.status, 400);

      const liveObjective = [
        "Maak uitsluitend één nieuw testbestand aan:",
        "",
        "Pad: sandbox/mirror-generic-build-proof-8.txt",
        "",
        "Exacte inhoud: Forge generic-build live approval proof",
        "Datum: 2026-07-30",
        "Doel: tweede workspace approval en echte execution evidence aantonen",
        "",
        "Wijzig geen enkel ander bestand.",
        "Gebruik dit exacte pad als expliciet target met allowCreate=true.",
        "Voer typecheck uit als verificatie.",
        "Niet pushen.",
      ].join("\n");

      const previewResponse = await fetch(`${baseUrl}/api/operator/mission-intake/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: liveObjective,
        }),
      });
      assert.equal(previewResponse.status, 200);
      const preview = await previewResponse.json() as {
        readonly request: {
          readonly input?: Readonly<Record<string, unknown>>;
        };
      };
      assert.deepEqual(preview.request.input?.targets, [{
        path: "sandbox/mirror-generic-build-proof-8.txt",
        allowCreate: true,
      }]);
      assert.equal(preview.request.input?.rawObjective, liveObjective);
      assert.equal(
        preview.request.input?.intakeObjectiveExecutionMode,
        "build-or-mutate",
      );
      assert.equal(
        preview.request.input?.intakeObjectiveProfile,
        "generic-build",
      );

      const createResponse = await fetch(`${baseUrl}/api/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview.request),
      });
      assert.equal(createResponse.status, 202);
      const created = await createResponse.json() as MissionRecord & {
        readonly approval: { readonly id: string };
      };
      assert.deepEqual(created.input.targets, [{
        path: "sandbox/mirror-generic-build-proof-8.txt",
        allowCreate: true,
      }]);
      assert.equal(created.input.rawObjective, liveObjective);
      assert.equal(
        created.input.intakeObjectiveExecutionMode,
        "build-or-mutate",
      );
      assert.equal(created.input.intakeObjectiveProfile, "generic-build");

      const firstApprovalResponse = await fetch(
        `${baseUrl}/api/governance/approvals/${created.approval.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor: "api-integration-test" }),
        },
      );
      assert.equal(firstApprovalResponse.status, 200);

      const planningMission = await waitForMission(
        baseUrl,
        created.id,
        "succeeded",
      );
      assert.equal(planningMission.output?.objectiveExecutionMode, "build-or-mutate");
      assert.equal(planningMission.output?.objectiveProfile, "generic-build");
      const executionMissionId = String(
        planningMission.output?.workspaceExecutionMissionId ?? "",
      );
      const executionApprovalId = String(
        planningMission.output?.workspaceExecutionApprovalId ?? "",
      );
      assert.ok(executionMissionId);
      assert.ok(executionApprovalId);
      assert.equal(planningMission.output?.executionEvidence, null);

      const approvalsAfterFirstApproval = await fetch(
        `${baseUrl}/api/governance/approvals`,
      ).then(
        (response) => response.json() as Promise<{
          approvals: Array<{ id: string; missionId: string; status: string }>;
        }>,
      );
      const executionAfterFirstApproval = await fetch(
        `${baseUrl}/api/missions/${executionMissionId}`,
      ).then((response) => response.json() as Promise<MissionRecord>);
      assert.equal(executionAfterFirstApproval.status, "awaiting_approval");
      assert.equal(executionAfterFirstApproval.output, null);
      assert.ok(
        approvalsAfterFirstApproval.approvals.some(
          (approval) =>
            approval.id === executionApprovalId &&
            approval.missionId === executionMissionId &&
            approval.status === "pending",
        ),
      );

      await closeApi(server);
      server = null;
      await runtime.stop();
      runtime = new ForgeRuntime({
        aiProviderConnectors: [connector],
        workspaceVerificationRunner: verificationRunner,
        missionLoopPollIntervalMs: 100,
      });
      await runtime.start();
      ({ server, baseUrl } = await startApi(runtime));

      const missionsBefore = await fetch(`${baseUrl}/api/missions`).then(
        (response) => response.json() as Promise<{ missions: MissionRecord[] }>,
      );
      const approvalsBefore = await fetch(
        `${baseUrl}/api/governance/approvals`,
      ).then(
        (response) => response.json() as Promise<{
          approvals: Array<{ id: string; missionId: string; status: string }>;
        }>,
      );
      const executionBefore = missionsBefore.missions.find(
        (mission) => mission.id === executionMissionId,
      );
      assert.equal(executionBefore?.status, "awaiting_approval");
      assert.equal(executionBefore?.output, null);
      assert.ok(
        approvalsBefore.approvals.some(
          (approval) =>
            approval.id === executionApprovalId &&
            approval.missionId === executionMissionId &&
            approval.status === "pending",
        ),
      );
      await assert.rejects(
        readFile(
          path.join(workspaceRoot, "sandbox", "mirror-generic-build-proof-8.txt"),
          "utf8",
        ),
      );

      const secondApprovalResponse = await fetch(
        `${baseUrl}/api/governance/approvals/${executionApprovalId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor: "api-integration-test" }),
        },
      );
      assert.equal(secondApprovalResponse.status, 200);

      const executionAfter = await waitForMission(
        baseUrl,
        executionMissionId,
        "succeeded",
      );
      const evidence = executionAfter.output?.executionEvidence as
        | Readonly<Record<string, unknown>>
        | undefined;
      const evaluation = executionAfter.output?.evaluation as
        | Readonly<Record<string, unknown>>
        | undefined;
      assert.ok(Array.isArray(evidence?.receipts) && evidence.receipts.length > 0);
      assert.ok(Array.isArray(evidence?.fileEffects) && evidence.fileEffects.length > 0);
      assert.ok(Array.isArray(evidence?.verificationRuns) && evidence.verificationRuns.length > 0);
      assert.ok(Array.isArray(evidence?.artifacts) && evidence.artifacts.length > 0);
      assert.equal(evaluation?.decision, "accepted");
      assert.equal(
        await readFile(
          path.join(workspaceRoot, "sandbox", "mirror-generic-build-proof-8.txt"),
          "utf8",
        ),
        "created through the governed WorkspaceExecutor\n",
      );
    } finally {
      if (server) {
        await closeApi(server);
      }
      await runtime?.stop();

      for (const [key, value] of originalEnvironment) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      await rm(storageRoot, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
);
