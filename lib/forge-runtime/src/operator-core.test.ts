import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeEventBus } from "./event-bus.js";
import { OperatorCore } from "./operator-core.js";
import {
  createInitialOperatorState,
  type OperatorStateStore,
  type PersistedOperatorState,
} from "./operator-store.js";

test("operator core seeds products and registers Forge-created products idempotently", async () => {
  let state = createInitialOperatorState();
  const stateStore: OperatorStateStore = {
    async load() { return state; },
    async save(next: PersistedOperatorState) { state = next; },
  };
  const core = new OperatorCore({
    events: new RuntimeEventBus(),
    stateStore,
    defaultWorkspaceRoot: process.cwd(),
  });

  await core.initialize();
  assert.deepEqual(core.listProjects().map((project) => project.id), [
    "forge-core",
    "assumption-engine",
    "forge-cad-engine",
  ]);
  assert.equal(core.getProject("assumption-engine")?.origin, "introduced");
  assert.match(core.getProject("forge-cad-engine")?.goal ?? "", /3D game engine/);

  const request = {
    id: "generated-product",
    name: "Generated Product",
    rootPath: process.cwd() + "/../generated-product",
    startCommand: ["pnpm.cmd", "start"],
    verificationCommand: ["pnpm.cmd", "test"],
    origin: "forge-built" as const,
    goal: "Prove automatic product registration.",
    sourceMissionId: "mission-1",
  };
  await core.registerProject(request);
  await core.registerProject(request);

  const generated = core.listProjects().filter((project) => project.id === request.id);
  assert.equal(generated.length, 1);
  assert.equal(generated[0]?.sourceMissionId, "mission-1");
  assert.deepEqual(generated[0]?.verificationCommand, ["pnpm.cmd", "test"]);
});