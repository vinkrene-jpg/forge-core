import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "./capability-registry";
import { createInitialCapabilityState, type CapabilityStateStore } from "./capability-store";
import { RuntimeEventBus } from "./event-bus";

test("records a mission outcome gap idempotently", async () => {
  let state = createInitialCapabilityState();
  let saves = 0;
  const stateStore: CapabilityStateStore = {
    async load() {
      return state;
    },
    async save(next) {
      state = next;
      saves += 1;
    },
  };
  const registry = new CapabilityRegistry({
    events: new RuntimeEventBus(),
    stateStore,
  });
  await registry.initialize();
  saves = 0;

  const analysis = {
    id: "outcome-gap:mission-1:mission_failure:mission.loop.execute",
    objective: "Prevent repeated mission failure: provider unavailable",
    sourceType: "mission" as const,
    sourceMissionKind: "operator.autonomous-cycle" as const,
    sourceMissionId: "mission-1",
    outcomeType: "mission_failure" as const,
    outcomeCause: "provider unavailable",
    requirements: [{
      capabilityId: "mission.loop.execute",
      minimumStatus: "operational" as const,
      reason: "provider unavailable",
    }],
    gaps: [{
      capabilityId: "mission.loop.execute",
      requiredStatus: "operational" as const,
      actualStatus: "operational" as const,
      reason: "provider unavailable",
    }],
    decision: "improve_then_execute" as const,
    expectedReuse: 5,
    missionCriticality: 4,
    createdAt: "2026-08-15T00:00:00.000Z",
  };

  const first = await registry.recordAnalysis(analysis);
  const second = await registry.recordAnalysis({
    ...analysis,
    createdAt: "2026-08-16T00:00:00.000Z",
  });

  assert.equal(first.id, second.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(registry.listAnalyses().filter((item) => item.id === analysis.id).length, 1);
  assert.equal(saves, 1);
});

test("persists a historical outcome batch once", async () => {
  let state = createInitialCapabilityState();
  let saves = 0;
  const registry = new CapabilityRegistry({
    events: new RuntimeEventBus(),
    stateStore: {
      async load() { return state; },
      async save(next) { state = next; saves += 1; },
    },
  });
  await registry.initialize();
  saves = 0;
  const base = {
    objective: "Prevent a repeated historical failure",
    sourceType: "mission" as const,
    sourceMissionKind: "operator.autonomous-cycle" as const,
    outcomeType: "mission_failure" as const,
    requirements: [{ capabilityId: "mission.loop.execute", minimumStatus: "operational" as const, reason: "failure" }],
    gaps: [{ capabilityId: "mission.loop.execute", requiredStatus: "operational" as const, actualStatus: "operational" as const, reason: "failure" }],
    decision: "improve_then_execute" as const,
    expectedReuse: 5,
    missionCriticality: 4,
    createdAt: "2026-08-15T00:00:00.000Z",
  };
  const analyses = Array.from({ length: 1_000 }, (_, index) => ({
    ...base,
    id: `outcome-gap-${index}`,
    sourceMissionId: `mission-${index}`,
    outcomeCause: `cause-${index % 3}`,
  }));

  await registry.recordAnalyses(analyses);
  await registry.recordAnalyses(analyses);

  assert.equal(registry.listAnalyses().filter((item) => item.outcomeType).length, 1_000);
  assert.equal(saves, 1);
});