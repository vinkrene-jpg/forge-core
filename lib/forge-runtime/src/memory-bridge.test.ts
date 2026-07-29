import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileMemoryBridge,
  ForgeRuntime,
  RuntimeEventBus,
  type AiProviderConnector,
} from "./index.js";

const environmentKeys = [
  "STORAGE_DIR",
  "FORGE_WORKSPACE_ROOT",
  "FORGE_AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "FORGE_AUTONOMY_ENABLED",
] as const;

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function withEnvironment(
  run: (storageRoot: string) => Promise<void>,
): Promise<void> {
  const original = new Map(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const storageRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-memory-bridge-"),
  );

  process.env.STORAGE_DIR = storageRoot;
  process.env.FORGE_WORKSPACE_ROOT = process.cwd();
  process.env.FORGE_AI_PROVIDER = "openai-responses";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
  process.env.FORGE_AUTONOMY_ENABLED = "false";

  try {
    await run(storageRoot);
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
  }
}

test("memory bridge stores and retrieves durable context", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forge-memory-bridge-local-"));

  try {
    const bridge = new FileMemoryBridge({
      events: new RuntimeEventBus(),
      rootPath: directory,
    });

    await bridge.initialize();

    await bridge.recordDecision({
      title: "Adopt bounded autonomy",
      content: "Low and medium risk approvals are auto-approved.",
      tags: ["governance", "autonomy"],
    });

    await bridge.recordLearning({
      title: "Provider fallback lesson",
      content: "Fallback to local/manual providers keeps loop alive.",
      tags: ["provider", "resilience"],
    });

    await bridge.recordCapability({
      title: "workspace.plan.validate",
      content: "Provider change plans are hash-bound and schema validated.",
      tags: ["capability"],
    });

    await bridge.upsertCurrentContext({
      summary: "Focus on provider bridge hardening.",
      priorities: ["memory bridge", "autonomous loop"],
      blockers: ["none"],
      activeMissionIds: ["m-1"],
    });

    const search = bridge.search({
      query: "provider fallback",
      limit: 5,
    });

    assert.ok(search.length >= 1);
    assert.equal(search[0].entry.kind, "lesson");

    const relevant = bridge.relevantContext({
      query: "governance autonomy",
      limit: 5,
    });

    assert.equal(
      relevant.currentContext.summary,
      "Focus on provider bridge hardening.",
    );
    assert.ok(relevant.relevant.length >= 1);
    assert.ok(bridge.summary().entries >= 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory bridge captures mission outcomes from runtime", async () => {
  await withEnvironment(async () => {
    let providerCalls = 0;
    const connector: AiProviderConnector = {
      id: "openai-responses",
      async execute() {
        providerCalls += 1;

        return Object.freeze({
          providerResponseId: `response-${providerCalls}`,
          outputText: [
            "# Memory bridge test step",
            "Implement deterministic capture of mission outcomes.",
            "",
            "## Assumptions",
            "Repository and runtime evidence are authoritative.",
            "",
            "## Verification",
            "Run runtime tests and inspect persisted memory files.",
          ].join("\n"),
          usage: Object.freeze({
            inputTokens: 120,
            outputTokens: 90,
            totalTokens: 210,
          }),
        });
      },
    };

    const runtime = new ForgeRuntime({
      aiProviderConnectors: [connector],
      missionLoopPollIntervalMs: 100,
      memoryBridgeRootPath: path.join(process.env.STORAGE_DIR!, "durable-memory"),
    });

    await runtime.start();

    const created = await runtime.createMission({
      kind: "operator.autonomous-cycle",
      title: "Memory bridge mission capture",
      input: {
        projectId: "forge-core",
        objective: "Capture mission output as durable lesson.",
        cycleIndex: 1,
        maxCycles: 1,
        files: [],
      },
    });

    assert.ok(created.approval);

    await runtime.approveApproval(
      created.approval.id,
      "memory-test",
      "approve autonomous capture",
    );

    await waitFor(() => {
      const mission = runtime.getMission(created.mission.id);
      return mission?.status === "succeeded";
    });

    await waitFor(() => runtime.memoryBridgeSummary().lessons >= 1);

    const relevant = runtime.memoryBridgeRelevantContext("durable lesson", 5);
    assert.ok(relevant.relevant.length >= 1);

    await runtime.stop();
  });
});
