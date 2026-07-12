export type ProjectMemoryKind =
  | "decision"
  | "architecture"
  | "requirement"
  | "task"
  | "evidence"
  | "note";

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectMemoryEntry {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ProjectMemoryKind;
  readonly content: string;
  readonly tags: readonly string[];
  readonly source: string;
  readonly createdAt: string;
}

export interface CreateProjectMemoryRequest {
  readonly kind: ProjectMemoryKind;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly source?: string;
}

export type ModelTaskType =
  | "reasoning"
  | "coding"
  | "analysis"
  | "summarization";

export type ModelPrivacy =
  | "local-only"
  | "private"
  | "standard";

export type ModelBudget =
  | "low"
  | "medium"
  | "high";

export interface ModelRouteRequest {
  readonly taskType: ModelTaskType;
  readonly privacy: ModelPrivacy;
  readonly budget: ModelBudget;
  readonly contextChars: number;
  readonly requiresTools?: boolean;
}

export interface ModelProfile {
  readonly id: string;
  readonly label: string;
  readonly executionMode: "routing-only";
  readonly providerBinding: null;
  readonly maxContextChars: number;
  readonly privacyModes: readonly ModelPrivacy[];
  readonly taskStrengths: Readonly<
    Record<ModelTaskType, number>
  >;
  readonly costTier: number;
  readonly supportsTools: boolean;
}

export interface ModelRouteCandidate {
  readonly profileId: string;
  readonly eligible: boolean;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface ModelRouteDecision {
  readonly selectedProfile: ModelProfile;
  readonly request: ModelRouteRequest;
  readonly candidates: readonly ModelRouteCandidate[];
  readonly rationale: string;
  readonly routedAt: string;
}

export interface WorkspaceFileSummary {
  readonly path: string;
  readonly type: "file" | "directory";
  readonly sizeBytes: number | null;
  readonly modifiedAt: string;
}

export interface WorkspaceFileContent {
  readonly path: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

export interface PromptComposeRequest {
  readonly projectId: string;
  readonly objective: string;
  readonly taskType: ModelTaskType;
  readonly privacy: ModelPrivacy;
  readonly budget: ModelBudget;
  readonly files?: readonly string[];
  readonly memoryKinds?: readonly ProjectMemoryKind[];
}

export interface PromptComposition {
  readonly id: string;
  readonly projectId: string;
  readonly objective: string;
  readonly route: ModelRouteDecision;
  readonly memoryIds: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly content: string;
  readonly createdAt: string;
}

export interface OperatorCoreSummary {
  readonly projects: number;
  readonly memories: number;
  readonly compositions: number;
  readonly lastCompositionAt: string | null;
  readonly modelProfiles: number;
  readonly workspaceConnector: "read-only";
}