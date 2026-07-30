import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const artifactDir = process.cwd();

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

test("production API bundle loads canonical runtime executor", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-dist-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "forge-dist-workspace-"));
  const apiPort = await availablePort();
  const providerPort = await availablePort();
  const targetPath = "sandbox/mirror-generic-build-proof-13.txt";
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
  const provider = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      id: "production-binding-plan",
      output_text: JSON.stringify({
        schemaVersion: 1,
        summary:
          "Assumptions: the approved target is one new sandbox proof file and no other repository content may change. Verification guidance: inspect the persisted plan, second approval, exact target path, receipts, file effects, verification runs, artifact hashes, and final evaluation before accepting this governed execution.",
        changes: [{
          path: targetPath,
          expectedSha256: null,
          content: "Forge generic-build live approval proof\n",
        }],
        verification: ["typecheck"],
        commit: {
          message: "test: production runtime binding",
          push: false,
        },
      }),
      usage: {
        input_tokens: 20,
        output_tokens: 30,
        total_tokens: 50,
      },
    }));
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
  await exec("git", ["add", "README.txt"], { cwd: workspaceRoot });
  await exec("git", ["commit", "-m", "test baseline"], { cwd: workspaceRoot });

  let output = "";
  const api = spawn(
    process.execPath,
    ["--enable-source-maps", "./dist/index.mjs"],
    {
      cwd: artifactDir,
      env: {
        ...process.env,
        PORT: String(apiPort),
        NODE_ENV: "production",
        STORAGE_DIR: storageRoot,
        FORGE_WORKSPACE_ROOT: workspaceRoot,
        FORGE_AI_PROVIDER: "openai-responses",
        FORGE_AUTONOMY_ENABLED: "false",
        OPENAI_API_KEY: "test-only-not-a-real-secret",
        OPENAI_MODEL: "test-model",
        OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  api.stdout.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-20_000);
  });
  api.stderr.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-20_000);
  });

  try {
    await waitForJson(`${`http://127.0.0.1:${apiPort}`}/api/healthz`);
    const baseUrl = `http://127.0.0.1:${apiPort}`;
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
    const snapshot = terminal.output?.preExecutionSnapshot as
      | Readonly<Record<string, unknown>>
      | undefined;
    assert.ok(snapshot);
    assert.match(String(snapshot.runtimeBuildSha), /^[0-9a-f]{40}$/);
    assert.match(String(snapshot.runtimeModulePath), /dist[\\/]index\.mjs$/);
    assert.equal(snapshot.intakeObjectiveExecutionMode, "build-or-mutate");
    assert.equal(snapshot.intakeObjectiveProfile, "generic-build");
    assert.equal(snapshot.effectiveObjectiveExecutionMode, "build-or-mutate");
    assert.equal(snapshot.effectiveObjectiveProfile, "generic-build");
    assert.match(output, /Forge runtime binding/);
  } finally {
    const exited = new Promise((resolve) => api.once("exit", resolve));
    api.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(storageRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
