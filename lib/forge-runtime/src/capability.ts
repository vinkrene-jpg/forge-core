import type { MissionKind } from "./mission";

export type CapabilityStatus =
  | "unavailable"
  | "experimental"
  | "validated"
  | "operational";

export interface CapabilityRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: CapabilityStatus;
  readonly version: string;
  readonly confidence: number;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertCapabilityRequest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: CapabilityStatus;
  readonly version: string;
  readonly confidence: number;
  readonly source: string;
}

export interface CapabilityRequirement {
  readonly capabilityId: string;
  readonly minimumStatus: CapabilityStatus;
  readonly reason: string;
}

export interface CapabilityGap {
  readonly capabilityId: string;
  readonly requiredStatus: CapabilityStatus;
  readonly actualStatus: CapabilityStatus | null;
  readonly reason: string;
}

export type CapabilityAnalysisDecision =
  | "execute_directly"
  | "improve_then_execute";

export interface CapabilityAnalysisRequest {
  readonly objective: string;
  readonly requirements: readonly CapabilityRequirement[];
  readonly expectedReuse?: number;
  readonly missionCriticality?: number;
}

export interface CapabilityAnalysisRecord {
  readonly id: string;
  readonly objective: string;
  readonly sourceType: "mission" | "manual";
  readonly sourceMissionKind: MissionKind | null;
  readonly requirements: readonly CapabilityRequirement[];
  readonly gaps: readonly CapabilityGap[];
  readonly decision: CapabilityAnalysisDecision;
  readonly expectedReuse: number;
  readonly missionCriticality: number;
  readonly createdAt: string;
}

export interface CapabilitySummary {
  readonly total: number;
  readonly unavailable: number;
  readonly experimental: number;
  readonly validated: number;
  readonly operational: number;
  readonly analyses: number;
}

export type EvolutionPlanStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "completed"
  | "cancelled";

export type EvolutionStepAction =
  | "implement"
  | "validate"
  | "promote";

export interface EvolutionPlanStep {
  readonly order: number;
  readonly capabilityId: string;
  readonly action: EvolutionStepAction;
  readonly fromStatus: CapabilityStatus | null;
  readonly toStatus: CapabilityStatus;
  readonly acceptanceCriteria: readonly string[];
}

export interface EvolutionVerificationEvidence {
  readonly capabilityId: string;
  readonly verifierId: string;
  readonly verifiedAt: string;
  readonly passed: boolean;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface EvolutionPlanRecord {
  readonly id: string;
  readonly analysisId: string;
  readonly objective: string;
  readonly status: EvolutionPlanStatus;
  readonly roiScore: number;
  readonly steps: readonly EvolutionPlanStep[];
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly lastError: string | null;
  readonly evidence: readonly EvolutionVerificationEvidence[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvolutionPlanSummary {
  readonly total: number;
  readonly proposed: number;
  readonly approved: number;
  readonly executing: number;
  readonly completed: number;
  readonly cancelled: number;
}