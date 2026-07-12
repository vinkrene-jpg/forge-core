import { randomUUID } from "node:crypto";
import {
  CapabilityAnalyzer,
} from "./capability-analysis";
import {
  CapabilityRegistry,
  type CapabilityRegistryOptions,
} from "./capability-registry";
import {
  FileCapabilityStateStore,
  type CapabilityStateStore,
} from "./capability-store";
import type {
  CapabilityAnalysisRecord,
  CapabilityAnalysisRequest,
  CapabilityRecord,
  CapabilitySummary,
  EvolutionPlanRecord,
  EvolutionPlanSummary,
  UpsertCapabilityRequest,
} from "./capability";
import {
  RuntimeEventBus,
  type RuntimeEvent,
  type RuntimeEventListener,
} from "./event-bus";
import {
  EvolutionEngine,
  type EvolutionEngineOptions,
} from "./evolution-engine";
import { EvolutionPlanner } from "./evolution-planner";
import {
  GovernanceEngine,
  type GovernanceEngineOptions,
} from "./governance-engine";
import type {
  ApprovalDecisionResult,
  ApprovalRecord,
  ApprovalStatus,
  GovernanceSummary,
} from "./governance";
import {
  FileGovernanceStateStore,
  type GovernanceStateStore,
} from "./governance-store";
import {
  ForgeKernel,
  type RuntimeHealthSnapshot,
} from "./kernel";
import {
  MissionEngine,
  type MissionEngineOptions,
} from "./mission-engine";
import { MissionLoop } from "./mission-loop";
import {
  FileMissionStateStore,
  type MissionStateStore,
} from "./mission-store";
import type {
  CreateMissionRequest,
  MissionLoopSnapshot,
  MissionRecord,
  MissionSummary,
} from "./mission";
import {
  createInitialRuntimeState,
  FileRuntimeStateStore,
  type PersistedRuntimeState,
  type RuntimeStateStore,
} from "./persistence";
import type {
  KernelStateSnapshot,
  KernelStatus,
} from "./runtime-state";

export interface RuntimeMissionCreationResult {
  readonly mission: MissionRecord;
  readonly governance: import("./governance").GovernanceAssessment;
  readonly approval: ApprovalRecord | null;
  readonly capabilityAnalysis: CapabilityAnalysisRecord;
}

export interface ForgeRuntimeSnapshot {
  readonly kernel: KernelStateSnapshot;
  readonly health: RuntimeHealthSnapshot;
  readonly persistence: PersistedRuntimeState;
  readonly missionLoop: MissionLoopSnapshot;
  readonly missions: MissionSummary;
  readonly governance: GovernanceSummary;
  readonly capabilities: CapabilitySummary;
  readonly evolution: EvolutionPlanSummary;
  readonly events: readonly RuntimeEvent[];
}

export interface ForgeRuntimeOptions {
  readonly stateStore?: RuntimeStateStore;
  readonly missionStateStore?: MissionStateStore;
  readonly governanceStateStore?: GovernanceStateStore;
  readonly capabilityStateStore?: CapabilityStateStore;
  readonly missionLoopPollIntervalMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

export class ForgeRuntime {
  readonly #events = new RuntimeEventBus();
  readonly #kernel = new ForgeKernel(this.#events);
  readonly #stateStore: RuntimeStateStore;
  readonly #missionEngine: MissionEngine;
  readonly #governanceEngine: GovernanceEngine;
  readonly #capabilityRegistry: CapabilityRegistry;
  readonly #capabilityAnalyzer: CapabilityAnalyzer;
  readonly #evolutionPlanner: EvolutionPlanner;
  readonly #evolutionEngine: EvolutionEngine;
  readonly #missionLoop: MissionLoop;
  #persistence = createInitialRuntimeState();

  constructor(options: ForgeRuntimeOptions = {}) {
    this.#stateStore =
      options.stateStore ?? new FileRuntimeStateStore();

    const missionOptions: MissionEngineOptions = {
      events: this.#events,
      getRuntimeHealth: () => this.#kernel.healthSnapshot(),
      stateStore:
        options.missionStateStore ??
        new FileMissionStateStore(),
    };

    this.#missionEngine = new MissionEngine(missionOptions);

    const governanceOptions: GovernanceEngineOptions = {
      events: this.#events,
      stateStore:
        options.governanceStateStore ??
        new FileGovernanceStateStore(),
    };

    this.#governanceEngine =
      new GovernanceEngine(governanceOptions);

    const capabilityOptions: CapabilityRegistryOptions = {
      events: this.#events,
      stateStore:
        options.capabilityStateStore ??
        new FileCapabilityStateStore(),
    };

    this.#capabilityRegistry =
      new CapabilityRegistry(capabilityOptions);

    this.#capabilityAnalyzer =
      new CapabilityAnalyzer(this.#capabilityRegistry);

    this.#evolutionPlanner =
      new EvolutionPlanner(this.#capabilityRegistry);

    const evolutionOptions: EvolutionEngineOptions = {
      registry: this.#capabilityRegistry,
      events: this.#events,
      getEventHistory: () => this.#events.snapshot(),
    };

    this.#evolutionEngine =
      new EvolutionEngine(evolutionOptions);

    this.#missionLoop = new MissionLoop({
      engine: this.#missionEngine,
      events: this.#events,
      pollIntervalMs:
        options.missionLoopPollIntervalMs ?? 500,
    });
  }

