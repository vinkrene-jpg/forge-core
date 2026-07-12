import {
  AiGatewayEngine,
  type AiGatewayEngineOptions,
} from "./ai-gateway-engine";
import type {
  AiExecutionRecord,
  AiGatewayStatus,
  AiGatewaySummary,
  AiProviderConnector,
} from "./ai-gateway";
import {
  FileAiGatewayStateStore,
  type AiGatewayStateStore,
} from "./ai-gateway-store";
import { createHash, randomUUID } from "node:crypto";
import {
  AutonomousOutputEvaluator,
  parseAutonomousCycleInput,
  type AutonomousEvaluation,
} from "./autonomous-cycle";
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
  OperatorCore,
  type OperatorCoreOptions,
} from "./operator-core";
import type {
  CreateProjectMemoryRequest,
  ModelRouteDecision,
  ModelRouteRequest,
  OperatorCoreSummary,
  ProjectMemoryEntry,
  ProjectMemoryKind,
  ProjectRecord,
  PromptComposeRequest,
  PromptComposition,
  WorkspaceFileContent,
  WorkspaceFileSummary,
} from "./operator";
import {
  FileOperatorStateStore,
  type OperatorStateStore,
} from "./operator-store";
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
  MissionAbortError,
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
  readonly operator: OperatorCoreSummary;
  readonly aiGateway: AiGatewaySummary;
  readonly events: readonly RuntimeEvent[];
}

export interface ForgeRuntimeOptions {
  readonly stateStore?: RuntimeStateStore;
  readonly missionStateStore?: MissionStateStore;
  readonly governanceStateStore?: GovernanceStateStore;
  readonly capabilityStateStore?: CapabilityStateStore;
  readonly operatorStateStore?: OperatorStateStore;
  readonly aiGatewayStateStore?: AiGatewayStateStore;
  readonly aiProviderConnectors?: readonly AiProviderConnector[];
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
  readonly #operatorCore: OperatorCore;
  readonly #aiGateway: AiGatewayEngine;
  readonly #autonomousEvaluator = new AutonomousOutputEvaluator();
  readonly #missionLoop: MissionLoop;
  #persistence = createInitialRuntimeState();

