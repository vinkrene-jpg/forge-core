import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  ForgeRuntime,
  type ApprovalRecord,
  type MissionRecord,
} from "@workspace/forge-runtime";
import {
  MirrorProjectionService,
  MirrorProjectionTimeoutError,
  type MirrorProjectionSource,
} from "../lib/mirrorProjection";
import { createMirrorRouter } from "../routes/mirror";
import { createMissionIntakeRouter } from "../routes/operator";

async function startApi(runtime: ForgeRuntime): Promise<{
  readonly server: ReturnType<typeof createServer>;
  readonly baseUrl: string;
}> {
  const app = express();
  app.use(express.json());
  app.use("/api", createMissionIntakeRouter(runtime));
  app.use("/api", createMirrorRouter(runtime));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeApi(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function listMission(index: number): MissionRecord {
  const occurredAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    id: `mission-${String(index).padStart(4, "0")}`,
    kind: "runtime.self-check",
    title: `Mission ${index}`,
    status: "succeeded",
    createdAt: occurredAt,
    updatedAt: occurredAt,
    startedAt: occurredAt,
    completedAt: occurredAt,
    attempts: 1,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: `Check ${index}` },
    output: { missionResult: { message: `Completed ${index}` } },
    lastError: null,
  };
}

test("Mirror list loads each source once and stays compact at current scale", () => {
  const missions = Array.from({ length: 3_015 }, (_, index) => listMission(index));
  const calls = {
    missions: 0,
    approvals: 0,
    executions: 0,
    observations: 0,
    memories: 0,
  };
  const source: MirrorProjectionSource = {
    listMissions: () => { calls.missions += 1; return missions; },
    listApprovals: () => { calls.approvals += 1; return []; },
    listAiExecutions: () => { calls.executions += 1; return []; },
    listLearningObservations: () => { calls.observations += 1; return []; },
    listProjectMemories: () => { calls.memories += 1; return []; },
  };

  const startedAt = performance.now();
  const result = new MirrorProjectionService(source).listMissions();
  const durationMs = performance.now() - startedAt;

  assert.equal(result.length, missions.length);
  assert.ok(durationMs < 2_000, `Mirror list took ${durationMs.toFixed(1)}ms`);
  assert.deepEqual(calls, {
    missions: 1,
    approvals: 1,
    executions: 1,
    observations: 1,
    memories: 1,
  });
  assert.deepEqual(Object.keys(result[0] ?? {}).sort(), [
    "eventCount",
    "firstOccurredAt",
    "integrityWarnings",
    "lastOccurredAt",
    "missionId",
    "status",
    "title",
  ]);
});

