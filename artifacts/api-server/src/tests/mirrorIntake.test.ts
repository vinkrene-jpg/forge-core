import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { ForgeRuntime } from "@workspace/forge-runtime";
import { createMirrorRouter, parseMirrorIntakeBody } from "../routes/mirror";

const validBody = Object.freeze({
  requestId: "mirror-intake-test-1",
  title: "  Claude Mirror intake test  ",
  objective: "  Leg een gecontroleerde missie vast.  ",
  context: " Alleen intake; geen uitvoering. ",
  requestedBy: "test-operator",
  priority: "HIGH",
  projectId: 1,
  constraints: [" Geen automatische uitvoering. "],
  acceptanceCriteria: [" Eén missionrecord. "],
});

interface AuditCapture {
  readonly action: string;
  readonly targetId?: string | number | null;
}

async function startApi(runtime: ForgeRuntime, audits: AuditCapture[]) {
  const app = express();
  app.use(express.json());
  app.use("/api", createMirrorRouter(runtime, {
    projectExists: async (projectId) => projectId === 1,
    recordAudit: async (entry) => { audits.push(entry); },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeApi(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function post(baseUrl: string, body: Readonly<Record<string, unknown>>, role = "operator", actor = "test-operator") {
  return fetch(`${baseUrl}/api/mirror/missions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": String(body.requestId ?? ""),
      "X-Forge-Actor": actor,
      "X-Forge-Role": role,
    },
    body: JSON.stringify(body),
  });
}

test("Mirror intake validation normalizes fields and rejects unsafe input", () => {
  const parsed = parseMirrorIntakeBody(validBody);
  assert.equal(parsed.title, "Claude Mirror intake test");
  assert.equal(parsed.objective, "Leg een gecontroleerde missie vast.");
  assert.deepEqual(parsed.constraints, ["Geen automatische uitvoering."]);
  assert.throws(() => parseMirrorIntakeBody({ ...validBody, title: "" }), /title is required/);
  assert.throws(() => parseMirrorIntakeBody({ ...validBody, objective: "" }), /objective is required/);
  assert.throws(() => parseMirrorIntakeBody({ ...validBody, title: "x".repeat(161) }), /exceeds/);
  assert.throws(() => parseMirrorIntakeBody({ ...validBody, priority: "urgent" }), /priority is invalid/);
  assert.throws(() => parseMirrorIntakeBody({ ...validBody, context: "<script>alert(1)</script>" }), /unsafe/);
  assert.throws(() => parseMirrorIntakeBody({ ...validBody, context: "C:\\Users\\operator\\secret.txt" }), /unsafe/);
});

test("controlled Mirror intake creates one inert mission and survives restart", { concurrency: false }, async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-mirror-intake-"));
  const originalStorage = process.env.STORAGE_DIR;
  const originalAutonomy = process.env.FORGE_AUTONOMY_ENABLED;
  let runtime: ForgeRuntime | null = null;
  let server: ReturnType<typeof createServer> | null = null;
  const audits: AuditCapture[] = [];

  try {
    process.env.STORAGE_DIR = storageRoot;
    process.env.FORGE_AUTONOMY_ENABLED = "false";
    runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
    await runtime.start();
    let api = await startApi(runtime, audits);
    server = api.server;

    const unauthorized = await fetch(`${api.baseUrl}/api/mirror/missions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    assert.equal(unauthorized.status, 403);
    assert.equal((await post(api.baseUrl, validBody, "read-only")).status, 403);
    assert.equal((await post(api.baseUrl, validBody, "operator", "other-actor")).status, 403);
    assert.equal((await post(api.baseUrl, { ...validBody, title: "" })).status, 400);
    assert.equal((await post(api.baseUrl, { ...validBody, objective: "" })).status, 400);
    assert.equal((await post(api.baseUrl, { ...validBody, priority: "urgent" })).status, 400);
    assert.equal((await post(api.baseUrl, { ...validBody, title: "x".repeat(161) })).status, 400);
    assert.equal((await post(api.baseUrl, { ...validBody, projectId: 999 })).status, 400);
    assert.equal(runtime.listMissions().length, 0);

    const createdResponse = await post(api.baseUrl, validBody);
    assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
    const created = await createdResponse.json() as {
      readonly missionId: string;
      readonly status: string;
      readonly createdAt: string;
      readonly detailUrl: string;
    };
    assert.ok(created.missionId);
    assert.equal(created.status, "NOT_STARTED");
    assert.ok(created.createdAt);
    assert.equal(created.detailUrl, `/mirror/${created.missionId}`);
    assert.equal(runtime.listMissions().length, 1);
    assert.ok(audits.some((entry) =>
      entry.action === "mirror_mission_intake_created" && entry.targetId === created.missionId));

    const replay = await post(api.baseUrl, validBody);
    assert.equal(replay.status, 201);
    assert.equal((await replay.json() as { missionId: string }).missionId, created.missionId);
    assert.equal(runtime.listMissions().length, 1);

    const raceBody = { ...validBody, requestId: "mirror-intake-race-1", title: "Concurrent intake" };
    const [raceLeft, raceRight] = await Promise.all([
      post(api.baseUrl, raceBody),
      post(api.baseUrl, raceBody),
    ]);
    assert.equal(raceLeft.status, 201);
    assert.equal(raceRight.status, 201);
    const raceLeftId = (await raceLeft.json() as { missionId: string }).missionId;
    const raceRightId = (await raceRight.json() as { missionId: string }).missionId;
    assert.equal(raceRightId, raceLeftId);
    assert.equal(runtime.listMissions().filter((mission) => mission.input.idempotencyKey === raceBody.requestId).length, 1);

    const mission = runtime.getMission(created.missionId);
    assert.ok(mission);
    assert.equal(mission.kind, "operator.mirror-intake");
    assert.equal(mission.status, "not_started");
    assert.equal(mission.attempts, 0);
    assert.equal(mission.input.sourceType, "CLAUDE_MIRROR");
    assert.equal(mission.input.objective, "Leg een gecontroleerde missie vast.");
    assert.equal(runtime.listApprovals().filter((approval) => approval.missionId === mission.id).length, 0);
    assert.equal(runtime.listAiExecutions().filter((execution) => execution.missionId === mission.id).length, 0);

    const listResponse = await fetch(`${api.baseUrl}/api/mirror/missions`);
    const list = await listResponse.json() as { missions: readonly { missionId: string }[] };
    assert.equal(list.missions.filter((item) => item.missionId === mission.id).length, 1);
    const detailResponse = await fetch(`${api.baseUrl}/api/mirror/missions/${mission.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { timeline: readonly { eventType: string }[] };
    assert.equal(detail.timeline.filter((event) => event.eventType === "input_received").length, 1);
    assert.deepEqual(detail.timeline.map((event) => event.eventType), ["input_received"]);
    for (const forbidden of ["approval_requested", "approval_granted", "execution_started", "execution_completed", "guardian_reviewed", "governor_released", "governor_blocked"]) {
      assert.equal(detail.timeline.some((event) => event.eventType === forbidden), false);
    }
    const sessionResponse = await fetch(`${api.baseUrl}/api/mirror/session/${mission.id}`);
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json() as { status: string }).status, "NOT_STARTED");
    const resumeResponse = await fetch(`${api.baseUrl}/api/mirror/resume/${mission.id}`);
    assert.equal(resumeResponse.status, 200);
    assert.equal((await resumeResponse.json() as { resume: { resumeStatus: string } }).resume.resumeStatus, "NOT_STARTED");

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(runtime.getMission(mission.id)?.status, "not_started");
    assert.equal(runtime.getMission(mission.id)?.attempts, 0);

    await closeApi(server);
    server = null;
    await runtime.stop();
    runtime = new ForgeRuntime({ missionLoopPollIntervalMs: 100 });
    await runtime.start();
    api = await startApi(runtime, audits);
    server = api.server;
    assert.equal(runtime.getMission(mission.id)?.status, "not_started");
    assert.equal(runtime.getMission(mission.id)?.attempts, 0);
    assert.equal((await post(api.baseUrl, validBody).then((response) => response.json()) as { missionId: string }).missionId, mission.id);
    assert.equal(runtime.listMissions().filter((item) => item.input.idempotencyKey === validBody.requestId).length, 1);

    const storedPaths = await readdir(storageRoot, { recursive: true });
    assert.equal(storedPaths.some((entry) => /mirror|intake/i.test(entry)), false);
  } finally {
    if (server) await closeApi(server);
    if (runtime) await runtime.stop();
    if (originalStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = originalStorage;
    if (originalAutonomy === undefined) delete process.env.FORGE_AUTONOMY_ENABLED;
    else process.env.FORGE_AUTONOMY_ENABLED = originalAutonomy;
    await rm(storageRoot, { recursive: true, force: true });
  }
});