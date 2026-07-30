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
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AutonomousOutputEvaluator,
  type AutonomousExecutionEvidence,
  extractAutonomousWorkspaceTargets,
  parseCapabilityResult,
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
import {
  LearningEngine,
  type LearningEngineOptions,
} from "./learning-engine";
import type {
  LearningCapabilityProfile,
  LearningMissionProposal,
  LearningObservation,
  LearningSummary,
} from "./learning";
import {
  FileLearningStateStore,
  type LearningStateStore,
} from "./learning-store";
import { LearningEvidenceTool } from "./learning-evidence-tool";
import {
  getLearningMatrixEntry,
  listLearningMatrixEntries,
  type LearningCapabilityMatrixEntry,
} from "./learning-matrix";
import {
  NodeWorkspaceVerificationRunner,
  parseWorkspaceChangeRequest,
  WorkspaceExecutionError,
  WorkspaceExecutor,
  type WorkspaceVerificationRunner,
} from "./workspace-executor";

declare const __FORGE_RUNTIME_BUILD_SHA__: string | undefined;

const runtimeModuleUrl = import.meta.url;
const runtimeModulePath =
  typeof runtimeModuleUrl === "string"
    ? fileURLToPath(runtimeModuleUrl)
    : typeof __filename === "string"
      ? __filename
      : "unknown-module";
const runtimeRepositoryRoot = path.resolve(
  path.dirname(runtimeModulePath),
  "..",
  "..",
  "..",
);
const canonicalRepositoryRoot =
  process.env.FORGE_CANONICAL_REPO_ROOT?.trim()
    ? path.resolve(process.env.FORGE_CANONICAL_REPO_ROOT.trim())
    : null;
const workspaceRoot = path.resolve(
  process.env.FORGE_WORKSPACE_ROOT?.trim() || process.cwd(),
);

if (canonicalRepositoryRoot) {
  const realCanonicalRepositoryRoot = realpathSync(canonicalRepositoryRoot);

  for (const [label, candidate] of [
    ["runtime module", runtimeModulePath],
    ["workspace root", workspaceRoot],
  ] as const) {
    const realCandidate = realpathSync(candidate);
    const relativePath = path.relative(realCanonicalRepositoryRoot, realCandidate);

    if (
      relativePath.startsWith(`..${path.sep}`) ||
      relativePath === ".." ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        `Forge ${label} is outside canonical repository root: ${realCandidate} (expected under ${realCanonicalRepositoryRoot})`,
      );
    }
  }
}

const runtimeBinding = Object.freeze({
  runtimeBuildSha:
    typeof __FORGE_RUNTIME_BUILD_SHA__ === "string"
      ? __FORGE_RUNTIME_BUILD_SHA__
      : process.env.FORGE_RUNTIME_BUILD_SHA?.trim() || "source-unbundled",
  runtimeModulePath,
  runtimeRepositoryRoot,
  canonicalRepositoryRoot,
  workspaceRoot,
});
import {
  FileWorkspaceBridgeClient,
  type WorkspaceChangeExecutor,
} from "./workspace-bridge";
import {
  parseWorkspaceProviderPlan,
  type WorkspaceChangePlan,
  type WorkspacePlanningTarget,
} from "./workspace-change-planner";
import {
  AutonomousEngine,
} from "./autonomy-engine";
import type {
  AutonomousRuntimeSummary,
} from "./autonomy";
import {
  FileAutonomyStateStore,
  type AutonomyStateStore,
} from "./autonomy-store";
import {
  FileMemoryBridge,
  type MemoryBridgeSummary,
  type RelevantContextResult,
  type SearchMemoryBridgeRequest,
  type SearchMemoryBridgeResult,
  type UpsertContextRequest,
  type RecordDecisionRequest,
  type RecordLearningRequest,
  type RecordCapabilityRequest,
  type MemoryBridgeContext,
} from "./memory-bridge";

export interface RuntimeMissionCreationResult {
  readonly mission: MissionRecord;
  readonly governance: import("./governance").GovernanceAssessment;
  readonly approval: ApprovalRecord | null;
  readonly capabilityAnalysis: CapabilityAnalysisRecord;
}

type ApprovedWorkspaceMissionCreationResult =
  RuntimeMissionCreationResult & {
    readonly approval: ApprovalRecord;
  };

export interface ForgeRuntimeSnapshot {
  readonly binding: typeof runtimeBinding;
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
  readonly learning: LearningSummary;
  readonly autonomy: AutonomousRuntimeSummary;
  readonly memoryBridge: MemoryBridgeSummary;
  readonly events: readonly RuntimeEvent[];
}

export interface ForgeRuntimeOptions {
  readonly stateStore?: RuntimeStateStore;
  readonly missionStateStore?: MissionStateStore;
  readonly governanceStateStore?: GovernanceStateStore;
  readonly capabilityStateStore?: CapabilityStateStore;
  readonly operatorStateStore?: OperatorStateStore;
  readonly aiGatewayStateStore?: AiGatewayStateStore;
  readonly learningStateStore?: LearningStateStore;
  readonly autonomyStateStore?: AutonomyStateStore;
  readonly workspaceVerificationRunner?: WorkspaceVerificationRunner;
  readonly workspaceChangeExecutor?: WorkspaceChangeExecutor;
  readonly aiProviderConnectors?: readonly AiProviderConnector[];
  readonly missionLoopPollIntervalMs?: number;
  readonly autonomyPollIntervalMs?: number;
  readonly memoryBridgeRootPath?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

interface MissionExecutionFailure extends Error {
  missionResultStatus?: "failed" | "blocked" | "rejected";
  missionResultCause?: string;
  missionOutput?: Readonly<Record<string, unknown>>;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function runCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      signal,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizedProviderOutput(outputText: string): string {
  return outputText
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\bsk-[a-z0-9_-]{20,}\b/gi, "[REDACTED TOKEN]")
    .replace(
      /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[a-z0-9_./+=-]{16,}/gi,
      "$1=[REDACTED]",
    );
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
  readonly #learningEngine: LearningEngine;
  readonly #autonomyEngine: AutonomousEngine;
  readonly #memoryBridge: FileMemoryBridge;
  readonly #learningEvidenceTool: LearningEvidenceTool;
  readonly #workspaceExecutor: WorkspaceChangeExecutor;
  readonly #workspaceVerificationRunner: WorkspaceVerificationRunner;
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
      executeWorkspaceChange: (mission, signal) =>
        this.#executeWorkspaceChange(mission, signal),
      executeWorkspacePlan: (mission, signal) =>
        this.#executeWorkspacePlan(mission, signal),
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

    const bridgeDirectory = process.env.FORGE_WORKSPACE_BRIDGE_DIR?.trim();
    const bridgeToken = process.env.FORGE_WORKSPACE_BRIDGE_TOKEN?.trim();

    this.#workspaceVerificationRunner =
      options.workspaceVerificationRunner ??
      new NodeWorkspaceVerificationRunner();
    this.#workspaceExecutor =
      options.workspaceChangeExecutor ??
      (bridgeDirectory && bridgeToken
        ? new FileWorkspaceBridgeClient({
            directory: bridgeDirectory,
            token: bridgeToken,
            events: this.#events,
          })
        : new WorkspaceExecutor({
            events: this.#events,
            verificationRunner: this.#workspaceVerificationRunner,
          }));

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

    const learningOptions: LearningEngineOptions = {
      events: this.#events,
      stateStore:
        options.learningStateStore ??
        new FileLearningStateStore(),
      getCapabilities: () =>
        this.#capabilityRegistry.listCapabilities(),
    };

    this.#learningEngine =
      new LearningEngine(learningOptions);

