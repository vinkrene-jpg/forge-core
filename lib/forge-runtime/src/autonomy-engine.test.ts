import assert from "node:assert/strict";
import test from "node:test";
import { AutonomousEngine } from "./autonomy-engine.js";
import {
  AUTONOMY_STORE_VERSION,
  type AutonomyStateStore,
  type PersistedAutonomyState,
} from "./autonomy-store.js";
import { createInitialAutonomyState } from "./autonomy.js";
import { RuntimeEventBus } from "./event-bus.js";

test("stop drains persistence started before shutdown", async () => {
  let releasePersist!: () => void;
  let persistStarted!: () => void;
  const persistStartedPromise = new Promise<void>((resolve) => {
    persistStarted = resolve;
  });
  const releasePersistPromise = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  let blocked = false;
  const stateStore: AutonomyStateStore = {
    async load() {
      return Object.freeze({
        version: AUTONOMY_STORE_VERSION,
        state: Object.freeze({
          ...createInitialAutonomyState(),
          enabled: true,
          loopPauseReason: "test pause",
          loopPauseRequiresResume: true,
        }),
      });
    },
    async save(state: PersistedAutonomyState) {
      if (!blocked && state.state.loopStatus === "running") {
        blocked = true;
        persistStarted();
        await releasePersistPromise;
      }
    },
  };
  const engine = new AutonomousEngine({
    events: new RuntimeEventBus(),
    stateStore,
    pollIntervalMs: 60_000,
    listMissions: () => [],
    listApprovals: () => [],
    approveApproval: async () => undefined,
    createMission: async () => {
      throw new Error("No mission expected while paused");
    },
    listLearningProposals: () => [],
    listLearningProfiles: () => [],
    scheduleLearningProposal: async () => undefined,
    scheduleWorkspacePlan: async () => {
      throw new Error("No workspace plan expected while paused");
    },
    aiGatewaySummary: () => ({
      configured: false,
      providerId: null,
      model: null,
      executions: 0,
      succeeded: 0,
      failed: 0,
      unavailable: 0,
      totalEstimatedCostUsd: 0,
      dailyEstimatedCostUsd: 0,
      budgetLimitUsd: 0,
      budgetRemainingUsd: 0,
      byProvider: [],
      lastExecutionAt: null,
    }),
  });

  await engine.initialize();
  engine.start();
  await persistStartedPromise;

  let stopped = false;
  const stopPromise = engine.stop().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(stopped, false);

  releasePersist();
  await stopPromise;
  assert.equal(stopped, true);
});