  constructor(options: ForgeRuntimeOptions = {}) {
    this.#stateStore =
      options.stateStore ?? new FileRuntimeStateStore();

    const missionOptions: MissionEngineOptions = {
      events: this.#events,
      getRuntimeHealth: () => this.#kernel.healthSnapshot(),
      executeAutonomousCycle: (mission, signal) =>
        this.#executeAutonomousCycle(mission, signal),
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

    const operatorOptions: OperatorCoreOptions = {
      events: this.#events,
      stateStore:
        options.operatorStateStore ??
        new FileOperatorStateStore(),
    };

    this.#operatorCore =
      new OperatorCore(operatorOptions);

    const aiGatewayOptions: AiGatewayEngineOptions = {
      events: this.#events,
      stateStore:
        options.aiGatewayStateStore ??
        new FileAiGatewayStateStore(),
      getComposition: (compositionId) =>
        this.#operatorCore.getComposition(
          compositionId,
        ),
      connectors: options.aiProviderConnectors,
    };

    this.#aiGateway =
      new AiGatewayEngine(aiGatewayOptions);

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

  async #executeAutonomousCycle(
    mission: MissionRecord,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const input = parseAutonomousCycleInput(mission.input);

    if (signal.aborted) {
      throw new MissionAbortError();
    }

    const composition = await this.#operatorCore.composePrompt({
      projectId: input.projectId,
      objective: [
        input.objective,
        "",
        `This is autonomous cycle ${input.cycleIndex} of ${input.maxCycles}.`,
        "Use repository evidence and persistent project memory.",
        "Return the single next evidence-backed implementation step.",
        "State assumptions and concrete verification steps explicitly.",
        "Do not claim that code, tests or runtime changes occurred unless the supplied evidence proves it.",
      ].join("\n"),
      taskType: "analysis",
      privacy: "standard",
      budget: "medium",
      files: input.files,
      memoryKinds: [
        "architecture",
        "decision",
        "requirement",
        "task",
        "evidence",
      ],
    });

    if (signal.aborted) {
      throw new MissionAbortError();
    }

    const execution = await this.#aiGateway.executeComposition(
      composition.id,
      mission.id,
    );
    const evaluation: AutonomousEvaluation =
      this.#autonomousEvaluator.evaluate(mission.id, execution);
    const outputText = execution.outputText ?? "";
    const outputSha256 = createHash("sha256")
      .update(outputText, "utf8")
      .digest("hex");

    this.#events.publish("autonomous.cycle.evaluated", {
      missionId: mission.id,
      cycleIndex: input.cycleIndex,
      executionId: execution.id,
      evaluationId: evaluation.id,
      decision: evaluation.decision,
      score: evaluation.score,
    });

    const evidenceMemory = await this.#operatorCore.addMemory(
      input.projectId,
      {
        kind: "evidence",
        source: `autonomous-cycle:${mission.id}`,
        tags: [
          "autonomous-cycle",
          `cycle-${input.cycleIndex}`,
          evaluation.decision,
        ],
        content: [
          `Mission: ${mission.id}`,
          `Cycle: ${input.cycleIndex}/${input.maxCycles}`,
          `Composition: ${composition.id}`,
          `Execution: ${execution.id}`,
          `Evaluation: ${evaluation.id}`,
          `Decision: ${evaluation.decision}`,
          `Score: ${evaluation.score}`,
          `Output SHA-256: ${outputSha256}`,
          "",
          "Provider output:",
          outputText.slice(0, 4_000) || "No provider output.",
        ].join("\n"),
      },
    );

    if (evaluation.decision !== "accepted") {
      throw new Error(
        `Autonomous output rejected by evaluation ${evaluation.id} with score ${evaluation.score}`,
      );
    }

    let nextMissionId: string | null = null;

    if (input.cycleIndex < input.maxCycles) {
      try {
        const rootMissionId = input.rootMissionId ?? mission.id;
        const next = await this.createMission({
          kind: "operator.autonomous-cycle",
          title:
            `Autonomous provider cycle ${input.cycleIndex + 1}/${input.maxCycles}`,
          input: {
            projectId: input.projectId,
            objective: input.objective,
            cycleIndex: input.cycleIndex + 1,
            maxCycles: input.maxCycles,
            rootMissionId,
            previousMissionId: mission.id,
            continuationAuthorized: true,
            files: input.files,
          },
        });

        nextMissionId = next.mission.id;
        this.#events.publish(
          "autonomous.cycle.continuation.scheduled",
          {
            missionId: mission.id,
            nextMissionId,
            rootMissionId,
            cycleIndex: input.cycleIndex + 1,
          },
        );
      } catch (error) {
        this.#events.publish(
          "autonomous.cycle.continuation.failed",
          {
            missionId: mission.id,
            cycleIndex: input.cycleIndex,
            error: errorMessage(error),
          },
        );
        throw error;
      }
    }

    return Object.freeze({
      cycleIndex: input.cycleIndex,
      maxCycles: input.maxCycles,
      rootMissionId: input.rootMissionId ?? mission.id,
      previousMissionId: input.previousMissionId,
      compositionId: composition.id,
      executionId: execution.id,
      evaluation,
      evidenceMemoryId: evidenceMemory.id,
      outputSha256,
      usage: execution.usage,
      nextMissionId,
    });
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
      await this.#operatorCore.initialize();
      await this.#aiGateway.initialize();
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

  operatorSummary(): OperatorCoreSummary {
    return this.#operatorCore.summary();
  }

  listOperatorProjects(): readonly ProjectRecord[] {
    return this.#operatorCore.listProjects();
  }

  getOperatorProject(
    projectId: string,
  ): ProjectRecord | null {
    return this.#operatorCore.getProject(projectId);
  }

  listProjectMemories(
    projectId: string,
    kind?: ProjectMemoryKind,
  ): readonly ProjectMemoryEntry[] {
    return this.#operatorCore.listMemories(
      projectId,
      kind,
    );
  }

  addProjectMemory(
    projectId: string,
    request: CreateProjectMemoryRequest,
  ): Promise<ProjectMemoryEntry> {
    return this.#operatorCore.addMemory(
      projectId,
      request,
    );
  }

  inspectProjectWorkspace(
    projectId: string,
    relativePath?: string,
    depth?: number,
  ): Promise<readonly WorkspaceFileSummary[]> {
    return this.#operatorCore.inspectWorkspace(
      projectId,
      relativePath,
      depth,
    );
  }

  readProjectWorkspaceFile(
    projectId: string,
    relativePath: string,
    maxChars?: number,
  ): Promise<WorkspaceFileContent> {
    return this.#operatorCore.readWorkspaceFile(
      projectId,
      relativePath,
      maxChars,
    );
  }

  routeModel(
    request: ModelRouteRequest,
  ): ModelRouteDecision {
    return this.#operatorCore.routeModel(request);
  }

  composeProjectPrompt(
    request: PromptComposeRequest,
  ): Promise<PromptComposition> {
    return this.#operatorCore.composePrompt(request);
  }

  listPromptCompositions(
    projectId?: string,
  ): readonly PromptComposition[] {
    return this.#operatorCore.listCompositions(
      projectId,
    );
  }

  getPromptComposition(
    compositionId: string,
  ): PromptComposition | null {
    return this.#operatorCore.getComposition(
      compositionId,
    );
  }

  aiGatewayStatus(): AiGatewayStatus {
    return this.#aiGateway.status();
  }

  aiGatewaySummary(): AiGatewaySummary {
    return this.#aiGateway.summary();
  }

  listAiExecutions():
    readonly AiExecutionRecord[] {
    return this.#aiGateway.listExecutions();
  }

  getAiExecution(
    executionId: string,
  ): AiExecutionRecord | null {
    return this.#aiGateway.getExecution(
      executionId,
    );
  }

  executePromptComposition(
    compositionId: string,
    missionId: string | null = null,
  ): Promise<AiExecutionRecord> {
    return this.#aiGateway.executeComposition(
      compositionId,
      missionId,
    );
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
      operator: this.#operatorCore.summary(),
      aiGateway: this.#aiGateway.summary(),
      events: this.#events.snapshot(),
    });
  }
}

export const forgeRuntime = new ForgeRuntime();
