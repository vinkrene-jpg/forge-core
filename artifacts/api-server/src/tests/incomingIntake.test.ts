import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CreateMissionRequest } from "@workspace/forge-runtime";
import {
  buildIntakeBodyFromContent,
  isIntakeFile,
  processIncomingDirectory,
  resolveIncomingConfig,
  type IncomingIntakeDeps,
} from "../lib/incomingIntake";

function configFor(root: string) {
  return {
    dir: root,
    processedDir: path.join(root, "processed"),
    failedDir: path.join(root, "failed"),
  };
}

function recordingCreateMission() {
  const requests: CreateMissionRequest[] = [];
  let counter = 0;
  const createMission: IncomingIntakeDeps["createMission"] = async (request) => {
    requests.push(request);
    counter += 1;
    return { mission: { id: `mission-${counter}` } };
  };
  return { requests, createMission };
}

async function withDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-incoming-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("buildIntakeBodyFromContent reads a JSON intake body and a plain-text objective", () => {
  const fromJson = buildIntakeBodyFromContent(
    JSON.stringify({ objective: "Do the JSON thing", priority: "high" }),
    "task-alpha.json",
  );
  assert.equal(fromJson.objective, "Do the JSON thing");
  assert.equal(fromJson.priority, "HIGH");
  assert.equal(fromJson.requestId, "incoming-task-alpha");
  assert.equal(fromJson.requestedBy, "incoming-folder");

  const fromText = buildIntakeBodyFromContent(
    "Build the widget\nwith care",
    "note beta.txt",
  );
  assert.equal(fromText.title, "Build the widget");
  assert.equal(fromText.objective, "Build the widget with care");
  assert.equal(fromText.requestId, "incoming-note-beta");
});

test("isIntakeFile accepts intake files and ignores the rest", () => {
  assert.equal(isIntakeFile("a.json"), true);
  assert.equal(isIntakeFile("b.txt"), true);
  assert.equal(isIntakeFile("c.md"), true);
  assert.equal(isIntakeFile("d.png"), false);
  assert.equal(isIntakeFile(".hidden.json"), false);
  assert.equal(isIntakeFile("b.txt.error.txt"), false);
});

test("resolveIncomingConfig honours overrides and defaults", () => {
  const custom = resolveIncomingConfig({
    FORGE_INCOMING_DIR: "/data/incoming",
    FORGE_INCOMING_FAILED_DIR: "/data/rejected",
  } as NodeJS.ProcessEnv);
  assert.equal(custom.dir, "/data/incoming");
  assert.equal(custom.processedDir, path.join("/data/incoming", "processed"));
  assert.equal(custom.failedDir, "/data/rejected");
});

test("a dropped file becomes an inert Mirror intake mission and moves to processed", async () => {
  await withDir(async (root) => {
    await writeFile(path.join(root, "job-1.txt"), "Ingest the report and summarise it", "utf8");
    const { requests, createMission } = recordingCreateMission();

    const summary = await processIncomingDirectory({ config: configFor(root), createMission });

    assert.equal(summary.processed.length, 1);
    assert.equal(summary.failed.length, 0);
    assert.equal(summary.processed[0]?.missionId, "mission-1");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.kind, "operator.mirror-intake");
    assert.equal(requests[0]?.input?.sourceType, "CLAUDE_MIRROR");
    assert.equal(requests[0]?.input?.objective, "Ingest the report and summarise it");

    assert.equal((await readdir(root)).includes("job-1.txt"), false);
    const processed = await readdir(path.join(root, "processed"));
    assert.equal(processed.some((name) => name.endsWith("job-1.txt")), true);
  });
});

test("an invalid file is quarantined to failed with an .error.txt and no mission", async () => {
  await withDir(async (root) => {
    await writeFile(path.join(root, "bad.json"), "{ not valid json", "utf8");
    await writeFile(path.join(root, "empty.txt"), "   ", "utf8");
    const { requests, createMission } = recordingCreateMission();

    const summary = await processIncomingDirectory({ config: configFor(root), createMission });

    assert.equal(requests.length, 0);
    assert.equal(summary.processed.length, 0);
    assert.equal(summary.failed.length, 2);

    const failed = await readdir(path.join(root, "failed"));
    assert.equal(failed.some((name) => name.endsWith("bad.json")), true);
    assert.equal(failed.includes("bad.json.error.txt"), true);
    assert.equal(failed.includes("empty.txt.error.txt"), true);
  });
});

test("non-intake files and subdirectories are ignored", async () => {
  await withDir(async (root) => {
    await writeFile(path.join(root, "image.png"), "binary", "utf8");
    await mkdir(path.join(root, "processed"), { recursive: true });
    const { requests, createMission } = recordingCreateMission();

    const summary = await processIncomingDirectory({ config: configFor(root), createMission });

    assert.equal(requests.length, 0);
    assert.equal(summary.processed.length, 0);
    assert.equal(summary.failed.length, 0);
    assert.equal((await readdir(root)).includes("image.png"), true);
  });
});

test("a missing incoming directory is created and treated as empty", async () => {
  await withDir(async (root) => {
    const dir = path.join(root, "not-there-yet");
    const { requests, createMission } = recordingCreateMission();

    const summary = await processIncomingDirectory({
      config: configFor(dir),
      createMission,
    });

    assert.equal(requests.length, 0);
    assert.equal(summary.processed.length, 0);
    assert.equal((await readdir(dir)).length >= 0, true);
  });
});
