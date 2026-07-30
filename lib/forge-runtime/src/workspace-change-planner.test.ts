import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ForgeRuntime,
  parseWorkspaceProviderPlan,
  type AiProviderConnector,
} from "./index.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for workspace plan mission");
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("provider workspace planner", { concurrency: false }, async (t) => {
  await t.test("uses one provider call and requires separate execution approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forge-planner-root-"));
    const storage = await mkdtemp(path.join(os.tmpdir(), "forge-planner-state-"));
    const source = "before\n";
    await writeFile(path.join(root, "sample.txt"), source, "utf8");

    const original = new Map([
      ["STORAGE_DIR", process.env.STORAGE_DIR],
      ["FORGE_WORKSPACE_ROOT", process.env.FORGE_WORKSPACE_ROOT],
      ["FORGE_AI_PROVIDER", process.env.FORGE_AI_PROVIDER],
      ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
      ["OPENAI_MODEL", process.env.OPENAI_MODEL],
    ]);
    process.env.STORAGE_DIR = storage;
    process.env.FORGE_WORKSPACE_ROOT = root;
    process.env.FORGE_AI_PROVIDER = "openai-responses";
    process.env.OPENAI_API_KEY = "test-only-provider-key";
    process.env.OPENAI_MODEL = "test-model";
    let providerCalls = 0;

    const connector: AiProviderConnector = {
      id: "openai-responses",
      async execute() {
        providerCalls += 1;
        return Object.freeze({
          providerResponseId: "workspace-plan-response",
          outputText: JSON.stringify({
            schemaVersion: 1,
            summary:
              "Assumptions: sample.txt is the only approved target and its supplied SHA-256 still identifies the current source. Verification guidance: run typecheck and tests, then inspect the committed file and persisted executor evidence before accepting this bounded update.",
            changes: [{
              path: "sample.txt",
              expectedSha256: sha256(source),
              content: "after\n",
            }],
            verification: ["typecheck", "test"],
            commit: {
              message: "test: provider planned change",
              push: false,
            },
          }),
          usage: Object.freeze({
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
          }),
        });
      },
    };
    const runtime = new ForgeRuntime({
      aiProviderConnectors: [connector],
      missionLoopPollIntervalMs: 100,
    });

    try {
      await runtime.start();
      const created = await runtime.createMission({
        kind: "operator.workspace-plan",
        title: "Plan one bounded source change",
        input: {
          projectId: "forge-core",
          objective: "Change the sample only.",
          targets: [{ path: "sample.txt" }],
        },
      });

      assert.equal(created.mission.status, "awaiting_approval");
      assert.ok(created.approval);
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), source);

      await runtime.approveApproval(created.approval.id, "planner-test");
      await waitFor(
        () => runtime.getMission(created.mission.id)?.status === "succeeded",
      );

      assert.equal(providerCalls, 1);
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), source);

      const scheduled = await runtime.scheduleWorkspacePlan(created.mission.id);
      assert.equal(scheduled.executionMission.mission.status, "awaiting_approval");
      assert.ok(scheduled.executionMission.approval);
      assert.equal(scheduled.plan.request.commit?.push, false);
      assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), source);
      assert.ok(
        runtime.snapshot().events.some(
          (event) => event.type === "workspace.plan.scheduled",
        ),
      );
      await runtime.stop();
    } finally {
      for (const [key, value] of original) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      await rm(root, { recursive: true, force: true });
      await rm(storage, { recursive: true, force: true });
    }
  });

  await t.test("rejects unapproved paths and changed source hashes", () => {
    const target = {
      path: "sample.txt",
      expectedSha256: sha256("before\n"),
      exists: true,
    } as const;
    const base = {
      missionId: "plan-mission",
      projectId: "forge-core",
      objective: "Bounded change",
      targets: [target],
      compositionId: "composition",
      executionId: "execution",
    } as const;

    assert.throws(() => parseWorkspaceProviderPlan({
      ...base,
      outputText: JSON.stringify({
        schemaVersion: 1,
        summary: "Escape target",
        changes: [{ path: "other.txt", expectedSha256: null, content: "x" }],
        verification: ["typecheck"],
        commit: { message: "test: rejected path", push: false },
      }),
    }), /unapproved target path/);

    assert.throws(() => parseWorkspaceProviderPlan({
      ...base,
      outputText: JSON.stringify({
        schemaVersion: 1,
        summary: "Ignore precondition",
        changes: [{ path: "sample.txt", expectedSha256: null, content: "x" }],
        verification: ["typecheck"],
        commit: { message: "test: rejected hash", push: false },
      }),
    }), /changed the source precondition/);
  });

  await t.test("extracts exactly one wrapped JSON object and diagnoses invalid output", () => {
    const base = {
      missionId: "live-proof-14",
      projectId: "forge-core",
      objective: "Create the approved proof file",
      targets: [{
        path: "sandbox/mirror-generic-build-proof-14.txt",
        expectedSha256: null,
        exists: false,
      }],
      compositionId: "composition",
      executionId: "execution",
    } as const;
    const validPlan = {
      schemaVersion: 1,
      summary: "Assumptions and verification guidance for one approved file.",
      changes: [{
        path: "sandbox/mirror-generic-build-proof-14.txt",
        expectedSha256: null,
        content: "Forge generic-build live approval proof\n",
      }],
      verification: ["typecheck"],
      commit: { message: "test: proof 14", push: false },
    };
    const parsed = parseWorkspaceProviderPlan({
      ...base,
      outputText: [
        "The requested plan follows.",
        "```json",
        JSON.stringify(validPlan),
        "```",
      ].join("\n"),
    });
    assert.equal(
      parsed.request.changes[0].path,
      "sandbox/mirror-generic-build-proof-14.txt",
    );

    assert.throws(
      () => parseWorkspaceProviderPlan({
        ...base,
        outputText: "```json\n{\"schemaVersion\":1\n```",
      }),
      /no valid JSON object \(unterminated object at offset 8\)/,
    );
    assert.throws(
      () => parseWorkspaceProviderPlan({
        ...base,
        outputText: `${JSON.stringify(validPlan)}\n${JSON.stringify(validPlan)}`,
      }),
      /contains 2 valid JSON objects; exactly one is required/,
    );
  });
});
