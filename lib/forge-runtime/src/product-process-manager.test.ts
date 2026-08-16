import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeEventBus } from "./event-bus.js";
import { NodeProductProcessManager } from "./product-process-manager.js";
import type { ProjectRecord } from "./operator.js";

test("product process manager starts and stops only its own child", async () => {
  const manager = new NodeProductProcessManager(new RuntimeEventBus());
  const product: ProjectRecord = {
    id: "process-proof",
    name: "Process proof",
    rootPath: process.cwd(),
    description: "Benign process lifecycle fixture",
    startCommand: [process.execPath, "-e", "setInterval(() => undefined, 1000)"],
    verificationCommand: [process.execPath, "--version"],
    origin: "forge-built",
    goal: "Prove bounded child lifecycle ownership.",
    sourceMissionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await manager.start(product);
  assert.equal(manager.isRunning(product.id), true);
  await manager.stop(product.id);
  assert.equal(manager.isRunning(product.id), false);
});