  async #persist(
    next: PersistedRuntimeState,
  ): Promise<PersistedRuntimeState> {
    const frozen = Object.freeze({ ...next });

    await this.#stateStore.save(frozen);
    this.#persistence = frozen;

    return frozen;
  }

  async #reconcileGovernanceState(): Promise<void> {
    const awaiting = this.#missionEngine
      .list()
      .filter(
        (mission) =>
          mission.status === "awaiting_approval",
      );

    for (const mission of awaiting) {
      let approval =
        this.#governanceEngine.findByMissionId(mission.id);

      if (approval === null) {
        const assessment = this.#governanceEngine.assess({
          kind: mission.kind,
          title: mission.title,
          input: mission.input,
        });

        approval =
          await this.#governanceEngine.requestApproval(
            mission.id,
            assessment,
          );
      }

      if (approval.status === "approved") {
        await this.#missionEngine.approve(mission.id);
      } else if (approval.status === "rejected") {
        await this.#missionEngine.reject(
          mission.id,
          approval.note ?? "Rejected by governance",
        );
      }
    }
  }

  async start(): Promise<KernelStateSnapshot> {
    const current = this.#kernel.stateSnapshot();

    if (current.status === "running") {
      return current;
    }

    const loaded = await this.#stateStore.load();
    const base = loaded ?? this.#persistence;

    this.#events.publish(
      loaded
        ? "runtime.state.loaded"
        : "runtime.state.initialized",
      {
        runtimeId: base.runtimeId,
        restartCount: base.restartCount,
        recoveryCount: base.recoveryCount,
      },
    );

    const recoveredFromStatus: KernelStatus | null =
      !base.lastShutdownClean &&
      base.lastKnownKernelStatus !== "stopped"
        ? base.lastKnownKernelStatus
        : null;

    if (recoveredFromStatus !== null) {
      this.#events.publish("runtime.recovery.detected", {
        runtimeId: base.runtimeId,
        previousSessionId: base.sessionId,
        recoveredFromStatus,
      });
    }

    const startingAt = new Date().toISOString();

    await this.#persist({
      ...base,
      sessionId: randomUUID(),
      restartCount: base.restartCount + 1,
      recoveryCount:
        base.recoveryCount +
        (recoveredFromStatus === null ? 0 : 1),
      lastKnownKernelStatus: "starting",
      updatedAt: startingAt,
      lastShutdownClean: false,
      recoveredFromStatus,
      lastError: null,
    });

    try {
      const running = await this.#kernel.start();

      await this.#persist({
        ...this.#persistence,
        lastKnownKernelStatus: "running",
        lastStartedAt: running.startedAt,
        updatedAt: new Date().toISOString(),
        lastShutdownClean: false,
        lastError: null,
      });

      await this.#missionEngine.initialize();
      await this.#governanceEngine.initialize();
      await this.#capabilityRegistry.initialize();
      await this.#reconcileGovernanceState();

      this.#missionLoop.start();

      return running;
    } catch (error) {
      await this.#persist({
        ...this.#persistence,
        lastKnownKernelStatus: "failed",
        updatedAt: new Date().toISOString(),
        lastShutdownClean: false,
        lastError: errorMessage(error),
      });

      throw error;
    }
  }

  async stop(): Promise<KernelStateSnapshot> {
    await this.#missionLoop.stop();

    const stopped = await this.#kernel.stop();
    const stoppedAt = new Date().toISOString();

    await this.#persist({
      ...this.#persistence,
      lastKnownKernelStatus: "stopped",
      lastStoppedAt: stoppedAt,
      updatedAt: stoppedAt,
      lastShutdownClean: true,
      recoveredFromStatus: null,
      lastError: null,
    });

    return stopped;
  }

  subscribe(listener: RuntimeEventListener): () => void {
    return this.#events.subscribe(listener);
  }

  async createMission(
    request: CreateMissionRequest,
  ): Promise<RuntimeMissionCreationResult> {
    const capabilityAnalysis =
      await this.#capabilityAnalyzer.analyzeMission(request);

    if (capabilityAnalysis.decision !== "execute_directly") {
      const plan = await this.#evolutionPlanner.createPlan(
        capabilityAnalysis.id,
      );

      throw new Error(
        `Mission requires capability improvement; evolution plan ${plan.id} created`,
      );
    }

    const governance =
      this.#governanceEngine.assess(request);

    if (governance.decision === "allow") {
      const mission =
        await this.#missionEngine.enqueue(
          request,
          "queued",
        );

      this.#missionLoop.wake();

      return Object.freeze({
        mission,
        governance,
        approval: null,
        capabilityAnalysis,
      });
    }

    if (governance.decision === "require_approval") {
      const mission =
        await this.#missionEngine.enqueue(
          request,
          "awaiting_approval",
        );

      const approval =
        await this.#governanceEngine.requestApproval(
          mission.id,
          governance,
        );

      return Object.freeze({
        mission,
        governance,
        approval,
        capabilityAnalysis,
      });
    }

    const mission =
      await this.#missionEngine.enqueue(
        request,
        "awaiting_approval",
      );

    const rejected =
      await this.#missionEngine.reject(
        mission.id,
        governance.reason,
      );

    return Object.freeze({
      mission: rejected,
      governance,
      approval: null,
      capabilityAnalysis,
    });
  }

  listMissions(): readonly MissionRecord[] {
    return this.#missionEngine.list();
  }

  getMission(missionId: string): MissionRecord | null {
    return this.#missionEngine.get(missionId);
  }

  listApprovals(
    status?: ApprovalStatus,
  ): readonly ApprovalRecord[] {
    return this.#governanceEngine.listApprovals(status);
  }

  getApproval(
    approvalId: string,
  ): ApprovalRecord | null {
    return this.#governanceEngine.getApproval(approvalId);
  }

  governanceSummary(): GovernanceSummary {
    return this.#governanceEngine.summary();
  }

  async approveApproval(
    approvalId: string,
    actor: string,
    note?: string,
  ): Promise<ApprovalDecisionResult> {
    const approval =
      await this.#governanceEngine.approve(
        approvalId,
        actor,
        note,
      );

    const mission =
      await this.#missionEngine.approve(
        approval.missionId,
      );

    this.#missionLoop.wake();

    return Object.freeze({
      approval,
      mission,
    });
  }

  async rejectApproval(
    approvalId: string,
    actor: string,
    note?: string,
  ): Promise<ApprovalDecisionResult> {
    const approval =
      await this.#governanceEngine.reject(
        approvalId,
        actor,
        note,
      );

    const mission =
      await this.#missionEngine.reject(
        approval.missionId,
        approval.note ?? "Rejected by governance",
      );

    return Object.freeze({
      approval,
      mission,
    });
  }

  listCapabilities(): readonly CapabilityRecord[] {
    return this.#capabilityRegistry.listCapabilities();
  }

  getCapability(
    capabilityId: string,
  ): CapabilityRecord | null {
    return this.#capabilityRegistry.getCapability(capabilityId);
  }

  upsertCapability(
    request: UpsertCapabilityRequest,
  ): Promise<CapabilityRecord> {
    return this.#capabilityRegistry.upsert(request);
  }

  analyzeCapabilities(
    request: CapabilityAnalysisRequest,
  ): Promise<CapabilityAnalysisRecord> {
    return this.#capabilityAnalyzer.analyzeManual(request);
  }

  listCapabilityAnalyses():
    readonly CapabilityAnalysisRecord[] {
    return this.#capabilityRegistry.listAnalyses();
  }

  getCapabilityAnalysis(
    analysisId: string,
  ): CapabilityAnalysisRecord | null {
    return this.#capabilityRegistry.getAnalysis(analysisId);
  }

  createEvolutionPlan(
    analysisId: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#evolutionPlanner.createPlan(analysisId);
  }

  listEvolutionPlans(): readonly EvolutionPlanRecord[] {
    return this.#capabilityRegistry.listPlans();
  }

  approveEvolutionPlan(
    planId: string,
    actor: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#evolutionEngine.approvePlan(
      planId,
      actor,
    );
  }

  executeEvolutionPlan(
    planId: string,
  ): Promise<EvolutionPlanRecord> {
    return this.#evolutionEngine.executePlan(planId);
  }

  getEvolutionPlan(
    planId: string,
  ): EvolutionPlanRecord | null {
    return this.#capabilityRegistry.getPlan(planId);
  }

  snapshot(): ForgeRuntimeSnapshot {
    const missionLoop = this.#missionLoop.snapshot();

    return Object.freeze({
      kernel: this.#kernel.stateSnapshot(),
      health: this.#kernel.healthSnapshot(),
      persistence: Object.freeze({
        ...this.#persistence,
      }),
      missionLoop,
      missions: this.#missionEngine.summary(
        missionLoop.currentMissionId,
      ),
      governance: this.#governanceEngine.summary(),
      capabilities: this.#capabilityRegistry.summary(),
      evolution: this.#capabilityRegistry.evolutionSummary(),
      events: this.#events.snapshot(),
    });
  }
}

export const forgeRuntime = new ForgeRuntime();