export type KernelStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export type MissionStatus =
  | "not_started"
  | "awaiting_approval"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

export type CapabilityStatus =
  | "unavailable"
  | "experimental"
  | "validated"
  | "operational";

export type EvolutionPlanStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "completed"
  | "cancelled";

export interface RuntimeEvent {
  readonly sequence: number;
  readonly type: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RuntimeSnapshot {
  readonly kernel: {
    readonly status: KernelStatus;
    readonly revision: number;
    readonly startedAt: string | null;
    readonly updatedAt: string;
    readonly lastError: string | null;
  };
  readonly health: {
    readonly status: "ok" | "degraded";
    readonly kernelStatus: KernelStatus;
    readonly checkedAt: string;
    readonly startedAt: string | null;
    readonly uptimeMs: number;
    readonly eventCount: number;
  };
  readonly persistence: {
    readonly runtimeId: string;
    readonly sessionId: string | null;
    readonly restartCount: number;
    readonly recoveryCount: number;
    readonly lastKnownKernelStatus: KernelStatus;
    readonly lastShutdownClean: boolean;
    readonly recoveredFromStatus: KernelStatus | null;
  };
  readonly missionLoop: {
    readonly status: "stopped" | "running";
    readonly currentMissionId: string | null;
    readonly pollIntervalMs: number;
  };
  readonly missions: {
    readonly total: number;
    readonly awaitingApproval: number;
    readonly queued: number;
    readonly running: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly currentMissionId: string | null;
  };
  readonly governance: {
    readonly policyVersion: string;
    readonly total: number;
    readonly pending: number;
    readonly approved: number;
    readonly rejected: number;
  };
  readonly capabilities: {
    readonly total: number;
    readonly unavailable: number;
    readonly experimental: number;
    readonly validated: number;
    readonly operational: number;
    readonly analyses: number;
  };
  readonly evolution: {
    readonly total: number;
    readonly proposed: number;
    readonly approved: number;
    readonly executing: number;
    readonly completed: number;
    readonly cancelled: number;
  };
  readonly learning: LearningSummary;
  readonly autonomy: AutonomousSummary;
  readonly events: readonly RuntimeEvent[];
}

export interface AutonomousBacklogItem {
  readonly id: string;
  readonly objective: string;
  readonly selectionReason: string;
  readonly expectedNewEvidence: readonly string[];
  readonly priority: number;
  readonly status:
    | "proposed"
    | "scheduled"
    | "running"
    | "completed"
    | "failed"
    | "blocked";
  readonly source: string;
  readonly files: readonly string[];
  readonly missionId: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutonomousSummary {
  readonly enabled: boolean;
  readonly loopStatus: "stopped" | "running";
  readonly loopPaused: boolean;
  readonly pauseReason: string | null;
  readonly pauseDetails: string | null;
  readonly pauseUntil: string | null;
  readonly pauseRequiresResume: boolean;
  readonly lastTickAt: string | null;
  readonly totalTicks: number;
  readonly cyclesScheduled: number;
  readonly lowRiskApprovalsAutoGranted: number;
  readonly blockedByHardGovernance: boolean;
  readonly blockingApprovalId: string | null;
  readonly blockingRiskLevel: "low" | "medium" | "high" | "critical" | null;
  readonly scheduledWorkspacePlans: readonly string[];
  readonly backlog: readonly AutonomousBacklogItem[];
  readonly pendingApprovals: number;
  readonly pendingHardApprovals: number;
  readonly queuedMissions: number;
  readonly runningMissions: number;
  readonly awaitingApprovalMissions: number;
  readonly latestMissionId: string | null;
  readonly costBudgetUsd: number;
  readonly costSpentUsd: number;
  readonly costRemainingUsd: number;
}

export interface MissionRecord {
  readonly id: string;
  readonly kind:
    | "runtime.self-check"
    | "runtime.stability-window"
    | "operator.autonomous-cycle"
    | "operator.workspace-plan"
    | "operator.workspace-change"
    | "operator.mirror-intake";
  readonly title: string;
  readonly status: MissionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly attempts: number;
  readonly interruptedCount: number;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, unknown>> | null;
  readonly lastError: string | null;
}

export interface GovernanceAssessment {
  readonly policyVersion: string;
  readonly action: string;
  readonly missionKind: MissionRecord["kind"];
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly decision: "allow" | "require_approval" | "deny";
  readonly reason: string;
  readonly assessedAt: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly missionId: string;
  readonly status: ApprovalStatus;
  readonly assessment: GovernanceAssessment;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly note: string | null;
}

export interface ApprovalListResponse {
  readonly summary: RuntimeSnapshot["governance"];
  readonly approvals: readonly ApprovalRecord[];
}

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

export interface CapabilityAnalysisRecord {
  readonly id: string;
  readonly objective: string;
  readonly decision:
    | "execute_directly"
    | "improve_then_execute";
  readonly gaps: readonly {
    readonly capabilityId: string;
    readonly requiredStatus: CapabilityStatus;
    readonly actualStatus: CapabilityStatus | null;
    readonly reason: string;
  }[];
  readonly createdAt: string;
}

export interface EvolutionPlanStep {
  readonly order: number;
  readonly capabilityId: string;
  readonly action: "implement" | "validate" | "promote";
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

export interface LearningSummary {
  readonly observations: number;
  readonly profiles: number;
  readonly proposals: number;
  readonly proposed: number;
  readonly scheduled: number;
  readonly completed: number;
  readonly failed: number;
  readonly lastObservedAt: string | null;
}

export interface LearningCapabilityProfile {
  readonly capabilityId: string;
  readonly score: number;
  readonly confidence: number;
  readonly observations: number;
  readonly passed: number;
  readonly failed: number;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly updatedAt: string;
}

export interface LearningObservation {
  readonly id: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly evaluationId: string;
  readonly evaluationScore: number;
  readonly outcome: "passed" | "failed";
  readonly sourceProposalId: string | null;
  readonly targetCapabilityId: string | null;
  readonly capabilityResult: "pass" | "gap" | null;
  readonly toolEvidenceMemoryId: string | null;
  readonly observedAt: string;
}

export interface LearningCapabilityMatrixEntry {
  readonly capabilityId: string;
  readonly name: string;
  readonly track: "human-intent";
  readonly maturity: "experimental";
  readonly dependencies: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly exerciseTypes: readonly string[];
  readonly operationalAuthority: false;
}

export interface LearningMissionProposal {
  readonly id: string;
  readonly sourceObservationId: string;
  readonly targetCapabilityId: string;
  readonly priority: number;
  readonly reason: string;
  readonly status: "proposed" | "scheduled" | "completed" | "failed";
  readonly scheduledMissionId: string | null;
  readonly resultObservationId: string | null;
  readonly createdAt: string;
  readonly scheduledAt: string | null;
  readonly completedAt: string | null;
}

export interface LearningStateResponse {
  readonly summary: LearningSummary;
  readonly profiles: readonly LearningCapabilityProfile[];
  readonly observations: readonly LearningObservation[];
  readonly proposals: readonly LearningMissionProposal[];
  readonly matrix: readonly LearningCapabilityMatrixEntry[];
}

export interface AiGatewayCostSummary {
  readonly providerId: "openai-responses" | "local-model" | "manual-fallback";
  readonly executions: number;
  readonly estimatedCostUsd: number;
}

export interface AiGatewaySummaryResponse {
  readonly configured: boolean;
  readonly providerId: "openai-responses" | "local-model" | "manual-fallback" | null;
  readonly model: string | null;
  readonly executions: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly unavailable: number;
  readonly totalEstimatedCostUsd: number;
  readonly budgetLimitUsd: number;
  readonly budgetRemainingUsd: number;
  readonly byProvider: readonly AiGatewayCostSummary[];
  readonly lastExecutionAt: string | null;
}

export interface CreateMissionRequest {
  readonly kind: MissionRecord["kind"];
  readonly title?: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export type MissionCreationResponse =
  MissionRecord & {
    readonly governance: GovernanceAssessment;
    readonly approval: ApprovalRecord | null;
    readonly capabilityAnalysis: CapabilityAnalysisRecord;
  };

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed: ${response.status} ${response.statusText}`;

    throw new Error(errorMessage);
  }

  return payload as T;
}

export const forgeApi = {
  runtime(): Promise<RuntimeSnapshot> {
    return requestJson("/api/runtime");
  },

  missions(): Promise<{ readonly missions: readonly MissionRecord[] }> {
    return requestJson("/api/missions");
  },

  approvals(): Promise<ApprovalListResponse> {
    return requestJson("/api/governance/approvals");
  },

  capabilities(): Promise<{
    readonly capabilities: readonly CapabilityRecord[];
  }> {
    return requestJson("/api/capabilities");
  },

  analyses(): Promise<{
    readonly analyses: readonly CapabilityAnalysisRecord[];
  }> {
    return requestJson("/api/capability-analysis");
  },

  evolutionPlans(): Promise<{
    readonly plans: readonly EvolutionPlanRecord[];
  }> {
    return requestJson("/api/evolution-plans");
  },

  learning(): Promise<LearningStateResponse> {
    return requestJson("/api/learning");
  },

  autonomy(): Promise<AutonomousSummary> {
    return requestJson("/api/autonomy");
  },

  startAutonomy(): Promise<AutonomousSummary> {
    return requestJson("/api/autonomy/start", {
      method: "POST",
      body: "{}",
    });
  },

  resumeAutonomy(): Promise<AutonomousSummary> {
    return requestJson("/api/autonomy/resume", {
      method: "POST",
      body: "{}",
    });
  },

  stopAutonomy(): Promise<AutonomousSummary> {
    return requestJson("/api/autonomy/stop", {
      method: "POST",
      body: "{}",
    });
  },

  scheduleLearningProposal(proposalId: string): Promise<unknown> {
    return requestJson(
      `/api/learning/proposals/${proposalId}/schedule`,
      {
        method: "POST",
        body: "{}",
      },
    );
  },

  scheduleWorkspacePlan(missionId: string): Promise<unknown> {
    return requestJson(
      `/api/operator/workspace-plans/${missionId}/schedule`,
      {
        method: "POST",
        body: "{}",
      },
    );
  },

  createMission(
    request: CreateMissionRequest,
  ): Promise<MissionCreationResponse> {
    return requestJson("/api/missions", {
      method: "POST",
      body: JSON.stringify(request),
    });
  },

  approveApproval(
    approvalId: string,
    actor: string,
    note?: string,
  ): Promise<unknown> {
    return requestJson(
      `/api/governance/approvals/${approvalId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ actor, note }),
      },
    );
  },

  rejectApproval(
    approvalId: string,
    actor: string,
    note?: string,
  ): Promise<unknown> {
    return requestJson(
      `/api/governance/approvals/${approvalId}/reject`,
      {
        method: "POST",
        body: JSON.stringify({ actor, note }),
      },
    );
  },

  approveEvolutionPlan(
    planId: string,
    actor: string,
  ): Promise<EvolutionPlanRecord> {
    return requestJson(
      `/api/evolution-plans/${planId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ actor }),
      },
    );
  },

  executeEvolutionPlan(
    planId: string,
  ): Promise<EvolutionPlanRecord> {
    return requestJson(
      `/api/evolution-plans/${planId}/execute`,
      {
        method: "POST",
        body: "{}",
      },
    );
  },
};
