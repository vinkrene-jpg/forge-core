import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ForgeRuntime } from "./runtime.js";
import type { ProductProcessController } from "./product-process-manager.js";
import type { ProjectRecord } from "./operator.js";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for product registration");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("runtime projects seeded products, auto-registers successful work and controls products", async () => {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "forge-products-"));
  const previousStorage = process.env.STORAGE_DIR;
  const running = new Set<string>();
  const starts: ProjectRecord[] = [];
  const controller: ProductProcessController = {
    isRunning: (projectId) => running.has(projectId),
    async start(product) { starts.push(product); running.add(product.id); },
    async stop(projectId) { running.delete(projectId); },
    async stopAll() { running.clear(); },
  };
  process.env.STORAGE_DIR = storageRoot;
  const runtime = new ForgeRuntime({
    missionLoopPollIntervalMs: 100,
    productProcessController: controller,
  });

  try {
    await runtime.start();
    assert.deepEqual(runtime.listOperatorProjects().map((project) => project.id), [
      "forge-core",
      "assumption-engine",
      "forge-cad-engine",
    ]);

    const created = await runtime.createMission({
      kind: "runtime.self-check",
      input: {
        productRegistration: {
          id: "generated-product",
          name: "Generated Product",
          rootPath: path.resolve(process.cwd(), "..", "generated-product"),
          startCommand: ["pnpm.cmd", "start"],
          verificationCommand: ["pnpm.cmd", "test"],
          origin: "forge-built",
          goal: "Prove successful automatic registration.",
        },
      },
    });
    await waitFor(() => runtime.getMission(created.mission.id)?.status === "succeeded");
    await waitFor(() => runtime.getOperatorProject("generated-product") !== null);
    assert.equal(runtime.getOperatorProject("generated-product")?.sourceMissionId, created.mission.id);

    const overview = await runtime.listProductOverview();
    const forge = overview.find((entry) => entry.product.id === "forge-core");
    assert.equal(forge?.running, true);
    assert.equal(forge?.canStop, false);

    await runtime.startProduct("assumption-engine");
    assert.equal(starts[0]?.id, "assumption-engine");
    assert.equal((await runtime.listProductOverview()).find((entry) => entry.product.id === "assumption-engine")?.running, true);
    await runtime.stopProduct("assumption-engine");
    assert.equal(running.size, 0);
  } finally {
    await runtime.stop();
    if (previousStorage === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorage;
    await rm(storageRoot, { recursive: true, force: true });
  }
});
