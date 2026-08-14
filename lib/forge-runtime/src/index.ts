export {
  AiGatewayEngine,
  type AiGatewayEngineOptions,
} from "./ai-gateway-engine";

export {
  createInitialAiGatewayState,
  FileAiGatewayStateStore,
  resolveAiGatewayStatePath,
  AI_GATEWAY_STORE_VERSION,
  type AiGatewayStateStore,
  type PersistedAiGatewayState,
} from "./ai-gateway-store";

export {
  type AiExecutionRecord,
  type AiExecutionStatus,
  type AiGatewayStatus,
  type AiGatewaySummary,
  type AiProviderConnector,
  type AiProviderId,
  type AiProviderResult,
  type AiUsage,
} from "./ai-gateway";

export {
  OpenAiResponsesConnector,
} from "./openai-responses-connector";
export {
  LocalModelConnector,
} from "./local-model-connector";
export {
  ManualFallbackConnector,
} from "./manual-fallback-connector";
export {
  FileMemoryBridge,
  type MemoryBridgeKind,
  type MemoryBridgeEntry,
  type MemoryBridgeContext,
  type SearchMemoryBridgeRequest,
  type SearchMemoryBridgeResult,
  type RelevantContextRequest,
  type RelevantContextResult,
  type RecordDecisionRequest,
  type RecordLearningRequest,
  type RecordCapabilityRequest,
  type UpsertContextRequest,
  type MemoryBridgeSummary,
  type MemoryBridgeOptions,
} from "./memory-bridge";
export {
  AutonomousEngine,
  type AutonomousEngineOptions,
} from "./autonomy-engine";
export {
  cloneAutonomyState,
  createInitialAutonomyState,
  missionCounts,
  requiresHardGovernanceBoundary,
  type AutonomousBacklogItem,
  type AutonomousBacklogStatus,
  type AutonomousRuntimeState,
  type AutonomousRuntimeSummary,
} from "./autonomy";
export {
  createInitialPersistedAutonomyState,
  FileAutonomyStateStore,
  resolveAutonomyStatePath,
  AUTONOMY_STORE_VERSION,
  type AutonomyStateStore,
  type PersistedAutonomyState,
} from "./autonomy-store";
export {
  AutonomousOutputEvaluator,
  classifyAutonomousObjective,
  extractAutonomousWorkspaceTargets,
  parseCapabilityResult,
  parseAutonomousCycleInput,
  type AutonomousCycleInput,
  type AutonomousEvaluation,
  type AutonomousEvaluationCheck,
} from "./autonomous-cycle";

export {
  LearningEvidenceTool,
  type LearningEvidenceBundle,
  type LearningEvidenceToolOptions,
} from "./learning-evidence-tool";

export {
  getLearningMatrixEntry,
  listLearningMatrixEntries,
  type LearningCapabilityMatrixEntry,
  type LearningExerciseType,
} from "./learning-matrix";
export {
  ModelRouter,
} from "./model-router";

export {
  OperatorCore,
  type OperatorCoreOptions,
} from "./operator-core";

export {
  createInitialOperatorState,
  FileOperatorStateStore,
  resolveOperatorStatePath,
  OPERATOR_STORE_VERSION,
  type OperatorStateStore,
  type PersistedOperatorState,
} from "./operator-store";

export {
  type CreateProjectMemoryRequest,
  type ModelBudget,
  type ModelPrivacy,
  type ModelProfile,
  type ModelRouteCandidate,
  type ModelRouteDecision,
  type ModelRouteRequest,
  type ModelTaskType,
  type OperatorCoreSummary,
  type ProjectMemoryEntry,
  type ProjectMemoryKind,
  type ProjectRecord,
  type PromptComposeRequest,
  type PromptComposition,
  type WorkspaceFileContent,
  type WorkspaceFileSummary,
} from "./operator";

export {
  WorkspaceConnector,
} from "./workspace-connector";

export {
  NodeWorkspaceVerificationRunner,
  parseWorkspaceChangeRequest,
  WorkspaceExecutionError,
  WorkspaceExecutor,
  type WorkspaceChangeRequest,
  type WorkspaceCommandResult,
  type WorkspaceCommitRequest,
  type WorkspaceExecutionResult,
  type WorkspaceFileChange,
  type WorkspaceVerificationRunner,
  type WorkspaceVerificationEvidence,
  type WorkspaceVerificationStep,
} from "./workspace-executor";

export {
  FileWorkspaceBridgeClient,
  WorkspaceBridgeHost,
  type WorkspaceChangeExecutor,
} from "./workspace-bridge";

export {
  parseWorkspaceProviderPlan,
  type WorkspaceChangePlan,
  type WorkspacePlanningTarget,
} from "./workspace-change-planner";
export {
  CapabilityAnalyzer,
  requirementsForMission,
} from "./capability-analysis";