test("Mirror list fails with a bounded timeout error", () => {
  const mission = listMission(1);
  const source: MirrorProjectionSource = {
    listMissions: () => {
      const blockedUntil = performance.now() + 5;
      while (performance.now() < blockedUntil) {
      }
      return [mission];
    },
    listApprovals: () => [],
    listAiExecutions: () => [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };

  assert.throws(
    () => new MirrorProjectionService(source).listMissions(1),
    MirrorProjectionTimeoutError,
  );
});

test("Mirror list route returns 503 when projection exceeds its deadline", async () => {
  const mission = listMission(1);
  const source: MirrorProjectionSource = {
    listMissions: () => {
      const blockedUntil = performance.now() + 1_300;
      while (performance.now() < blockedUntil) {
      }
      return [mission];
    },
    listApprovals: () => [],
    listAiExecutions: () => [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };
  const app = express();
  app.use("/api", createMirrorRouter(source));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/mirror/missions`,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Mirror mission list projection timed out",
    });
  } finally {
    await closeApi(server);
  }
});

test("Mirror projection uses deterministic tie breakers and reports duplicates", () => {
  const occurredAt = "2026-01-02T03:04:05.000Z";
  const mission: MissionRecord = {
    id: "mission-1",
    kind: "operator.workspace-change",
    title: "Deterministic projection",
    status: "awaiting_approval",
    createdAt: occurredAt,
    updatedAt: occurredAt,
    startedAt: null,
    completedAt: null,
    attempts: 0,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: "Project one mission" },
    output: null,
    lastError: null,
  };
  const approval: ApprovalRecord = {
    id: "approval-1",
    missionId: mission.id,
    status: "pending",
    assessment: {
      policyVersion: "1.0.0",
      action: "mission.execute",
      missionKind: mission.kind,
      riskLevel: "high",
      decision: "require_approval",
      reason: "Explicit operator approval is required",
      assessedAt: occurredAt,
    },
    createdAt: occurredAt,
    updatedAt: occurredAt,
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
  const source: MirrorProjectionSource = {
    listMissions: () => [mission],
    listApprovals: () => [approval, approval],
    listAiExecutions: () => [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };

  const first = new MirrorProjectionService(source).getMission(mission.id);
  const second = new MirrorProjectionService(source).getMission(mission.id);
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.deepEqual(
    first.timeline.map((event) => event.sequence),
    first.timeline.map((_, index) => index + 1),
  );
  assert.deepEqual(
    first.timeline.slice(0, 3).map((event) => event.eventType),
    ["input_received", "interpretation_created", "approval_requested"],
  );
  assert.equal(first.duplicateWarnings.length, 1);
  assert.ok(first.timeline.some((event) =>
    event.integrityFlags.includes("duplicate_source")));
});

test("Mirror marks missing approval and evidence without inventing records", () => {
  const mission: MissionRecord = {
    id: "mission-missing-links",
    kind: "operator.workspace-change",
    title: "Missing links",
    status: "awaiting_approval",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    startedAt: null,
    completedAt: null,
    attempts: 0,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: "Show missing links" },
    output: null,
    lastError: null,
  };
  const source: MirrorProjectionSource = {
    listMissions: () => [mission],
    listApprovals: () => [],
    listAiExecutions: () => [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };
  const projection = new MirrorProjectionService(source).getMission(mission.id);
  assert.ok(projection);
  assert.ok(projection.missingLinks.includes("approval"));
  assert.equal(projection.approvals.length, 0);
  assert.equal(projection.evidence.length, 0);
});

test("Mirror correlates runtime audit and artifacts through missionId", () => {
  const mission: MissionRecord = {
    id: "mission-evidence",
    kind: "operator.workspace-change",
    title: "Correlated evidence",
    status: "succeeded",
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:05:05.000Z",
    startedAt: "2026-01-02T03:04:10.000Z",
    completedAt: "2026-01-02T03:05:05.000Z",
    attempts: 1,
    interruptedCount: 0,
    input: { projectId: "forge-core", objective: "Produce evidence" },
    output: {
      executionEvidence: {
        receipts: [{
          id: "receipt-1",
          action: "write-file",
          targetPath: "sandbox/proof.txt",
          completedAt: "2026-01-02T03:04:30.000Z",
          ok: true,
        }],
        artifacts: [{
          id: "artifact-1",
          kind: "file-hash-proof",
          path: "sandbox/proof.txt",
          sha256: "a".repeat(64),
        }],
      },
      missionResult: {
        status: "completed",
        cause: "execution",
        message: "Evidence produced",
        producedAt: "2026-01-02T03:05:05.000Z",
      },
    },
    lastError: null,
  };
  const source: MirrorProjectionSource = {
    listMissions: () => [mission],
    listApprovals: () => [],
    listAiExecutions: () => [],
    listLearningObservations: () => [],
    listProjectMemories: () => [],
  };
  const projection = new MirrorProjectionService(source).getMission(mission.id);
  assert.ok(projection);
  assert.equal(projection.artifacts[0]?.missionId, mission.id);
  assert.ok(projection.timeline.some((event) =>
    event.sourceType === "runtime_audit" && event.missionId === mission.id));
  assert.ok(projection.timeline.some((event) =>
    event.sourceType === "artifact" && event.missionId === mission.id));
  assert.equal(projection.missingLinks.includes("evidence"), false);

  const withoutEvidence = new MirrorProjectionService({
    ...source,
    listMissions: () => [{ ...mission, output: mission.output?.missionResult
      ? { missionResult: mission.output.missionResult }
      : null }],
  }).getMission(mission.id);
  assert.ok(withoutEvidence?.missingLinks.includes("evidence"));
});

test(
  "Mirror API is read-only and projects one intake identically after restart",
  { concurrency: false },
  async () => {
    const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-mirror-"));
    const originalStorage = process.env.STORAGE_DIR;
    const originalAutonomy = process.env.FORGE_AUTONOMY_ENABLED;
    let runtime: ForgeRuntime | null = null;
    let server: ReturnType<typeof createServer> | null = null;

    try {
      process.env.STORAGE_DIR = storageRoot;
      process.env.FORGE_AUTONOMY_ENABLED = "false";
      runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
      await runtime.start();
      let api = await startApi(runtime);
      server = api.server;

      const intakeResponse = await fetch(
        `${api.baseUrl}/api/operator/mission-intake/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: "Maak sandbox/mirror-restart-proof.txt met restartbewijs.",
          }),
        },
      );
      assert.equal(intakeResponse.status, 202, await intakeResponse.clone().text());
      const intake = await intakeResponse.json() as {
        readonly mission: MissionRecord;
      };
      assert.equal(runtime.listMissions().length, 1);
      assert.equal(intake.mission.status, "awaiting_approval");
      const intakeMemories = runtime
        .listProjectMemories("forge-core")
        .filter((memory) => memory.source === "desktop-mission-intake");
      assert.equal(intakeMemories.length, 2);

      const firstListResponse = await fetch(`${api.baseUrl}/api/mirror/missions`);
      assert.equal(firstListResponse.status, 200);
      const firstListBody = await firstListResponse.text();
      const secondListResponse = await fetch(`${api.baseUrl}/api/mirror/missions`);
      assert.equal(secondListResponse.status, 200);
      const secondListBody = await secondListResponse.text();
      assert.equal(secondListBody, firstListBody);
      const list = JSON.parse(firstListBody) as { readonly missions: readonly unknown[] };
      assert.equal(list.missions.length, 1);

      const projectionResponse = await fetch(
        `${api.baseUrl}/api/mirror/missions/${intake.mission.id}`,
      );
      assert.equal(projectionResponse.status, 200);
      const beforeRestart = await projectionResponse.json();

      const unknownResponse = await fetch(
        `${api.baseUrl}/api/mirror/missions/unknown-mission-id`,
      );
      assert.equal(unknownResponse.status, 404);

      const writeResponse = await fetch(
        `${api.baseUrl}/api/mirror/missions/${intake.mission.id}`,
        { method: "POST" },
      );
      assert.equal(writeResponse.status, 404);

      await closeApi(server);
      server = null;
      await runtime.stop();
      runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
      await runtime.start();
      api = await startApi(runtime);
      server = api.server;

      const restartedResponse = await fetch(
        `${api.baseUrl}/api/mirror/missions/${intake.mission.id}`,
      );
      assert.equal(restartedResponse.status, 200);
      assert.deepEqual(await restartedResponse.json(), beforeRestart);

      const storedPaths = await readdir(storageRoot, { recursive: true });
      assert.equal(storedPaths.some((entry) => entry.toLowerCase().includes("mirror")), false);
    } finally {
      if (server) await closeApi(server);
      if (runtime) await runtime.stop();
      if (originalStorage === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = originalStorage;
      if (originalAutonomy === undefined) delete process.env.FORGE_AUTONOMY_ENABLED;
      else process.env.FORGE_AUTONOMY_ENABLED = originalAutonomy;
      await rm(storageRoot, { recursive: true, force: true });
    }
  },
);