    this.#autonomyEngine = new AutonomousEngine({
      events: this.#events,
      stateStore:
        options.autonomyStateStore ??
        new FileAutonomyStateStore(),
      pollIntervalMs: options.autonomyPollIntervalMs,
      listMissions: () => this.#missionEngine.list(),
      listApprovals: () => this.#governanceEngine.listApprovals(),
      approveApproval: (approvalId, actor, note) =>
        this.approveApproval(approvalId, actor, note),
      createMission: (request) => this.createMission(request),
      listLearningProposals: () => this.#learningEngine.listProposals(),
      listLearningProfiles: () => this.#learningEngine.listProfiles(),
      scheduleLearningProposal: (proposalId) =>
        this.scheduleLearningProposal(proposalId),
      scheduleWorkspacePlan: (missionId) =>
        this.scheduleWorkspacePlan(missionId),
      aiGatewaySummary: () => this.#aiGateway.summary(),
    });

    this.#memoryBridge = new FileMemoryBridge({
      events: this.#events,
      rootPath: options.memoryBridgeRootPath,
    });

    this.#learningEvidenceTool = new LearningEvidenceTool({
      getCapability: (capabilityId) =>
        this.#capabilityRegistry.getCapability(capabilityId),
      getProfile: (capabilityId) =>
        this.#learningEngine.getProfile(capabilityId),
      getMatrixEntry: getLearningMatrixEntry,
      getObservations: () => this.#learningEngine.listObservations(),
      getEvents: () => this.#events.snapshot(),
    });

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
    const preExecutionSnapshot = Object.freeze({
      ...runtimeBinding,
      intakeObjectiveExecutionMode:
        mission.input.intakeObjectiveExecutionMode ??
        mission.input.objectiveExecutionMode ??
        null,
      intakeObjectiveProfile:
        mission.input.intakeObjectiveProfile ??
        mission.input.objectiveProfile ??
        null,
      effectiveObjectiveExecutionMode: input.objectiveExecutionMode,
      effectiveObjectiveProfile: input.objectiveProfile,
      rawObjectivePresent:
        typeof mission.input.rawObjective === "string" &&
        mission.input.rawObjective.length > 0,
      targets: Array.isArray(mission.input.targets)
        ? mission.input.targets
        : null,
    });
    const persistedBuildIntent =
      mission.input.objectiveExecutionMode === "build-or-mutate" ||
      mission.input.objectiveProfile === "generic-build" ||
      (Array.isArray(mission.input.targets) &&
        mission.input.targets.some(
          (target) =>
            typeof target === "object" &&
            target !== null &&
            !Array.isArray(target) &&
            (target as Readonly<Record<string, unknown>>).allowCreate === true,
        ));

    if (
      persistedBuildIntent &&
      (input.objectiveExecutionMode !== "build-or-mutate" ||
        input.objectiveProfile !== "generic-build")
    ) {
      const failure = new Error(
        "Persisted build-or-mutate intent may not hydrate as an analysis mission",
      ) as MissionExecutionFailure;
      failure.missionResultStatus = "blocked";
      failure.missionResultCause = "execution-intent";
      failure.missionOutput = Object.freeze({
        objectiveExecutionMode: input.objectiveExecutionMode,
        objectiveProfile: input.objectiveProfile,
        preExecutionSnapshot,
        executionEvidence: null,
      });
      throw failure;
    }

    const relevantContext = this.#memoryBridge.relevantContext({
      query: input.objective,
      limit: 8,
    });

    if (signal.aborted) {
      throw new MissionAbortError();
    }

    const learningProposalId =
      typeof mission.input.learningProposalId === "string"
        ? mission.input.learningProposalId
        : null;
    const targetCapabilityId =
      typeof mission.input.targetCapabilityId === "string"
        ? mission.input.targetCapabilityId
        : null;
    let toolEvidenceMemory: ProjectMemoryEntry | null = null;
    let executionEvidence: AutonomousExecutionEvidence | null = null;
    let proofFilePath: string | null = null;
    let proofContent: string | null = null;
    let proofSha256: string | null = null;
    let proofWorkspaceRoot: string | null = null;

    if (input.objectiveProfile === "file-create-read-hash") {
      const targetPath =
        typeof mission.input.proofTargetPath === "string"
          ? mission.input.proofTargetPath
          : "forge-proof.txt";
      const proof = await this.#executeWorkspaceProof(
        mission.id,
        targetPath,
        signal,
      );
      executionEvidence = proof.evidence;
      proofFilePath = proof.filePath;
      proofContent = proof.content;
      proofSha256 = proof.sha256;
      proofWorkspaceRoot = proof.workspaceRoot;

      const requiredActions = [
        "write-file",
        "read-file",
        "compute-sha256",
        "verify-file-exists",
      ] as const;
      const recordedActions = new Set(
        executionEvidence.receipts
          .filter((receipt) => receipt.ok)
          .map((receipt) => receipt.action),
      );
      const matchingArtifact = executionEvidence.artifacts.find(
        (artifact) =>
          artifact.kind === "file-hash-proof" &&
          artifact.path === proofFilePath &&
          artifact.content === proofContent &&
          artifact.sha256 === proofSha256,
      );
      const fileEffect = executionEvidence.fileEffects.find(
        (effect) => effect.path === proofFilePath,
      );
      const verificationPassed =
        executionEvidence.verificationRuns.length > 0 &&
        executionEvidence.verificationRuns.every((run) => run.exitCode === 0);
      const missingGates: string[] = [];

      if (!(await exists(proofFilePath))) {
        missingGates.push("file-exists");
      }

      if (!proofFilePath) {
        missingGates.push("file-location");
      }

      if (typeof proofContent !== "string" || proofContent.length === 0) {
        missingGates.push("file-readback");
      }

      const loggedSha = fileEffect?.afterSha256 ?? null;

      if (
        !isHexSha256(proofSha256) ||
        !isHexSha256(loggedSha) ||
        loggedSha !== proofSha256
      ) {
        missingGates.push("sha256");
      }

      if (!fileEffect) {
        missingGates.push("file-change-log");
      }

      if (!matchingArtifact) {
        missingGates.push("execution-log");
      }

      if (!verificationPassed) {
        missingGates.push("verification-result");
      }

      for (const action of requiredActions) {
        if (!recordedActions.has(action)) {
          missingGates.push(`action-${action}`);
        }
      }

      if (missingGates.length > 0) {
        const failure = new Error(
          `Autonomous proof evidence gates missing: ${missingGates.join(", ")}`,
        ) as MissionExecutionFailure;
        failure.missionResultStatus = "failed";
        failure.missionResultCause = "evidence-gate";
        failure.missionOutput = Object.freeze({
          cycleIndex: input.cycleIndex,
          maxCycles: input.maxCycles,
          rootMissionId: input.rootMissionId ?? mission.id,
          previousMissionId: input.previousMissionId,
          objectiveExecutionMode: input.objectiveExecutionMode,
          objectiveProfile: input.objectiveProfile,
          proofWorkspaceRoot,
          proofFilePath,
          proofContent,
          proofSha256,
          executionEvidence,
          preExecutionSnapshot,
          missingGates: Object.freeze(missingGates),
        });
        throw failure;
      }
    }

    if (input.objectiveProfile === "generic-build") {
      if (
        !Array.isArray(mission.input.targets) ||
        mission.input.targets.length === 0
      ) {
        const blocked = new Error(
          "Generic build is blocked: explicit validated target files are required before provider execution.",
        ) as MissionExecutionFailure;
        blocked.missionResultStatus = "blocked";
        blocked.missionResultCause = "workspace-targets";
        blocked.missionOutput = Object.freeze({
          cycleIndex: input.cycleIndex,
          maxCycles: input.maxCycles,
          rootMissionId: input.rootMissionId ?? mission.id,
          previousMissionId: input.previousMissionId,
          objectiveExecutionMode: input.objectiveExecutionMode,
          objectiveProfile: input.objectiveProfile,
          executionEvidence: null,
          preExecutionSnapshot,
        });
        throw blocked;
      }

      const planning = await this.#executeWorkspacePlan(mission, signal);
      const plan = planning.plan as WorkspaceChangePlan;
      const providerExecution =
        this.#validatedGenericBuildProviderExecution(plan, mission.id);

      if (providerExecution.providerId === "manual-fallback") {
        const blocked = new Error(
          "Generic build is blocked because provider route manual-fallback cannot produce a workspace change plan.",
        ) as MissionExecutionFailure;
        blocked.missionResultStatus = "blocked";
        blocked.missionResultCause = "provider-route";
        blocked.missionOutput = Object.freeze({
          cycleIndex: input.cycleIndex,
          maxCycles: input.maxCycles,
          rootMissionId: input.rootMissionId ?? mission.id,
          previousMissionId: input.previousMissionId,
          objectiveExecutionMode: input.objectiveExecutionMode,
          objectiveProfile: input.objectiveProfile,
          compositionId: plan.compositionId,
          executionId: plan.executionId,
          plan,
          executionEvidence: null,
          preExecutionSnapshot,
        });
        throw blocked;
      }

      const executionMission = await this.#createWorkspaceExecutionMission(plan, {
        sourceAutonomousMissionId: mission.id,
        objectiveExecutionMode: "build-or-mutate",
        objectiveProfile: "generic-build",
      });

      return Object.freeze({
        cycleIndex: input.cycleIndex,
        maxCycles: input.maxCycles,
        rootMissionId: input.rootMissionId ?? mission.id,
        previousMissionId: input.previousMissionId,
        objectiveExecutionMode: input.objectiveExecutionMode,
        objectiveProfile: input.objectiveProfile,
        compositionId: plan.compositionId,
        executionId: plan.executionId,
        plan,
        planEvidenceMemoryId: planning.evidenceMemoryId,
        workspaceExecutionMissionId: executionMission.mission.id,
        workspaceExecutionApprovalId: executionMission.approval.id,
        evaluation: null,
        executionEvidence: null,
        preExecutionSnapshot,
      });
    }

    if (learningProposalId && targetCapabilityId) {
      const bundle = this.#learningEvidenceTool.collect({
        proposalId: learningProposalId,
        missionId: mission.id,
        targetCapabilityId,
      });

      toolEvidenceMemory = await this.#operatorCore.addMemory(
        input.projectId,
        {
          kind: "evidence",
          source: `learning-evidence-tool:${mission.id}`,
          tags: [
            "learning-tool-evidence",
            targetCapabilityId,
            "read-only",
          ],
          content: JSON.stringify(bundle, null, 2),
        },
      );
      this.#events.publish("learning.evidence.collected", {
        missionId: mission.id,
        proposalId: learningProposalId,
        targetCapabilityId,
        evidenceMemoryId: toolEvidenceMemory.id,
        bundleId: bundle.id,
        sha256: bundle.sha256,
      });
    }

    const composition = await this.#operatorCore.composePrompt({
      projectId: input.projectId,
      objective: [
        input.objective,
        "",
        `This is autonomous cycle ${input.cycleIndex} of ${input.maxCycles}.`,
        "Use repository evidence and persistent project memory.",
        "Use Memory Bridge context as durable primary knowledge across sessions.",
        "Return the single next evidence-backed implementation step.",
        "State assumptions and concrete verification steps explicitly.",
        "Do not claim that code, tests or runtime changes occurred unless the supplied evidence proves it.",
        "",
        "Current durable context:",
        relevantContext.currentContext.summary,
        "",
        "Relevant durable knowledge entries:",
        ...relevantContext.relevant.map(
          (item, index) =>
            `${index + 1}. [${item.entry.kind}] ${item.entry.title} (score ${item.score})\n${item.entry.content.slice(0, 400)}`,
        ),
        ...(toolEvidenceMemory
          ? [
              `Required evidence ID: ${toolEvidenceMemory.id}`,
              `Cite exactly: EVIDENCE: ${toolEvidenceMemory.id}`,
              "Declare exactly one: CAPABILITY_RESULT: PASS or CAPABILITY_RESULT: GAP.",
              "PASS requires the read-only bundle to prove the target capability. GAP is correct when evidence is missing or insufficient.",
            ]
          : []),
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

    if (
      input.objectiveExecutionMode === "build-or-mutate" &&
      execution.providerId === "manual-fallback"
    ) {
      const blocked = new Error(
        "Build/mutate objective is blocked because provider route manual-fallback cannot produce verified implementation evidence.",
      ) as MissionExecutionFailure;
      blocked.missionResultStatus = "blocked";
      blocked.missionResultCause = "provider-route";
      blocked.missionOutput = Object.freeze({
        cycleIndex: input.cycleIndex,
        maxCycles: input.maxCycles,
        rootMissionId: input.rootMissionId ?? mission.id,
        previousMissionId: input.previousMissionId,
        compositionId: composition.id,
        executionId: execution.id,
        objectiveExecutionMode: input.objectiveExecutionMode,
        objectiveProfile: input.objectiveProfile,
        executionEvidence,
      });
      throw blocked;
    }

    const evaluation: AutonomousEvaluation =
      this.#autonomousEvaluator.evaluate(mission.id, execution, {
        requiredEvidenceId: toolEvidenceMemory?.id ?? null,
        executionEvidence,
        objectiveExecutionMode: input.objectiveExecutionMode,
        objectiveProfile: input.objectiveProfile,
      });
    const outputText = execution.outputText ?? "";
    const capabilityResult = parseCapabilityResult(outputText);
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

    const baseOutput = Object.freeze({
      cycleIndex: input.cycleIndex,
      maxCycles: input.maxCycles,
      rootMissionId: input.rootMissionId ?? mission.id,
      previousMissionId: input.previousMissionId,
      compositionId: composition.id,
      executionId: execution.id,
      evaluation,
      evidenceMemoryId: evidenceMemory.id,
      toolEvidenceMemoryId: toolEvidenceMemory?.id ?? null,
      objectiveExecutionMode: input.objectiveExecutionMode,
      objectiveProfile: input.objectiveProfile,
      proofWorkspaceRoot,
      proofFilePath,
      proofContent,
      proofSha256,
      executionEvidence,
      capabilityResult,
      learningObservationId: null,
      learningProposalId: null,
      outputSha256,
      usage: execution.usage,
      nextMissionId: null,
      preExecutionSnapshot,
    });

    if (evaluation.decision !== "accepted") {
      const failure = new Error(
        `Autonomous output rejected by evaluation ${evaluation.id} with score ${evaluation.score}`,
      ) as MissionExecutionFailure;
      failure.missionResultStatus = "rejected";
      failure.missionResultCause = "evaluation";
      failure.missionOutput = baseOutput;
      throw failure;
    }

    const learning = await this.#learningEngine.observeAutonomousCycle({
      missionId: mission.id,
      missionKind: "operator.autonomous-cycle",
      executionId: execution.id,
      executionStatus: execution.status,
      evaluationId: evaluation.id,
      evaluationScore: evaluation.score,
      evaluationDecision: evaluation.decision,
      evaluationChecks: evaluation.checks.map((check) => ({
        id: check.id,
        passed: check.passed,
      })),
      evidenceMemoryId: evidenceMemory.id,
      projectId: input.projectId,
      capabilityIds: [
        "ai.provider.execute",
        "evaluation.output.assess",
        "mission.autonomous.continue",
      ],
      sourceProposalId:
        typeof mission.input.learningProposalId === "string"
          ? mission.input.learningProposalId
          : null,
      targetCapabilityId:
        typeof mission.input.targetCapabilityId === "string"
          ? mission.input.targetCapabilityId
          : null,
      capabilityResult,
      toolEvidenceMemoryId: toolEvidenceMemory?.id ?? null,
    });

    await this.#memoryBridge.recordLearning({
      title: `Autonomous cycle ${input.cycleIndex}/${input.maxCycles} ${evaluation.decision}`,
      content: [
        `Mission: ${mission.id}`,
        `Objective: ${input.objective}`,
        `Evaluation decision: ${evaluation.decision}`,
        `Evaluation score: ${evaluation.score}`,
        `Composition: ${composition.id}`,
        `Execution: ${execution.id}`,
      ].join("\n"),
      tags: [
        "autonomous-cycle",
        evaluation.decision,
        `cycle-${input.cycleIndex}`,
      ],
      sourceMissionId: mission.id,
    });

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
      ...baseOutput,
      learningObservationId: learning.observation.id,
      learningProposalId: learning.proposal.id,
      nextMissionId,
    });
  }

  async #executeWorkspaceProof(
    missionId: string,
    targetPath: string,
    signal: AbortSignal,
  ): Promise<{
    readonly workspaceRoot: string;
    readonly filePath: string;
    readonly content: string;
    readonly sha256: string;
    readonly evidence: AutonomousExecutionEvidence;
  }> {
    const storageRoot = process.env.STORAGE_DIR?.trim()
      ? path.resolve(process.env.STORAGE_DIR)
      : path.resolve("storage");
    const workspaceRoot = path.join(
      storageRoot,
      "sandboxes",
      "autonomous-proof-workspaces",
      missionId,
    );
    const proofText =
      `forge-proof mission=${missionId} ts=${new Date().toISOString()} ` +
      `nonce=${randomUUID()}`;
    const proofPathLiteral = targetPath
      .replaceAll("\\", "\\\\")
      .replaceAll("'", "\\'");
    const packageJson = {
      name: "forge-proof-workspace",
      private: true,
      scripts: {
        typecheck:
          `node -e \"const fs=require('fs');const p='${proofPathLiteral}';if(!fs.existsSync(p)){console.error('missing proof file');process.exit(1)}const t=fs.readFileSync(p,'utf8');if(!t||t.trim().length===0){console.error('empty proof file');process.exit(1)}console.log('proof verification ok')\"`,
      },
    };

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });

    const init = await runCommand("git", ["init"], workspaceRoot, signal);
    if (init.exitCode !== 0) {
      throw new Error(`Failed to initialize proof workspace: ${init.stderr || init.stdout}`);
    }

    const branch = await runCommand(
      "git",
      ["checkout", "-b", "proof-execution"],
      workspaceRoot,
      signal,
    );
    if (branch.exitCode !== 0) {
      throw new Error(`Failed to create proof branch: ${branch.stderr || branch.stdout}`);
    }

    let request;
    try {
      request = parseWorkspaceChangeRequest({
        changes: [
          {
            path: "package.json",
            expectedSha256: null,
            content: JSON.stringify(packageJson, null, 2),
          },
          {
            path: targetPath,
            expectedSha256: null,
            content: proofText,
          },
        ],
        verification: ["typecheck"],
        commit: null,
      });
    } catch (error) {
      const errorText = errorMessage(error);

      if (/Protected workspace path:/i.test(errorText)) {
        const blocked = new Error(errorText) as MissionExecutionFailure;
        blocked.missionResultStatus = "blocked";
        blocked.missionResultCause = "protected-path";
        blocked.missionOutput = Object.freeze({
          workspaceRoot,
          requestedPath: targetPath,
        });
        throw blocked;
      }

      throw error;
    }

    let execution;
    try {
      execution = await this.#workspaceExecutor.execute(
        workspaceRoot,
        missionId,
        request,
        signal,
      );
    } catch (error) {
      const errorText = errorMessage(error);

      if (/Protected workspace path:/i.test(errorText)) {
        const blocked = new Error(errorText) as MissionExecutionFailure;
        blocked.missionResultStatus = "blocked";
        blocked.missionResultCause = "protected-path";
        blocked.missionOutput = Object.freeze({
          workspaceRoot,
          requestedPath: targetPath,
        });
        throw blocked;
      }

      throw error;
    }

    const absoluteProofPath = path.resolve(workspaceRoot, targetPath);
    const readBack = await readFile(absoluteProofPath, "utf8");
    const computedHash = sha256Text(readBack);
    const proofChange = execution.changedFiles.find(
      (change) => change.path === targetPath,
    );
    const receiptAt = new Date().toISOString();
    const verificationRuns = execution.verification.map((verification) =>
      Object.freeze({
        command: verification.command,
        exitCode: verification.exitCode,
        stdoutSha256: verification.stdoutSha256,
        stderrSha256: verification.stderrSha256,
        durationMs: verification.durationMs,
      }),
    );
    const evidence: AutonomousExecutionEvidence = Object.freeze({
      objectiveProfile: "file-create-read-hash",
      receipts: Object.freeze([
        Object.freeze({
          id: randomUUID(),
          action: "write-file" as const,
          targetPath: absoluteProofPath,
          startedAt: receiptAt,
          completedAt: receiptAt,
          durationMs: 1,
          ok: Boolean(proofChange),
          error: proofChange ? null : "Proof change was not recorded",
        }),
        Object.freeze({
          id: randomUUID(),
          action: "read-file" as const,
          targetPath: absoluteProofPath,
          startedAt: receiptAt,
          completedAt: receiptAt,
          durationMs: 1,
          ok: readBack.length > 0,
          error: readBack.length > 0 ? null : "Proof file is empty",
        }),
        Object.freeze({
          id: randomUUID(),
          action: "compute-sha256" as const,
          targetPath: absoluteProofPath,
          startedAt: receiptAt,
          completedAt: receiptAt,
          durationMs: 1,
          ok: isHexSha256(computedHash),
          error: isHexSha256(computedHash)
            ? null
            : "Computed hash is not a valid SHA-256",
        }),
        Object.freeze({
          id: randomUUID(),
          action: "verify-file-exists" as const,
          targetPath: absoluteProofPath,
          startedAt: receiptAt,
          completedAt: receiptAt,
          durationMs: 1,
          ok: await exists(absoluteProofPath),
          error: (await exists(absoluteProofPath))
            ? null
            : "Proof file does not exist",
        }),
      ]),
      fileEffects: Object.freeze([
        Object.freeze({
          path: absoluteProofPath,
          existedBefore: proofChange?.beforeSha256 !== null,
          existsAfter: await exists(absoluteProofPath),
          beforeSha256: proofChange?.beforeSha256 ?? null,
          afterSha256: proofChange?.afterSha256 ?? "",
        }),
      ]),
      verificationRuns: Object.freeze(verificationRuns),
      artifacts: Object.freeze([
        Object.freeze({
          id: randomUUID(),
          kind: "file-hash-proof" as const,
          path: absoluteProofPath,
          content: readBack,
          sha256: computedHash,
        }),
      ]),
    });

    return Object.freeze({
      workspaceRoot,
      filePath: absoluteProofPath,
      content: readBack,
      sha256: computedHash,
      evidence,
    });
  }

  async #executeWorkspaceChange(
    mission: MissionRecord,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const projectId =
      typeof mission.input.projectId === "string"
        ? mission.input.projectId
        : "forge-core";
    const project = this.#operatorCore.getProject(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const request = parseWorkspaceChangeRequest(mission.input);
    const sourceAutonomousMissionId =
      typeof mission.input.sourceAutonomousMissionId === "string"
        ? mission.input.sourceAutonomousMissionId
        : null;
    const sourcePlanningMissionId =
      typeof mission.input.sourcePlanningMissionId === "string"
        ? mission.input.sourcePlanningMissionId
        : null;
    const sourcePlanningMission = sourcePlanningMissionId
      ? this.#missionEngine.get(sourcePlanningMissionId)
      : null;
    const genericBuildLinked =
      sourcePlanningMission?.kind === "operator.autonomous-cycle" ||
      mission.input.objectiveProfile === "generic-build" ||
      mission.input.sourceAutonomousMissionId !== undefined;
    let genericBuildProviderExecution: AiExecutionRecord | null = null;

    if (genericBuildLinked && !sourceAutonomousMissionId) {
      throw new Error(
        "Generic build execution requires complete autonomous source linkage",
      );
    }

    if (sourceAutonomousMissionId) {
      const sourceMission = this.#missionEngine.get(sourceAutonomousMissionId);
      const rawPlan = sourceMission?.output?.plan;

      if (
        sourcePlanningMissionId !== sourceAutonomousMissionId ||
        mission.input.objectiveExecutionMode !== "build-or-mutate" ||
        mission.input.objectiveProfile !== "generic-build" ||
        sourceMission?.kind !== "operator.autonomous-cycle" ||
        sourceMission.status !== "succeeded" ||
        typeof rawPlan !== "object" ||
        rawPlan === null ||
        Array.isArray(rawPlan)
      ) {
        throw new Error("Generic build source mission has no validated workspace plan");
      }

      const plan = rawPlan as unknown as WorkspaceChangePlan;
      const sourcePlanId =
        typeof mission.input.sourcePlanId === "string"
          ? mission.input.sourcePlanId
          : null;
      const providerOutputSha256 =
        typeof mission.input.providerOutputSha256 === "string"
          ? mission.input.providerOutputSha256
          : null;

      if (
        plan.id !== sourcePlanId ||
        plan.missionId !== sourceAutonomousMissionId ||
        plan.projectId !== projectId ||
        plan.providerOutputSha256 !== providerOutputSha256 ||
        JSON.stringify(plan.request) !== JSON.stringify(request)
      ) {
        throw new Error("Generic build execution does not match its validated workspace plan");
      }

      genericBuildProviderExecution =
        this.#validatedGenericBuildProviderExecution(
          plan,
          sourceAutonomousMissionId,
        );

      if (genericBuildProviderExecution.providerId === "manual-fallback") {
        throw new Error(
          "Generic build mutation is blocked for provider route manual-fallback",
        );
      }
    }

    try {
      const execution = await this.#workspaceExecutor.execute(
        project.rootPath,
        mission.id,
        request,
        signal,
      );
      const evidence = await this.#operatorCore.addMemory(projectId, {
        kind: "evidence",
        source: `workspace-execution:${mission.id}`,
        tags: ["workspace-execution", execution.status, execution.branch],
        content: JSON.stringify(execution, null, 2),
      });
      if (sourceAutonomousMissionId && genericBuildProviderExecution) {
        const executionEvidence =
          await this.#createWorkspaceExecutionEvidence(
            project.rootPath,
            execution,
          );
        const evaluation = this.#autonomousEvaluator.evaluate(
          sourceAutonomousMissionId,
          genericBuildProviderExecution,
          {
            executionEvidence,
            objectiveExecutionMode: "build-or-mutate",
            objectiveProfile: "generic-build",
          },
        );
        const evaluationMemory = await this.#operatorCore.addMemory(projectId, {
          kind: "evidence",
          source: `autonomous-cycle:${sourceAutonomousMissionId}`,
          tags: ["autonomous-cycle", "generic-build", evaluation.decision],
          content: JSON.stringify({
            sourceAutonomousMissionId,
            workspaceExecutionMissionId: mission.id,
            providerExecutionId: genericBuildProviderExecution.id,
            evaluation,
            executionEvidence,
          }, null, 2),
        });

        this.#events.publish("autonomous.cycle.evaluated", {
          missionId: sourceAutonomousMissionId,
          workspaceExecutionMissionId: mission.id,
          executionId: genericBuildProviderExecution.id,
          evaluationId: evaluation.id,
          decision: evaluation.decision,
          score: evaluation.score,
        });

        const output = Object.freeze({
          ...execution,
          evidenceMemoryId: evidence.id,
          sourceAutonomousMissionId,
          workspaceExecutionApprovalId:
            this.#governanceEngine.findByMissionId(mission.id)?.id ?? null,
          evaluation,
          evaluationMemoryId: evaluationMemory.id,
          executionEvidence,
          proofFilePath: request.changes[0]?.path ?? null,
          proofContent: executionEvidence.artifacts[0]?.content ?? null,
          proofSha256: executionEvidence.artifacts[0]?.sha256 ?? null,
          verification: execution.verification,
          workspaceExecutionCheckpoint: Object.freeze({
            version: 1,
            persistedAt: new Date().toISOString(),
            mutationCompleted: true,
          }),
        });

        if (evaluation.decision !== "accepted") {
          const failure = new Error(
            `Generic build rejected by evaluation ${evaluation.id} with score ${evaluation.score}`,
          ) as MissionExecutionFailure;
          failure.missionResultStatus = "rejected";
          failure.missionResultCause = "evaluation";
          failure.missionOutput = output;
          throw failure;
        }

        await this.#missionEngine.checkpointRunning(mission.id, output);

        const finalizationDelayMs = Number.parseInt(
          process.env.FORGE_WORKSPACE_FINALIZATION_DELAY_MS ?? "0",
          10,
        );
        if (
          Number.isInteger(finalizationDelayMs) &&
          finalizationDelayMs > 0 &&
          finalizationDelayMs <= 60_000
        ) {
          await new Promise((resolve) => setTimeout(resolve, finalizationDelayMs));
        }

        return output;
      }

      const output = Object.freeze({
        ...execution,
        evidenceMemoryId: evidence.id,
        workspaceExecutionApprovalId:
          this.#governanceEngine.findByMissionId(mission.id)?.id ?? null,
        executionEvidence:
          await this.#createWorkspaceExecutionEvidence(
            project.rootPath,
            execution,
          ),
        proofFilePath: request.changes[0]?.path ?? null,
        proofContent: request.changes[0]?.content ?? null,
        proofSha256:
          request.changes[0]
            ? sha256Text(request.changes[0].content)
            : null,
        verification: execution.verification,
        workspaceExecutionCheckpoint: Object.freeze({
          version: 1,
          persistedAt: new Date().toISOString(),
          mutationCompleted: true,
        }),
      });
      await this.#missionEngine.checkpointRunning(mission.id, output);
      return output;
    } catch (error) {
      if (error instanceof WorkspaceExecutionError) {
        await this.#operatorCore.addMemory(projectId, {
          kind: "evidence",
          source: `workspace-execution:${mission.id}`,
          tags: ["workspace-execution", error.result.status, "failed"],
          content: JSON.stringify(error.result, null, 2),
        });
      }

      throw error;
    }
  }

  async #createWorkspaceExecutionEvidence(
    rootPath: string,
    execution: Awaited<ReturnType<WorkspaceChangeExecutor["execute"]>>,
  ): Promise<AutonomousExecutionEvidence> {
    const receipts: AutonomousExecutionEvidence["receipts"][number][] = [];
    const fileEffects: AutonomousExecutionEvidence["fileEffects"][number][] = [];
    const artifacts: AutonomousExecutionEvidence["artifacts"][number][] = [];
    const executionDuration = Math.max(
      0,
      Date.parse(execution.completedAt) - Date.parse(execution.startedAt),
    );

    for (const change of execution.changedFiles) {
      const absolutePath = path.resolve(rootPath, change.path);
      const readStartedAt = new Date().toISOString();
      const readStarted = Date.now();
      const content = await readFile(absolutePath, "utf8");
      const afterSha256 = sha256Text(content);
      const existsAfter = await exists(absolutePath);
      const completedAt = new Date().toISOString();
      const readDuration = Math.max(0, Date.now() - readStarted);

      if (!existsAfter || afterSha256 !== change.afterSha256) {
        throw new Error(`Workspace execution evidence mismatch for ${change.path}`);
      }

      receipts.push(
        Object.freeze({
          id: randomUUID(),
          action: "write-file" as const,
          targetPath: absolutePath,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          durationMs: executionDuration,
          ok: true,
          error: null,
        }),
        Object.freeze({
          id: randomUUID(),
          action: "read-file" as const,
          targetPath: absolutePath,
          startedAt: readStartedAt,
          completedAt,
          durationMs: readDuration,
          ok: true,
          error: null,
        }),
        Object.freeze({
          id: randomUUID(),
          action: "compute-sha256" as const,
          targetPath: absolutePath,
          startedAt: readStartedAt,
          completedAt,
          durationMs: readDuration,
          ok: true,
          error: null,
        }),
        Object.freeze({
          id: randomUUID(),
          action: "verify-file-exists" as const,
          targetPath: absolutePath,
          startedAt: readStartedAt,
          completedAt,
          durationMs: readDuration,
          ok: true,
          error: null,
        }),
      );
      fileEffects.push(Object.freeze({
        path: absolutePath,
        existedBefore: change.beforeSha256 !== null,
        existsAfter,
        beforeSha256: change.beforeSha256,
        afterSha256,
      }));
      artifacts.push(Object.freeze({
        id: randomUUID(),
        kind: "file-hash-proof" as const,
        path: absolutePath,
        content,
        sha256: afterSha256,
      }));
    }

    return Object.freeze({
      objectiveProfile: "generic-build",
      receipts: Object.freeze(receipts),
      fileEffects: Object.freeze(fileEffects),
      verificationRuns: Object.freeze(
        execution.verification.map((verification) =>
          Object.freeze({
            command: verification.command,
            exitCode: verification.exitCode,
            stdoutSha256: verification.stdoutSha256,
            stderrSha256: verification.stderrSha256,
            durationMs: verification.durationMs,
          }),
        ),
      ),
      artifacts: Object.freeze(artifacts),
    });
  }

  async #recoverRunningWorkspaceExecutions(): Promise<void> {
    const staleMissions = this.#missionEngine.list().filter(
      (mission) =>
        mission.kind === "operator.workspace-change" &&
        mission.status === "running",
    );

    for (const mission of staleMissions) {
      try {
        const output = mission.output?.workspaceExecutionCheckpoint
          ? await this.#validatedWorkspaceRecoveryOutput(mission)
          : await this.#migrateLegacyWorkspaceRecovery(mission);
        await this.#missionEngine.complete(mission.id, output);
        this.#events.publish("mission.recovered", {
          missionId: mission.id,
          kind: mission.kind,
          mutationReplayed: false,
        });
      } catch (error) {
        const message =
          `Workspace recovery failed without mutation replay: ${errorMessage(error)}`;
        const failure = new Error(message) as MissionExecutionFailure;
        failure.missionResultStatus = "failed";
        failure.missionResultCause = "restart-recovery";
        failure.missionOutput = Object.freeze({
          ...(mission.output ?? {}),
          workspaceRecovery: Object.freeze({
            recoveredAt: new Date().toISOString(),
            mutationReplayed: false,
            validated: false,
            error: message,
          }),
        });
        await this.#missionEngine.fail(mission.id, failure);
      }
    }
  }

  async #validatedWorkspaceRecoveryOutput(
    mission: MissionRecord,
  ): Promise<Readonly<Record<string, unknown>>> {
    const output = mission.output;
    const checkpoint =
      output?.workspaceExecutionCheckpoint as
        | Readonly<Record<string, unknown>>
        | undefined;

    if (
      !output ||
      checkpoint?.version !== 1 ||
      checkpoint.mutationCompleted !== true ||
      (
        output.status !== "verified" &&
        output.status !== "committed" &&
        output.status !== "pushed"
      )
    ) {
      throw new Error("complete persisted workspace checkpoint is missing");
    }

    return this.#validatedCheckpointRecoveryDetails(mission, output);
  }

  async #migrateLegacyWorkspaceRecovery(
    mission: MissionRecord,
  ): Promise<Readonly<Record<string, unknown>>> {
      const approval = this.#governanceEngine.findByMissionId(mission.id);
      if (!approval || approval.status !== "approved") {
        throw new Error("legacy workspace execution approval is not approved");
      }

      const projectId =
        typeof mission.input.projectId === "string"
          ? mission.input.projectId
          : "forge-core";
      const project = this.#operatorCore.getProject(projectId);
      if (!project) {
        throw new Error(`legacy workspace project is unavailable: ${projectId}`);
      }

      const sourceAutonomousMissionId =
        typeof mission.input.sourceAutonomousMissionId === "string"
          ? mission.input.sourceAutonomousMissionId
          : null;
      const sourcePlanningMissionId =
        typeof mission.input.sourcePlanningMissionId === "string"
          ? mission.input.sourcePlanningMissionId
          : null;
      const sourceMissionId =
        sourceAutonomousMissionId ?? sourcePlanningMissionId;
      const sourceMission = sourceMissionId
        ? this.#missionEngine.get(sourceMissionId)
        : null;
      const sourcePlan = sourceMission?.output?.plan as
        | WorkspaceChangePlan
        | undefined;
      const request = parseWorkspaceChangeRequest(mission.input);

      if (
        !sourceMission ||
        sourceMission.status !== "succeeded" ||
        !sourcePlan ||
        sourcePlan.id !== mission.input.sourcePlanId ||
        sourcePlan.missionId !== sourceMission.id ||
        sourcePlan.projectId !== projectId ||
        sourcePlan.providerOutputSha256 !== mission.input.providerOutputSha256 ||
        JSON.stringify(sourcePlan.request) !== JSON.stringify(request) ||
        (
          sourceMission.kind === "operator.autonomous-cycle"
            ? (
                sourcePlanningMissionId !== sourceAutonomousMissionId ||
                sourceMission.output?.workspaceExecutionMissionId !== mission.id ||
                sourceMission.output?.workspaceExecutionApprovalId !== approval.id
              )
            : sourceMission.kind !== "operator.workspace-plan"
        )
      ) {
        throw new Error("legacy workspace source plan linkage is invalid");
      }
      if (request.commit?.push) {
        throw new Error(
          "legacy workspace recovery cannot prove a requested Git push",
        );
      }

      const recoveredAt = new Date().toISOString();
      const realProjectRoot = await realpath(project.rootPath);
      const receipts: AutonomousExecutionEvidence["receipts"][number][] = [];
      const fileEffects: AutonomousExecutionEvidence["fileEffects"][number][] = [];
      const artifacts: AutonomousExecutionEvidence["artifacts"][number][] = [];
      const targetSnapshots: {
        readonly path: string;
        readonly absolutePath: string;
        readonly content: string;
        readonly sha256: string;
        readonly mtimeMs: number;
      }[] = [];

      for (const change of request.changes) {
        const absolutePath = path.resolve(project.rootPath, change.path);
        const realTargetPath = await realpath(absolutePath);
        const relativeTargetPath = path.relative(realProjectRoot, realTargetPath);
        if (
          relativeTargetPath === ".." ||
          relativeTargetPath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeTargetPath)
        ) {
          throw new Error(
            `legacy approved target escapes the project workspace: ${change.path}`,
          );
        }
        const startedAt = new Date().toISOString();
        const started = Date.now();
        const content = await readFile(realTargetPath, "utf8");
        const targetStat = await stat(realTargetPath);
        const actualSha256 = sha256Text(content);
        const expectedSha256 = sha256Text(change.content);
        const completedAt = new Date().toISOString();
        const durationMs = Math.max(0, Date.now() - started);

        if (content !== change.content || actualSha256 !== expectedSha256) {
          throw new Error(
            `legacy approved target does not match the actual file: ${change.path}`,
          );
        }
        targetSnapshots.push(Object.freeze({
          path: change.path,
          absolutePath: realTargetPath,
          content,
          sha256: actualSha256,
          mtimeMs: targetStat.mtimeMs,
        }));

        for (const action of [
          "read-file",
          "compute-sha256",
          "verify-file-exists",
        ] as const) {
          receipts.push(Object.freeze({
            id: randomUUID(),
            action,
            targetPath: realTargetPath,
            startedAt,
            completedAt,
            durationMs,
            ok: true,
            error: null,
          }));
        }
        fileEffects.push(Object.freeze({
          path: realTargetPath,
          existedBefore: change.expectedSha256 !== null,
          existsAfter: true,
          beforeSha256: change.expectedSha256,
          afterSha256: actualSha256,
        }));
        artifacts.push(Object.freeze({
          id: randomUUID(),
          kind: "file-hash-proof" as const,
          path: realTargetPath,
          content,
          sha256: actualSha256,
        }));
      }

      const abortController = new AbortController();
      const verificationResults = [];
      for (const step of request.verification) {
        const result = await this.#workspaceVerificationRunner.run(
          step,
          project.rootPath,
          abortController.signal,
        );
        if (result.exitCode !== 0) {
          throw new Error(
            `legacy workspace verification failed for ${step} with exit code ${result.exitCode}`,
          );
        }
        verificationResults.push(Object.freeze({
          command: result.command,
          exitCode: result.exitCode,
          stdoutChars: result.stdout.length,
          stderrChars: result.stderr.length,
          stdoutSha256: sha256Text(result.stdout),
          stderrSha256: sha256Text(result.stderr),
          durationMs: result.durationMs,
        }));
      }
      for (const snapshot of targetSnapshots) {
        const content = await readFile(snapshot.absolutePath, "utf8");
        const targetStat = await stat(snapshot.absolutePath);
        if (
          content !== snapshot.content ||
          sha256Text(content) !== snapshot.sha256 ||
          targetStat.mtimeMs !== snapshot.mtimeMs
        ) {
          throw new Error(
            `legacy verification changed the approved target: ${snapshot.path}`,
          );
        }
      }

      const executionEvidence: AutonomousExecutionEvidence = Object.freeze({
        objectiveProfile: "generic-build",
        receipts: Object.freeze(receipts),
        fileEffects: Object.freeze(fileEffects),
        verificationRuns: Object.freeze(
          verificationResults.map((result) =>
            Object.freeze({
              command: result.command,
              exitCode: result.exitCode,
              stdoutSha256: result.stdoutSha256,
              stderrSha256: result.stderrSha256,
              durationMs: result.durationMs,
            })),
        ),
        artifacts: Object.freeze(artifacts),
      });
      const providerExecution =
        this.#validatedGenericBuildProviderExecution(
          sourcePlan,
          sourceMission.id,
        );
      const evaluation = this.#autonomousEvaluator.evaluate(
        sourceMission.id,
        providerExecution,
        {
          executionEvidence,
          objectiveExecutionMode: "build-or-mutate",
          objectiveProfile: "generic-build",
        },
      );
      if (evaluation.decision !== "accepted") {
        throw new Error(
          `legacy workspace evidence evaluation was ${evaluation.decision}`,
        );
      }

      return Object.freeze({
        id: randomUUID(),
        missionId: mission.id,
        status: "verified",
        branch: "legacy-recovery",
        changedFiles: request.changes.map((change) => Object.freeze({
          path: change.path,
          beforeSha256: change.expectedSha256,
          afterSha256: sha256Text(change.content),
        })),
        verification: Object.freeze(verificationResults),
        rollbackPerformed: false,
        commitSha: null,
        commitRecovery: Object.freeze({
          requested: request.commit !== null,
          completed: false,
          pushRequested: false,
          reason:
            request.commit === null
              ? "No commit was requested"
              : "Legacy recovery validates existing effects and never creates a new commit",
        }),
        error: null,
        startedAt: mission.startedAt ?? mission.updatedAt,
        completedAt: recoveredAt,
        sourceAutonomousMissionId,
        workspaceExecutionApprovalId: approval.id,
        evaluation,
        executionEvidence,
        proofFilePath: request.changes[0]?.path ?? null,
        proofContent: request.changes[0]?.content ?? null,
        proofSha256:
          request.changes[0]
            ? sha256Text(request.changes[0].content)
            : null,
        workspaceExecutionCheckpoint: Object.freeze({
          version: 1,
          persistedAt: recoveredAt,
          mutationCompleted: true,
          legacyMigrated: true,
        }),
        workspaceRecovery: Object.freeze({
          recoveredAt,
          mutationReplayed: false,
          validated: true,
          legacyMigrated: true,
          validatedTargets: request.changes.map((change) => change.path),
        }),
      });
  }

  async #validatedCheckpointRecoveryDetails(
    mission: MissionRecord,
    output: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const approval = this.#governanceEngine.findByMissionId(mission.id);
    if (!approval || approval.status !== "approved") {
      throw new Error("workspace execution approval is not approved");
    }

    const projectId =
      typeof mission.input.projectId === "string"
        ? mission.input.projectId
        : "forge-core";
    const project = this.#operatorCore.getProject(projectId);
    if (!project) {
      throw new Error(`project is unavailable: ${projectId}`);
    }

    const sourceAutonomousMissionId =
      typeof mission.input.sourceAutonomousMissionId === "string"
        ? mission.input.sourceAutonomousMissionId
        : null;
    const sourcePlanningMissionId =
      typeof mission.input.sourcePlanningMissionId === "string"
        ? mission.input.sourcePlanningMissionId
        : null;
    const sourceMission = sourceAutonomousMissionId || sourcePlanningMissionId
      ? this.#missionEngine.get(
          sourceAutonomousMissionId ?? sourcePlanningMissionId!,
        )
      : null;

    if (
      !sourceMission ||
      sourceMission.status !== "succeeded" ||
      (
        sourceMission.kind === "operator.autonomous-cycle"
          ? (
              sourcePlanningMissionId !== sourceAutonomousMissionId ||
              sourceMission.output?.workspaceExecutionMissionId !== mission.id ||
              sourceMission.output?.workspaceExecutionApprovalId !== approval.id
            )
          : sourceMission.kind !== "operator.workspace-plan"
      )
    ) {
      throw new Error("original mission and approval linkage is invalid");
    }

    const request = parseWorkspaceChangeRequest(mission.input);
    if (sourceMission.kind === "operator.workspace-plan") {
      const sourcePlan = sourceMission.output?.plan as
        | Readonly<Record<string, unknown>>
        | undefined;
      if (
        !sourcePlan ||
        sourcePlan.id !== mission.input.sourcePlanId ||
        JSON.stringify(sourcePlan.request) !== JSON.stringify(request)
      ) {
        throw new Error("workspace planning mission linkage is invalid");
      }
    }
    const executionEvidence =
      output.executionEvidence as
        | {
            readonly receipts?: readonly Readonly<Record<string, unknown>>[];
            readonly fileEffects?: readonly Readonly<Record<string, unknown>>[];
            readonly verificationRuns?: readonly Readonly<Record<string, unknown>>[];
            readonly artifacts?: readonly Readonly<Record<string, unknown>>[];
          }
        | undefined;
    const verification =
      Array.isArray(output.verification)
        ? output.verification as readonly Readonly<Record<string, unknown>>[]
        : null;

    if (
      !executionEvidence ||
      !Array.isArray(executionEvidence.receipts) ||
      !Array.isArray(executionEvidence.fileEffects) ||
      !Array.isArray(executionEvidence.verificationRuns) ||
      !Array.isArray(executionEvidence.artifacts) ||
      !verification ||
      verification.length < request.verification.length ||
      executionEvidence.verificationRuns.length !== verification.length ||
      verification.some((receipt) => receipt.exitCode !== 0) ||
      executionEvidence.verificationRuns.some((receipt) => receipt.exitCode !== 0) ||
      verification.some((receipt, index) => {
        const evidenceReceipt = executionEvidence.verificationRuns?.[index];
        return (
          !evidenceReceipt ||
          evidenceReceipt.command !== receipt.command ||
          evidenceReceipt.stdoutSha256 !== receipt.stdoutSha256 ||
          evidenceReceipt.stderrSha256 !== receipt.stderrSha256
        );
      })
    ) {
      throw new Error("persisted verification receipts are incomplete or failed");
    }

    const expectedVerificationFragments = {
      typecheck: "pnpm run typecheck",
      test: "pnpm --filter @workspace/forge-runtime test",
      build: "pnpm run build",
    } as const;
    for (const step of request.verification) {
      if (
        !verification.some(
          (receipt) =>
            typeof receipt.command === "string" &&
            receipt.command.includes(expectedVerificationFragments[step]),
        )
      ) {
        throw new Error(`persisted verification receipt is missing for ${step}`);
      }
    }

    for (const change of request.changes) {
      const absolutePath = path.resolve(project.rootPath, change.path);
      const content = await readFile(absolutePath, "utf8");
      const expectedSha256 = sha256Text(change.content);
      const actualSha256 = sha256Text(content);
      const artifact = executionEvidence.artifacts.find(
        (candidate) => candidate.path === absolutePath,
      );
      const fileEffect = executionEvidence.fileEffects.find(
        (candidate) => candidate.path === absolutePath,
      );
      const receipts = executionEvidence.receipts.filter(
        (candidate) => candidate.targetPath === absolutePath,
      );

      if (
        content !== change.content ||
        actualSha256 !== expectedSha256 ||
        artifact?.content !== content ||
        artifact.sha256 !== actualSha256 ||
        fileEffect?.afterSha256 !== actualSha256 ||
        receipts.length < 4 ||
        receipts.some((receipt) => receipt.ok !== true)
      ) {
        throw new Error(
          `approved target evidence does not match the actual file: ${change.path}`,
        );
      }
    }

    const firstChange = request.changes[0];
    if (
      !firstChange ||
      output.proofFilePath !== firstChange.path ||
      output.proofContent !== firstChange.content ||
      output.proofSha256 !== sha256Text(firstChange.content)
    ) {
      throw new Error("persisted proof fields do not match the approved target");
    }

    const evaluation =
      output.evaluation as Readonly<Record<string, unknown>> | undefined;
    if (
      sourceMission.kind === "operator.autonomous-cycle" &&
      (evaluation?.decision !== "accepted" || evaluation.score !== 100)
    ) {
      throw new Error("persisted workspace evaluation is not accepted");
    }

    return Object.freeze({
      ...output,
      workspaceExecutionApprovalId: approval.id,
      workspaceRecovery: Object.freeze({
        recoveredAt: new Date().toISOString(),
        mutationReplayed: false,
        validated: true,
        validatedTargets: request.changes.map((change) => change.path),
      }),
    });
  }

  #validatedGenericBuildProviderExecution(
    plan: WorkspaceChangePlan,
    missionId: string,
  ): AiExecutionRecord {
    const execution = this.#aiGateway.getExecution(plan.executionId);

    if (
      !execution ||
      execution.status !== "succeeded" ||
      execution.missionId !== missionId ||
      execution.compositionId !== plan.compositionId ||
      execution.projectId !== plan.projectId ||
      typeof execution.outputText !== "string" ||
      createHash("sha256").update(execution.outputText, "utf8").digest("hex") !==
        plan.providerOutputSha256
    ) {
      throw new Error(
        "Generic build provider execution does not match its validated workspace plan",
      );
    }

    return execution;
  }

  async #executeWorkspacePlan(
    mission: MissionRecord,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const projectId =
      typeof mission.input.projectId === "string"
        ? mission.input.projectId
        : "forge-core";
    const objective =
      typeof mission.input.rawObjective === "string"
        ? mission.input.rawObjective.trim()
        : typeof mission.input.objective === "string"
          ? mission.input.objective.trim()
        : "";
    const rawTargets = mission.input.targets;

    if (objective.length === 0 || objective.length > 10_000) {
      throw new Error("Workspace planning objective is required and limited to 10000 characters");
    }

    if (!Array.isArray(rawTargets) || rawTargets.length === 0 || rawTargets.length > 8) {
      throw new Error("Workspace planning requires between 1 and 8 target files");
    }

    const sourceFiles: string[] = [];
    const targets: WorkspacePlanningTarget[] = [];
    const seen = new Set<string>();

    for (const [index, rawTarget] of rawTargets.entries()) {
      if (
        typeof rawTarget !== "object" ||
        rawTarget === null ||
        Array.isArray(rawTarget)
      ) {
        throw new Error(`targets[${index}] must be an object`);
      }

      const candidate = rawTarget as Readonly<Record<string, unknown>>;
      const targetPath =
        typeof candidate.path === "string" ? candidate.path.trim() : "";
      const allowCreate = candidate.allowCreate === true;

      const validatedTarget = parseWorkspaceChangeRequest({
        changes: [{ path: targetPath, expectedSha256: null, content: "path-validation" }],
        verification: ["typecheck"],
        commit: null,
      });
      const canonicalPath = validatedTarget.changes[0].path;

      if (seen.has(canonicalPath)) {
        throw new Error(`Duplicate workspace planning target: ${canonicalPath}`);
      }

      seen.add(canonicalPath);

      try {
        const file = await this.#operatorCore.readWorkspaceFile(
          projectId,
          canonicalPath,
          200_000,
        );

        if (file.truncated) {
          throw new Error(`Workspace planning target is too large: ${canonicalPath}`);
        }

        sourceFiles.push(canonicalPath);
        targets.push(Object.freeze({
          path: canonicalPath,
          expectedSha256: createHash("sha256")
            .update(file.content, "utf8")
            .digest("hex"),
          exists: true,
        }));
      } catch (error) {
        const errorCode =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : null;

        if (!allowCreate || errorCode !== "ENOENT") {
          throw error;
        }

        targets.push(Object.freeze({
          path: canonicalPath,
          expectedSha256: null,
          exists: false,
        }));
      }
    }

    if (signal.aborted) {
      throw new MissionAbortError();
    }

    const composition = await this.#operatorCore.composePrompt({
      projectId,
      objective: [
        objective,
        "",
        "WORKSPACE_PLAN_OUTPUT_CONTRACT_V1",
        "Return exactly one raw JSON object. Do not use Markdown fences or prose outside JSON.",
        "The only allowed top-level fields are schemaVersion, changes, verification and commit.",
        "schemaVersion must equal 1.",
        "changes must contain only approved target paths and must copy each expectedSha256 exactly from the manifest.",
        "verification must include the identifier typecheck and may additionally include only test and build.",
        "Use test for the Forge runtime test. Never place commands or explanatory text in verification.",
        "commit must contain a concise message and push must be false.",
        "Never include credentials, environment values, arbitrary commands, deletions or protected paths.",
        "",
        `Approved target manifest: ${JSON.stringify(targets)}`,
      ].join("\n"),
      taskType: "coding",
      privacy: "standard",
      budget: "high",
      files: sourceFiles,
      memoryKinds: [],
    });
    const execution = await this.#aiGateway.executeComposition(
      composition.id,
      mission.id,
    );

    if (execution.status !== "succeeded" || !execution.outputText) {
      throw new Error(`Workspace provider planning failed: ${execution.error ?? execution.status}`);
    }

    let plan: WorkspaceChangePlan;

    try {
      plan = parseWorkspaceProviderPlan({
        missionId: mission.id,
        projectId,
        objective,
        targets,
        compositionId: composition.id,
        executionId: execution.id,
        outputText: execution.outputText,
      });
    } catch (error) {
      const parseError = errorMessage(error);
      const safeOutput = sanitizedProviderOutput(execution.outputText);
      const failure = new Error(
        `Workspace provider plan rejected: ${parseError}`,
      ) as MissionExecutionFailure;
      failure.missionResultStatus = "failed";
      failure.missionResultCause = "provider-output-contract";
      failure.missionOutput = Object.freeze({
        providerOutputDiagnostics: Object.freeze({
          ...runtimeBinding,
          providerId: execution.providerId,
          model: execution.model,
          executionId: execution.id,
          outputLength: execution.outputText.length,
          outputSha256: createHash("sha256")
            .update(execution.outputText, "utf8")
            .digest("hex"),
          rawOutputExcerpt: safeOutput.slice(0, 4_000),
          outputFirst500: safeOutput.slice(0, 500),
          outputLast500: safeOutput.slice(-500),
          truncated: safeOutput.length > 4_000,
          parseError,
        }),
        executionEvidence: null,
      });
      throw failure;
    }

    const evidence = await this.#operatorCore.addMemory(projectId, {
      kind: "evidence",
      source: `workspace-plan:${mission.id}`,
      tags: ["workspace-plan", "provider-validated", "awaiting-execution-approval"],
      content: JSON.stringify(plan, null, 2),
    });

    this.#events.publish("workspace.plan.validated", {
      missionId: mission.id,
      planId: plan.id,
      executionId: execution.id,
      files: plan.request.changes.length,
    });

    return Object.freeze({
      plan,
      evidenceMemoryId: evidence.id,
    });
  }

  async #createWorkspaceExecutionMission(
    plan: WorkspaceChangePlan,
    source?: {
      readonly sourceAutonomousMissionId: string;
      readonly objectiveExecutionMode: "build-or-mutate";
      readonly objectiveProfile: "generic-build";
    },
  ): Promise<ApprovedWorkspaceMissionCreationResult> {
    const request = parseWorkspaceChangeRequest(
      plan.request as unknown as Readonly<Record<string, unknown>>,
    );

    const result = await this.createMission({
      kind: "operator.workspace-change",
      title:
        "Execute approved workspace plan: " +
        plan.targets.map((target) => target.path).join(", "),
      input: {
        projectId: plan.projectId,
        sourcePlanningMissionId: plan.missionId,
        sourcePlanId: plan.id,
        providerOutputSha256: plan.providerOutputSha256,
        ...(source ?? {}),
        changes: request.changes,
        verification: request.verification,
        commit: request.commit,
      },
    });

    const publishedApproval = result.approval
      ? this.#governanceEngine.getApproval(result.approval.id)
      : null;

    if (
      result.mission.status !== "awaiting_approval" ||
      result.governance.decision !== "require_approval" ||
      publishedApproval === null ||
      publishedApproval.missionId !== result.mission.id ||
      publishedApproval.status !== "pending"
    ) {
      throw new Error(
        "Workspace execution mission requires a persisted pending approval",
      );
    }

    return Object.freeze({
      ...result,
      approval: publishedApproval,
    });
  }

  async #reconcileLearningEvidence(): Promise<void> {
    const completed = this.#missionEngine
      .list()
      .filter(
        (mission) =>
          mission.kind === "operator.autonomous-cycle" &&
          mission.status === "succeeded",
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const mission of completed) {
      const output = mission.output;
      const executionId = output?.executionId;
      const evidenceMemoryId = output?.evidenceMemoryId;
      const rawEvaluation = output?.evaluation;

      if (
        typeof executionId !== "string" ||
        typeof evidenceMemoryId !== "string" ||
        typeof rawEvaluation !== "object" ||
        rawEvaluation === null ||
        Array.isArray(rawEvaluation)
      ) {
        continue;
      }

      const evaluation = rawEvaluation as Readonly<Record<string, unknown>>;
      const evaluationId = evaluation.id;
      const evaluationScore = evaluation.score;
      const evaluationDecision = evaluation.decision;
      const rawChecks = evaluation.checks;
      const execution = this.#aiGateway.getExecution(executionId);

      if (
        !execution ||
        typeof evaluationId !== "string" ||
        typeof evaluationScore !== "number" ||
        (evaluationDecision !== "accepted" &&
          evaluationDecision !== "rejected") ||
        !Array.isArray(rawChecks)
      ) {
        continue;
      }

      const evaluationChecks = rawChecks.flatMap((check) => {
        if (
          typeof check !== "object" ||
          check === null ||
          Array.isArray(check)
        ) {
          return [];
        }

        const candidate = check as Readonly<Record<string, unknown>>;

        return typeof candidate.id === "string" &&
          typeof candidate.passed === "boolean"
          ? [{ id: candidate.id, passed: candidate.passed }]
          : [];
      });
      const projectId =
        typeof mission.input.projectId === "string"
          ? mission.input.projectId
          : "forge-core";

      await this.#learningEngine.observeAutonomousCycle({
        missionId: mission.id,
        missionKind: "operator.autonomous-cycle",
        executionId,
        executionStatus: execution.status,
        evaluationId,
        evaluationScore,
        evaluationDecision,
        evaluationChecks,
        evidenceMemoryId,
        projectId,
        capabilityIds: [
          "ai.provider.execute",
          "evaluation.output.assess",
          "mission.autonomous.continue",
        ],
        sourceProposalId:
          typeof mission.input.learningProposalId === "string"
            ? mission.input.learningProposalId
            : null,
        targetCapabilityId:
          typeof mission.input.targetCapabilityId === "string"
            ? mission.input.targetCapabilityId
            : null,
        capabilityResult:
          output?.capabilityResult === "pass" ||
          output?.capabilityResult === "gap"
            ? output.capabilityResult
            : null,
        toolEvidenceMemoryId:
          typeof output?.toolEvidenceMemoryId === "string"
            ? output.toolEvidenceMemoryId
            : null,
      });
    }
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

      await this.#governanceEngine.initialize();
      await this.#capabilityRegistry.initialize();
      await this.#operatorCore.initialize();
      await this.#aiGateway.initialize();
      await this.#learningEngine.initialize();
      await this.#memoryBridge.initialize();
      await this.#missionEngine.initialize();
      await this.#autonomyEngine.initialize();
      await this.#recoverRunningWorkspaceExecutions();
      await this.#reconcileLearningEvidence();
      await this.#reconcileGovernanceState();

      this.subscribe((event) => {
        if (
          event.type !== "mission.succeeded" &&
          event.type !== "mission.failed" &&
          event.type !== "mission.rejected"
        ) {
          return;
        }

        const missionId =
          typeof event.payload.missionId === "string"
            ? event.payload.missionId
            : null;

        if (!missionId) {
          return;
        }

        const mission = this.#missionEngine.get(missionId);

        if (!mission) {
          return;
        }

        void this.#memoryBridge.captureMissionKnowledge(mission);
      });

      this.#missionLoop.start();
      this.#autonomyEngine.start();

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
    await this.#autonomyEngine.stop();
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
    if (request.kind === "operator.autonomous-cycle") {
      const missionInput = request.input ?? {};
      const objective =
        typeof missionInput.objective === "string"
          ? missionInput.objective
          : "";
      const existingTargets = missionInput.targets;

      if (
        (!Array.isArray(existingTargets) || existingTargets.length === 0) &&
        objective.length > 0
      ) {
        const inferredTargets = extractAutonomousWorkspaceTargets(objective);

        if (inferredTargets.length === 1) {
          const targetPath = inferredTargets[0].path;
          request = Object.freeze({
            ...request,
            input: Object.freeze({
              ...missionInput,
              rawObjective:
                typeof missionInput.rawObjective === "string"
                  ? missionInput.rawObjective
                  : objective,
              targets: inferredTargets,
              objectiveExecutionMode: "build-or-mutate",
              objectiveProfile: "generic-build",
              intakeObjectiveExecutionMode: "build-or-mutate",
              intakeObjectiveProfile: "generic-build",
              proofTargetPath: targetPath,
            }),
          });
        }
      }
    }

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

    if (request.kind === "operator.autonomous-cycle") {
      const activeAutonomousMissions = this.#missionEngine
        .list()
        .filter(
          (mission) =>
            mission.kind === "operator.autonomous-cycle" &&
            (mission.status === "queued" ||
              mission.status === "running" ||
              mission.status === "awaiting_approval"),
        );

      if (activeAutonomousMissions.length > 0) {
        const continuationAuthorized =
          request.input?.continuationAuthorized === true;
        const cycleIndex = request.input?.cycleIndex;
        const previousMissionId = request.input?.previousMissionId;
        const boundedContinuation =
          continuationAuthorized &&
          typeof cycleIndex === "number" &&
          Number.isInteger(cycleIndex) &&
          cycleIndex > 1 &&
          typeof previousMissionId === "string" &&
          activeAutonomousMissions.length === 1 &&
          activeAutonomousMissions[0].status === "running" &&
          activeAutonomousMissions[0].id === previousMissionId;

        if (!boundedContinuation) {
          throw new Error("An autonomous mission is already active");
        }
      }
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

  async scheduleWorkspacePlan(missionId: string): Promise<{
    readonly planningMission: MissionRecord;
    readonly plan: WorkspaceChangePlan;
    readonly executionMission: RuntimeMissionCreationResult;
  }> {
    const planningMission = this.#missionEngine.get(missionId);

    if (!planningMission || planningMission.kind !== "operator.workspace-plan") {
      throw new Error("Succeeded workspace planning mission not found");
    }

    if (planningMission.status !== "succeeded" || !planningMission.output) {
      throw new Error("Workspace plan is not ready for execution");
    }

    const rawPlan = planningMission.output.plan;

    if (typeof rawPlan !== "object" || rawPlan === null || Array.isArray(rawPlan)) {
      throw new Error("Workspace planning mission has no validated plan");
    }

    const candidate = rawPlan as unknown as WorkspaceChangePlan;

    if (
      typeof candidate.id !== "string" ||
      candidate.missionId !== planningMission.id ||
      typeof candidate.projectId !== "string" ||
      typeof candidate.summary !== "string" ||
      typeof candidate.providerOutputSha256 !== "string"
    ) {
      throw new Error("Workspace planning mission contains an invalid plan record");
    }

    const request = parseWorkspaceChangeRequest(
      candidate.request as unknown as Readonly<Record<string, unknown>>,
    );
    const plan = Object.freeze({
      ...candidate,
      request,
    });
    const executionMission = await this.#createWorkspaceExecutionMission(plan);

    this.#events.publish("workspace.plan.scheduled", {
      planningMissionId: planningMission.id,
      planId: plan.id,
      executionMissionId: executionMission.mission.id,
      approvalId: executionMission.approval?.id ?? null,
    });

    return Object.freeze({
      planningMission,
      plan,
      executionMission,
    });
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

  learningSummary(): LearningSummary {
    return this.#learningEngine.summary();
  }

  memoryBridgeSummary(): MemoryBridgeSummary {
    return this.#memoryBridge.summary();
  }

  memoryBridgeCurrentContext(): MemoryBridgeContext {
    return this.#memoryBridge.currentContext();
  }

  searchMemoryBridge(
    request: SearchMemoryBridgeRequest,
  ): readonly SearchMemoryBridgeResult[] {
    return this.#memoryBridge.search(request);
  }

  memoryBridgeRelevantContext(
    query: string,
    limit?: number,
  ): RelevantContextResult {
    return this.#memoryBridge.relevantContext({
      query,
      limit,
    });
  }

  recordMemoryBridgeDecision(
    request: RecordDecisionRequest,
  ) {
    return this.#memoryBridge.recordDecision(request);
  }

  recordMemoryBridgeLearning(
    request: RecordLearningRequest,
  ) {
    return this.#memoryBridge.recordLearning(request);
  }

  recordMemoryBridgeCapability(
    request: RecordCapabilityRequest,
  ) {
    return this.#memoryBridge.recordCapability(request);
  }

  upsertMemoryBridgeContext(
    request: UpsertContextRequest,
  ) {
    return this.#memoryBridge.upsertCurrentContext(request);
  }

  autonomySummary(): AutonomousRuntimeSummary {
    return this.#autonomyEngine.summary();
  }

  setAutonomyEnabled(enabled: boolean): Promise<AutonomousRuntimeSummary> {
    return this.#autonomyEngine.setEnabled(enabled);
  }

  resumeAutonomy(): AutonomousRuntimeSummary {
    return this.#autonomyEngine.resume();
  }

  listLearningObservations(): readonly LearningObservation[] {
    return this.#learningEngine.listObservations();
  }

  listLearningProfiles(): readonly LearningCapabilityProfile[] {
    return this.#learningEngine.listProfiles();
  }

  listLearningProposals(): readonly LearningMissionProposal[] {
    return this.#learningEngine.listProposals();
  }

  listLearningMatrix(): readonly LearningCapabilityMatrixEntry[] {
    return listLearningMatrixEntries();
  }

  async scheduleLearningProposal(
    proposalId: string,
  ): Promise<{
    readonly proposal: LearningMissionProposal;
    readonly mission: RuntimeMissionCreationResult;
  }> {
    const proposal = this.#learningEngine.getProposal(proposalId);

    if (!proposal) {
      throw new Error("Learning proposal not found");
    }

    if (proposal.status !== "proposed") {
      throw new Error("Learning proposal is already scheduled");
    }

    const mission = await this.createMission({
      ...proposal.mission,
      title: `Governed learning exercise for ${proposal.targetCapabilityId}`,
      input: {
        ...proposal.mission.input,
        objective:
          `Execute one bounded evidence exercise for capability ` +
          `${proposal.targetCapabilityId}. ${proposal.mission.input.objective} ` +
          `Return a concrete result, explicit assumptions, acceptance criteria and exact verification.`,
        learningProposalId: proposal.id,
        targetCapabilityId: proposal.targetCapabilityId,
        reasonForSelection: proposal.mission.input.reasonForSelection,
        expectedNewEvidence: proposal.mission.input.expectedNewEvidence,
      },
    });
    const scheduled = await this.#learningEngine.markProposalScheduled(
      proposalId,
      mission.mission.id,
    );

    return Object.freeze({ proposal: scheduled, mission });
  }

  async recordFailedLearningExercise(proposalId: string) {
    const proposal = this.#learningEngine.getProposal(proposalId);

    if (
      !proposal ||
      proposal.status !== "scheduled" ||
      !proposal.scheduledMissionId
    ) {
      throw new Error("A scheduled learning proposal is required");
    }

    const mission = this.#missionEngine.get(proposal.scheduledMissionId);

    if (!mission || mission.status !== "failed") {
      throw new Error("The scheduled learning mission is not failed");
    }

    const executions = this.#aiGateway
      .listExecutions()
      .filter((execution) => execution.missionId === mission.id);

    if (executions.length !== 1) {
      throw new Error(
        "Exactly one persisted provider execution is required for recovery",
      );
    }

    const execution = executions[0];
    const evaluation = this.#autonomousEvaluator.evaluate(
      mission.id,
      execution,
    );
    const failedCheckIds = evaluation.checks
      .filter((check) => !check.passed)
      .map((check) => check.id);
    const secretCheck = evaluation.checks.find(
      (check) => check.id === "secret-free",
    );

    if (
      evaluation.decision !== "rejected" ||
      failedCheckIds.length === 0 ||
      secretCheck?.passed !== true
    ) {
      throw new Error(
        "Persisted provider output is not eligible for safe failure recovery",
      );
    }

    const projectId =
      typeof mission.input.projectId === "string"
        ? mission.input.projectId
        : "forge-core";
    const evidence = this.#operatorCore
      .listMemories(projectId, "evidence")
      .filter(
        (memory) => memory.source === `autonomous-cycle:${mission.id}`,
      );

    if (evidence.length !== 1) {
      throw new Error(
        "Exactly one persisted Project Memory evidence entry is required",
      );
    }

    return this.#learningEngine.recordFailedExercise({
      proposalId,
      missionId: mission.id,
      executionId: execution.id,
      evaluationId: evaluation.id,
      evaluationScore: evaluation.score,
      failedCheckIds,
      evidenceMemoryId: evidence[0].id,
      projectId,
      reason: mission.lastError ?? "Provider output failed deterministic evaluation",
    });
  }

  snapshot(): ForgeRuntimeSnapshot {
    const missionLoop = this.#missionLoop.snapshot();

    return Object.freeze({
      kernel: this.#kernel.stateSnapshot(),
      binding: runtimeBinding,
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
      learning: this.#learningEngine.summary(),
      autonomy: this.#autonomyEngine.summary(),
      memoryBridge: this.#memoryBridge.summary(),
      events: this.#events.snapshot(),
    });
  }

  binding(): typeof runtimeBinding {
    return runtimeBinding;
  }
}

export const forgeRuntime = new ForgeRuntime();
