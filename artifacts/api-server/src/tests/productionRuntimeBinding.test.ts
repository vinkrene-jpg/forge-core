import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const artifactDir = process.cwd();
const repositoryRoot = path.resolve(artifactDir, "..", "..");

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForJson<T>(url: string): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return await response.json() as T;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

async function waitForMissionStatus<T extends {
  readonly status: string;
}>(
  baseUrl: string,
  missionId: string,
  status: string,
): Promise<T> {
  const startedAt = Date.now();
  let mission = await waitForJson<T>(`${baseUrl}/api/missions/${missionId}`);

  while (mission.status !== status && Date.now() - startedAt < 20_000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    mission = await waitForJson<T>(`${baseUrl}/api/missions/${missionId}`);
  }

  assert.equal(mission.status, status, JSON.stringify(mission));
  return mission;
}

test("production restart migrates legacy stale workspace mission without mutation replay", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-dist-state-"));
  const workspaceRoot = await mkdtemp(
    path.join(artifactDir, "dist", "forge-dist-workspace-"),
  );
  const apiPort = await availablePort();
  const providerPort = await availablePort();
  const targetPath = "sandbox/mirror-final-workspace-flow.txt";
  const targetContent = "Forge generic-build live approval proof\n";
  const rawObjective = [
    "Maak uitsluitend één nieuw testbestand aan:",
    "",
    `Pad: ${targetPath}`,
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
  const liveInvalidOutput = [
    "{",
    "  \"schemaVersion\": 1,",
    "  \"summary\": \"The mission to execute a bounded evidence exercise for capability human-intent.goal-clarification was rejected due to an external provider execution failure. A manual fallback response has been generated, and the capability is marked as a gap until verified implementation evidence exists.\",",
    "  \"changes\": [",
    "    {",
    "      \"path\": \"sandbox/mirror-generic-build-proof-16.txt\",",
    "      \"expectedSha256\": null,",
    "      \"content\": \"// This file was created as part of a fallback response for the rejected mission.\\n// It is intended to be a placeholder until verified implementation evidence exists.\"",
    "    }",
    "  ],",
    "  \"verification\": [",
    "    \"Run pnpm --filter @workspace/forge-runtime test\",",
    "    \"Run pnpm --filter @workspace/forge-runtime typecheck\",",
    "    \"Confirm no secret material is persisted in runtime evidence\"",
    "  ],",
    "  \"commit\": {",
    "    \"message\": \"Fallback response for rejected mission and placeholder file creation\",",
    "    \"push\": false",
    "  }",
    "}",
  ].join("\n");
  const providerRequestBodies: Readonly<Record<string, unknown>>[] = [];
  const provider = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      providerRequestBodies.push(
        JSON.parse(body) as Readonly<Record<string, unknown>>,
      );
      const plan = {
        schemaVersion: 1,
        summary:
          "Assumptions: the approved target is one new sandbox proof file and no other repository content may change. Verification guidance: inspect the persisted plan, second approval, exact target path, receipts, file effects, verification runs, artifact hashes, and final evaluation before accepting this governed execution.",
        changes: [{
          path: targetPath,
          expectedSha256: null,
          content: targetContent,
        }],
        verification: [
          "typecheck",
          "Run pnpm --filter @workspace/forge-runtime test",
        ],
        commit: {
          message: "test: production runtime binding",
          push: false,
        },
      };
      const content =
        providerRequestBodies.length > 1 &&
          body.includes("mirror-final-stale-context-check.txt")
        ? liveInvalidOutput
        : JSON.stringify(plan, null, 2);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        id: "chatcmpl-qwen25coder-workspace-plan",
        model: "qwen2.5-coder:7b",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content,
          },
        }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 30,
          total_tokens: 50,
        },
      }));
    });
  });
  await new Promise<void>((resolve) =>
    provider.listen(providerPort, "127.0.0.1", resolve));

  await exec("git", ["init", "-b", "test/production-runtime-binding"], {
    cwd: workspaceRoot,
  });
  await exec("git", ["config", "user.name", "Forge Dist Test"], {
    cwd: workspaceRoot,
  });
  await exec("git", ["config", "user.email", "forge-dist@example.invalid"], {
    cwd: workspaceRoot,
  });
  await writeFile(path.join(workspaceRoot, "README.txt"), "baseline\n", "utf8");
  await writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "@workspace/forge-production-flow-test",
      private: true,
      scripts: {
        typecheck: "node -e \"process.exit(0)\"",
        test: "node -e \"process.exit(0)\"",
      },
    }),
    "utf8",
  );
  await exec("git", ["add", "README.txt", "package.json"], { cwd: workspaceRoot });
  await exec("git", ["commit", "-m", "test baseline"], { cwd: workspaceRoot });

  const rejectedPort = await availablePort();
  let rejectedOutput = "";
  const rejectedApi = spawn(
    process.execPath,
    ["--enable-source-maps", "./dist/index.mjs"],
    {
      cwd: artifactDir,
      env: {
        ...process.env,
        PORT: String(rejectedPort),
        FORGE_CANONICAL_REPO_ROOT: workspaceRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  rejectedApi.stdout.on("data", (chunk) => {
    rejectedOutput += String(chunk);
  });
  rejectedApi.stderr.on("data", (chunk) => {
    rejectedOutput += String(chunk);
  });
  const rejectedExitCode = await Promise.race([
    new Promise<number | null>((resolve) =>
      rejectedApi.once("exit", (code) => resolve(code))),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Non-canonical runtime did not fail closed")),
        5_000,
      )),
  ]);
  assert.notEqual(rejectedExitCode, 0);
  assert.match(
    rejectedOutput,
    /Forge runtime module is outside canonical repository root/,
  );

  let output = "";
  const apiEnvironment = {
    ...process.env,
    PORT: String(apiPort),
    NODE_ENV: "production",
    STORAGE_DIR: storageRoot,
    FORGE_WORKSPACE_ROOT: workspaceRoot,
    FORGE_CANONICAL_REPO_ROOT: repositoryRoot,
    FORGE_AI_PROVIDER: "local-model",
    FORGE_LOCAL_MODEL_ENABLED: "true",
    FORGE_AUTONOMY_ENABLED: "false",
    FORGE_LOCAL_MODEL_NAME: "qwen2.5-coder:7b",
    FORGE_LOCAL_MODEL_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    FORGE_WORKSPACE_FINALIZATION_DELAY_MS: "30000",
  };
  const startApi = () => {
    const child = spawn(
      process.execPath,
      ["--enable-source-maps", "./dist/index.mjs"],
      {
        cwd: artifactDir,
        env: apiEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-20_000);
    });
    child.stderr.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-20_000);
    });
    return child;
  };
  const stopApi = async (child: ReturnType<typeof spawn>): Promise<void> => {
    if (child.exitCode !== null) {
      return;
    }

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  };
  const killApi = async (child: ReturnType<typeof spawn>): Promise<void> => {
    if (child.exitCode !== null) {
      return;
    }

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  };
  let api = startApi();

  try {
    await waitForJson(`${`http://127.0.0.1:${apiPort}`}/api/healthz`);
    const baseUrl = `http://127.0.0.1:${apiPort}`;
    assert.match(output, /Server listening/);
    assert.equal((await fetch(`${baseUrl}/api/healthz`)).status, 200);
    const runtimeSnapshot = await waitForJson<{
      readonly binding: Readonly<Record<string, unknown>>;
    }>(`${baseUrl}/api/runtime`);
    assert.equal(runtimeSnapshot.binding.runtimeRepositoryRoot, repositoryRoot);
    assert.equal(runtimeSnapshot.binding.canonicalRepositoryRoot, repositoryRoot);
    const createResponse = await fetch(`${baseUrl}/api/missions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "operator.autonomous-cycle",
        title: "Production runtime binding proof",
        input: {
          projectId: "forge-core",
          objective: rawObjective.replace(/\s+/g, " ").trim(),
          rawObjective,
          targets: [{ path: targetPath, allowCreate: true }],
          objectiveExecutionMode: "build-or-mutate",
          objectiveProfile: "generic-build",
          intakeObjectiveExecutionMode: "build-or-mutate",
          intakeObjectiveProfile: "generic-build",
          proofTargetPath: targetPath,
          cycleIndex: 1,
          maxCycles: 1,
          continuationAuthorized: false,
        },
      }),
    });
    assert.equal(createResponse.status, 202, await createResponse.clone().text());
    const created = await createResponse.json() as {
      readonly id: string;
      readonly approval: { readonly id: string };
    };
    const approvalResponse = await fetch(
      `${baseUrl}/api/governance/approvals/${created.approval.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "production-binding-test" }),
      },
    );
    assert.equal(approvalResponse.status, 200, await approvalResponse.clone().text());

    const mission = await waitForJson<{
      readonly status: string;
      readonly output?: Readonly<Record<string, unknown>>;
    }>(`${baseUrl}/api/missions/${created.id}`);
    const startedAt = Date.now();
    let terminal = mission;

    while (
      terminal.status !== "succeeded" &&
      terminal.status !== "failed" &&
      Date.now() - startedAt < 15_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      terminal = await waitForJson<typeof mission>(
        `${baseUrl}/api/missions/${created.id}`,
      );
    }

    assert.equal(terminal.status, "succeeded", JSON.stringify(terminal));
    assert.equal(terminal.output?.objectiveExecutionMode, "build-or-mutate");
    assert.equal(terminal.output?.objectiveProfile, "generic-build");
    assert.equal(terminal.output?.evaluation, null);
    assert.equal(typeof terminal.output?.workspaceExecutionMissionId, "string");
    assert.equal(typeof terminal.output?.workspaceExecutionApprovalId, "string");
    assert.deepEqual(
      (terminal.output?.plan as {
        readonly request: { readonly verification: readonly string[] };
      }).request.verification,
      ["typecheck", "test"],
    );
    const executionMissionId = String(
      terminal.output?.workspaceExecutionMissionId,
    );
    const executionApprovalId = String(
      terminal.output?.workspaceExecutionApprovalId,
    );
    const executionMission = await fetch(
      `${baseUrl}/api/missions/${executionMissionId}`,
    ).then((response) => response.json() as Promise<{
      readonly status: string;
      readonly output: unknown;
    }>);
    const approvals = await fetch(`${baseUrl}/api/governance/approvals`)
      .then((response) => response.json() as Promise<{
        readonly approvals: readonly {
          readonly id: string;
          readonly missionId: string;
          readonly status: string;
        }[];
      }>);
    assert.equal(executionMission.status, "awaiting_approval");
    assert.equal(executionMission.output, null);
    assert.ok(approvals.approvals.some(
      (approval) =>
        approval.id === executionApprovalId &&
        approval.missionId === executionMissionId &&
        approval.status === "pending",
    ));
    await assert.rejects(
      readFile(path.join(workspaceRoot, targetPath), "utf8"),
    );
    const snapshot = terminal.output?.preExecutionSnapshot as
      | Readonly<Record<string, unknown>>
      | undefined;
    assert.ok(snapshot);
    assert.match(String(snapshot.runtimeBuildSha), /^[0-9a-f]{40}$/);
    assert.match(String(snapshot.runtimeModulePath), /dist[\\/]index\.mjs$/);
    assert.equal(snapshot.runtimeRepositoryRoot, repositoryRoot);
    assert.equal(snapshot.canonicalRepositoryRoot, repositoryRoot);
    assert.equal(snapshot.intakeObjectiveExecutionMode, "build-or-mutate");
    assert.equal(snapshot.intakeObjectiveProfile, "generic-build");
    assert.equal(snapshot.effectiveObjectiveExecutionMode, "build-or-mutate");
    assert.equal(snapshot.effectiveObjectiveProfile, "generic-build");
    const providerRequest = providerRequestBodies[0];
    assert.match(JSON.stringify(providerRequest), /mirror-final-workspace-flow/);
    assert.doesNotMatch(
      JSON.stringify(providerRequest),
      /mirror-generic-build-proof-16/,
    );
    const responseFormat = providerRequest?.response_format as
      | Readonly<Record<string, unknown>>
      | undefined;
    assert.equal(responseFormat?.type, "json_schema");
    const jsonSchema = responseFormat?.json_schema as
      | Readonly<Record<string, unknown>>
      | undefined;
    assert.equal(jsonSchema?.name, "forge_workspace_execution_plan");
    assert.equal(jsonSchema?.strict, true);
    assert.equal(
      (jsonSchema?.schema as Readonly<Record<string, unknown>>)?.additionalProperties,
      false,
    );
    const schemaProperties = (
      jsonSchema?.schema as Readonly<Record<string, unknown>>
    )?.properties as Readonly<Record<string, unknown>>;
    const verificationSchema = schemaProperties.verification as
      Readonly<Record<string, unknown>>;
    const verificationItems = verificationSchema.items as
      Readonly<Record<string, unknown>>;
    assert.deepEqual(
      verificationItems.enum,
      ["typecheck", "test", "build"],
    );
    const messages = providerRequest?.messages as
      | readonly Readonly<Record<string, unknown>>[]
      | undefined;
    assert.deepEqual(messages?.map((message) => message.role), ["system", "user"]);
    assert.match(String(messages?.[0]?.content), /exactly one JSON object/);
    assert.match(String(messages?.[1]?.content), /Required output JSON Schema/);
    assert.equal(providerRequest?.temperature, 0);
    assert.match(output, /Forge runtime binding/);

    await stopApi(api);
    output = "";
    api = startApi();
    await waitForJson(`${baseUrl}/api/healthz`);
    assert.match(output, /Server listening/);
    assert.equal((await fetch(`${baseUrl}/api/healthz`)).status, 200);

    const persistedExecutionMission = await waitForJson<{
      readonly status: string;
      readonly output: unknown;
    }>(`${baseUrl}/api/missions/${executionMissionId}`);
    const persistedApprovals = await waitForJson<{
      readonly approvals: readonly {
        readonly id: string;
        readonly missionId: string;
        readonly status: string;
      }[];
    }>(`${baseUrl}/api/governance/approvals`);
    assert.equal(persistedExecutionMission.status, "awaiting_approval");
    assert.equal(persistedExecutionMission.output, null);
    assert.ok(persistedApprovals.approvals.some(
      (approval) =>
        approval.id === executionApprovalId &&
        approval.missionId === executionMissionId &&
        approval.status === "pending",
    ));
    await assert.rejects(
      readFile(path.join(workspaceRoot, targetPath), "utf8"),
    );

    const executionApprovalResponse = await fetch(
      `${baseUrl}/api/governance/approvals/${executionApprovalId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "production-binding-test" }),
      },
    );
    assert.equal(
      executionApprovalResponse.status,
      200,
      await executionApprovalResponse.clone().text(),
    );
    let checkpointedExecutionMission = await waitForJson<{
      readonly status: string;
      readonly output?: Readonly<Record<string, unknown>>;
    }>(`${baseUrl}/api/missions/${executionMissionId}`);
    const checkpointStartedAt = Date.now();
    while (
      !checkpointedExecutionMission.output?.workspaceExecutionCheckpoint &&
      Date.now() - checkpointStartedAt < 20_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      checkpointedExecutionMission = await waitForJson(
        `${baseUrl}/api/missions/${executionMissionId}`,
      );
    }
    assert.equal(checkpointedExecutionMission.status, "running");
    assert.ok(checkpointedExecutionMission.output?.workspaceExecutionCheckpoint);
    assert.equal(
      await readFile(path.join(workspaceRoot, targetPath), "utf8"),
      targetContent,
    );
    const evidence = checkpointedExecutionMission.output?.executionEvidence as
      | {
          readonly receipts: readonly unknown[];
          readonly fileEffects: readonly {
            readonly path: string;
            readonly afterSha256: string;
          }[];
          readonly verificationRuns: readonly {
            readonly exitCode: number;
          }[];
          readonly artifacts: readonly {
            readonly path: string;
            readonly content: string;
            readonly sha256: string;
          }[];
        }
      | undefined;
    assert.ok(evidence);
    assert.ok(evidence.receipts.length > 0);
    assert.equal(evidence.fileEffects.length, 1);
    assert.ok(
      evidence.fileEffects[0]?.path.endsWith(
        targetPath.replaceAll("/", path.sep),
      ),
    );
    const expectedSha256 = createHash("sha256")
      .update(targetContent)
      .digest("hex");
    assert.equal(evidence.fileEffects[0]?.afterSha256, expectedSha256);
    assert.ok(evidence.verificationRuns.length > 0);
    assert.ok(evidence.verificationRuns.every((run) => run.exitCode === 0));
    assert.ok(evidence.artifacts.some(
      (artifact) =>
        artifact.path.endsWith(targetPath.replaceAll("/", path.sep)) &&
        artifact.content === targetContent &&
        artifact.sha256 === expectedSha256,
    ));
    const evaluation = checkpointedExecutionMission.output?.evaluation as
      | Readonly<Record<string, unknown>>
      | undefined;
    assert.equal(evaluation?.decision, "accepted");
    assert.equal(evaluation?.score, 100);
    assert.equal(checkpointedExecutionMission.output?.proofFilePath, targetPath);
    assert.equal(checkpointedExecutionMission.output?.proofContent, targetContent);
    assert.equal(checkpointedExecutionMission.output?.proofSha256, expectedSha256);
    assert.ok(Array.isArray(checkpointedExecutionMission.output?.verification));
    const beforeRecoveryStat = await stat(path.join(workspaceRoot, targetPath));

    await killApi(api);
    const missionStatePath = path.join(
      storageRoot,
      "forge-runtime",
      "missions.json",
    );
    const legacyState = JSON.parse(
      await readFile(missionStatePath, "utf8"),
    ) as {
      missions: {
        id: string;
        status: string;
        output: Readonly<Record<string, unknown>> | null;
      }[];
    };
    const legacyMission = legacyState.missions.find(
      (mission) => mission.id === executionMissionId,
    );
    assert.ok(legacyMission);
    legacyMission.status = "running";
    legacyMission.output = null;
    await writeFile(
      missionStatePath,
      JSON.stringify(legacyState, null, 2) + "\n",
      "utf8",
    );

    api = startApi();
    await waitForJson(`${baseUrl}/api/healthz`);
    const persistedCompletion = await waitForMissionStatus<{
      readonly status: string;
      readonly output?: Readonly<Record<string, unknown>>;
    }>(baseUrl, executionMissionId, "succeeded");
    const afterRecoveryStat = await stat(path.join(workspaceRoot, targetPath));
    assert.equal(afterRecoveryStat.mtimeMs, beforeRecoveryStat.mtimeMs);
    assert.equal(
      await readFile(path.join(workspaceRoot, targetPath), "utf8"),
      targetContent,
    );
    const recoveredEvidence =
      persistedCompletion.output?.executionEvidence as
        | {
            readonly receipts: readonly unknown[];
            readonly fileEffects: readonly unknown[];
            readonly verificationRuns: readonly {
              readonly exitCode: number;
            }[];
            readonly artifacts: readonly unknown[];
          }
        | undefined;
    assert.ok(recoveredEvidence);
    assert.ok(recoveredEvidence.receipts.length > 0);
    assert.equal(recoveredEvidence.fileEffects.length, 1);
    assert.ok(recoveredEvidence.verificationRuns.length > 0);
    assert.ok(
      recoveredEvidence.verificationRuns.every((run) => run.exitCode === 0),
    );
    assert.equal(recoveredEvidence.artifacts.length, 1);
    assert.equal(
      (persistedCompletion.output?.evaluation as {
        readonly decision: string;
        readonly score: number;
      }).decision,
      "accepted",
    );
    assert.equal(persistedCompletion.output?.proofFilePath, targetPath);
    assert.equal(persistedCompletion.output?.proofContent, targetContent);
    assert.equal(persistedCompletion.output?.proofSha256, expectedSha256);
    assert.ok(
      Array.isArray(persistedCompletion.output?.verification) &&
      persistedCompletion.output.verification.length === 2 &&
      persistedCompletion.output.verification.every(
        (result) =>
          typeof result === "object" &&
          result !== null &&
          "exitCode" in result &&
          result.exitCode === 0,
      ),
    );
    assert.deepEqual(persistedCompletion.output?.missionResult, {
      status: "completed",
      cause: "execution",
      message: "Mission completed successfully",
      producedAt: (persistedCompletion.output?.missionResult as {
        readonly producedAt: string;
      }).producedAt,
    });
    assert.equal(
      (persistedCompletion.output?.workspaceRecovery as {
        readonly legacyMigrated: boolean;
        readonly mutationReplayed: boolean;
        readonly validated: boolean;
      }).mutationReplayed,
      false,
    );
    assert.equal(
      (persistedCompletion.output?.workspaceRecovery as {
        readonly legacyMigrated: boolean;
        readonly mutationReplayed: boolean;
        readonly validated: boolean;
      }).validated,
      true,
    );
    assert.equal(
      (persistedCompletion.output?.workspaceRecovery as {
        readonly legacyMigrated: boolean;
      }).legacyMigrated,
      true,
    );

    const invalidTargetPath = "sandbox/mirror-final-stale-context-check.txt";
    const invalidObjective = rawObjective.replace(targetPath, invalidTargetPath);
    const invalidCreateResponse = await fetch(`${baseUrl}/api/missions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "operator.autonomous-cycle",
        title: "Production Ollama output diagnostics proof",
        input: {
          projectId: "forge-core",
          objective: invalidObjective.replace(/\s+/g, " ").trim(),
          rawObjective: invalidObjective,
          targets: [{ path: invalidTargetPath, allowCreate: true }],
          objectiveExecutionMode: "build-or-mutate",
          objectiveProfile: "generic-build",
          intakeObjectiveExecutionMode: "build-or-mutate",
          intakeObjectiveProfile: "generic-build",
          proofTargetPath: invalidTargetPath,
          cycleIndex: 1,
          maxCycles: 1,
          continuationAuthorized: false,
        },
      }),
    });
    assert.equal(
      invalidCreateResponse.status,
      202,
      await invalidCreateResponse.clone().text(),
    );
    const invalidCreated = await invalidCreateResponse.json() as {
      readonly id: string;
      readonly approval: { readonly id: string };
    };
    const invalidApprovalResponse = await fetch(
      `${baseUrl}/api/governance/approvals/${invalidCreated.approval.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: "production-binding-test" }),
      },
    );
    assert.equal(invalidApprovalResponse.status, 200);
    let invalidMission = await waitForJson<{
      readonly status: string;
      readonly output?: Readonly<Record<string, unknown>>;
    }>(`${baseUrl}/api/missions/${invalidCreated.id}`);
    const invalidStartedAt = Date.now();

    while (
      invalidMission.status !== "failed" &&
      invalidMission.status !== "succeeded" &&
      Date.now() - invalidStartedAt < 15_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      invalidMission = await waitForJson<typeof invalidMission>(
        `${baseUrl}/api/missions/${invalidCreated.id}`,
      );
    }

    assert.equal(invalidMission.status, "failed");
    assert.equal(
      (
        invalidMission as {
          readonly input?: { readonly proofTargetPath?: string };
        }
      ).input?.proofTargetPath,
      invalidTargetPath,
    );
    const diagnostics = invalidMission.output?.providerOutputDiagnostics as
      | Readonly<Record<string, unknown>>
      | undefined;
    assert.ok(diagnostics);
    assert.match(
      String(diagnostics.rawOutputExcerpt),
      /^\{/,
    );
    assert.match(
      String(diagnostics.rawOutputExcerpt),
      /mirror-generic-build-proof-16/,
    );
    assert.doesNotMatch(
      JSON.stringify(providerRequestBodies[1]),
      /mirror-generic-build-proof-16/,
    );
    assert.match(
      String(diagnostics.parseError),
      /Unsupported verification step: Confirm no secret material is persisted in runtime evidence/,
    );
    assert.equal(diagnostics.outputLength, liveInvalidOutput.length);
    assert.equal(
      diagnostics.outputFirst500,
      liveInvalidOutput.slice(0, 500),
    );
    assert.equal(
      diagnostics.outputLast500,
      liveInvalidOutput.slice(-500),
    );
    assert.equal(diagnostics.truncated, false);
    assert.equal(invalidMission.output?.executionEvidence, null);
    assert.equal(invalidMission.output?.workspaceExecutionMissionId, undefined);
    assert.equal(invalidMission.output?.workspaceExecutionApprovalId, undefined);
    const missionsAfterInvalid = await fetch(`${baseUrl}/api/missions`)
      .then((response) => response.json() as Promise<{
        readonly missions: readonly {
          readonly kind: string;
          readonly input: Readonly<Record<string, unknown>>;
        }[];
      }>);
    assert.ok(!missionsAfterInvalid.missions.some(
      (candidate) =>
        candidate.kind === "operator.workspace-change" &&
        candidate.input.sourceAutonomousMissionId === invalidCreated.id,
    ));
    await assert.rejects(
      readFile(path.join(workspaceRoot, invalidTargetPath), "utf8"),
    );
  } finally {
    await stopApi(api);
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(storageRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