export {
  CapabilityRegistry,
  type CapabilityRegistryOptions,
} from "./capability-registry";

export {
  createInitialCapabilityState,
  FileCapabilityStateStore,
  resolveCapabilityStatePath,
  CAPABILITY_STORE_VERSION,
  type CapabilityStateStore,
  type PersistedCapabilityState,
} from "./capability-store";

export {
  type CapabilityAnalysisDecision,
  type CapabilityAnalysisRecord,
  type CapabilityAnalysisRequest,
  type CapabilityGap,
  type CapabilityRecord,
  type CapabilityRequirement,
  type CapabilityStatus,
  type CapabilitySummary,
  type EvolutionPlanRecord,
  type EvolutionPlanStatus,
  type EvolutionPlanStep,
  type EvolutionPlanSummary,
  type EvolutionStepAction,
  type EvolutionVerificationEvidence,
  type UpsertCapabilityRequest,
} from "./capability";

export {
  RuntimeEventBus,
  type RuntimeEvent,
  type RuntimeEventListener,
  type RuntimeEventType,
} from "./event-bus";

export {
  EvolutionEngine,
  type EvolutionEngineOptions,
} from "./evolution-engine";

export {
  EvolutionPlanner,
} from "./evolution-planner";

export {
  GovernanceEngine,
  type GovernanceEngineOptions,
} from "./governance-engine";

export {
  createInitialGovernanceState,
  FileGovernanceStateStore,
  resolveGovernanceStatePath,
  GOVERNANCE_STORE_VERSION,
  type GovernanceStateStore,
  type PersistedGovernanceState,
} from "./governance-store";

export {
  assessMissionRequest,
  GOVERNANCE_POLICY_VERSION,
  type ApprovalDecisionResult,
  type ApprovalRecord,
  type ApprovalStatus,
  type GovernanceAssessment,
  type GovernanceDecision,
  type GovernanceRiskLevel,
  type GovernanceSummary,
  type MissionCreationResult,
} from "./governance";

export {
  ForgeKernel,
  type RuntimeHealthSnapshot,
} from "./kernel";

export {
  MissionAbortError,
  MissionEngine,
  type MissionEngineOptions,
} from "./mission-engine";

export {
  MissionLoop,
  type MissionLoopOptions,
} from "./mission-loop";

export {
  buildGuardianReviewContext,
  combineGuardianReview,
  deriveMissionGuardianReview,
  deriveMissionGovernorDecision,
  deriveMissionReview,
  GUARDIAN_AI_INSTRUCTIONS,
  parseGuardianAiVerdict,
  type MissionGuardianAiVerdict,
  type MissionGuardianFinding,
  type MissionGuardianOutcome,
  type MissionGuardianReview,
  type MissionGovernorDecision,
  type MissionGovernorVerdict,
  type MissionReview,
  type MissionReviewBasis,
  type MissionReviewSeverity,
} from "./mission-review";

export {
  reviewMissionWithGuardianAi,
  type GuardianAiExecutionResult,
  type GuardianAiReviewDeps,
} from "./mission-ai-review";

export {
  createInitialMissionState,
  FileMissionStateStore,
  resolveMissionStatePath,
  MISSION_STORE_VERSION,
  type MissionStateStore,
  type PersistedMissionState,
} from "./mission-store";

export {
  type CreateMissionRequest,
  type MissionKind,
  type MissionLoopSnapshot,
  type MissionRecord,
  type MissionStatus,
  type MissionSummary,
} from "./mission";

export {
  createInitialRuntimeState,
  FileRuntimeStateStore,
  resolveRuntimeStatePath,
  RUNTIME_STATE_VERSION,
  type PersistedRuntimeState,
  type RuntimeStateStore,
} from "./persistence";

export {
  KernelRuntimeState,
  type KernelStateSnapshot,
  type KernelStatus,
} from "./runtime-state";

export {
  ForgeRuntime,
  forgeRuntime,
  type ForgeRuntimeOptions,
  type ForgeRuntimeSnapshot,
  type RuntimeMissionCreationResult,
} from "./runtime";

export {
  LearningEngine,
  type LearningEngineOptions,
} from "./learning-engine";

export {
  createInitialLearningState,
  FileLearningStateStore,
  resolveLearningStatePath,
  LEARNING_STORE_VERSION,
  type LearningStateStore,
  type PersistedLearningState,
} from "./learning-store";

export {
  type LearningCapabilityProfile,
  type LearningEvidenceReference,
  type LearningMissionProposal,
  type LearningMissionTemplate,
  type LearningObservation,
  type LearningOutcome,
  type LearningProposalStatus,
  type LearningSignal,
  type LearningSummary,
  type ObserveAutonomousLearningRequest,
  type RecordFailedLearningExerciseRequest,
} from "./learning";
