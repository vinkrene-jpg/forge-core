import { randomUUID } from "node:crypto";
import type { RuntimeEventBus } from "./event-bus";
import type { CapabilityRecord, CapabilityStatus } from "./capability";
import {
  createInitialLearningState,
  FileLearningStateStore,
  LEARNING_STORE_VERSION,
  type LearningStateStore,
  type PersistedLearningState,
} from "./learning-store";
import type {
  LearningCapabilityProfile,
  LearningMissionProposal,
  LearningObservation,
  LearningSignal,
  LearningSummary,
  ObserveAutonomousLearningRequest,
  RecordFailedLearningExerciseRequest,
} from "./learning";
import {
  getLearningMatrixEntry,
  listLearningMatrixEntries,
} from "./learning-matrix";

export interface LearningEngineOptions {
  readonly events: RuntimeEventBus;
  readonly stateStore?: LearningStateStore;
  readonly getCapabilities: () => readonly CapabilityRecord[];
}

const statusSeed: Readonly<Record<CapabilityStatus, number>> = {
  unavailable: 0,
  experimental: 35,
  validated: 70,
  operational: 90,
};

const RECENT_SUCCESS_WINDOW = 3;

function cloneObservation(
  observation: LearningObservation,
): LearningObservation {
  return Object.freeze({
    ...observation,
    sourceProposalId: observation.sourceProposalId ?? null,
    targetCapabilityId: observation.targetCapabilityId ?? null,
    capabilityResult: observation.capabilityResult ?? null,
    toolEvidenceMemoryId: observation.toolEvidenceMemoryId ?? null,
    signals: Object.freeze(
      observation.signals.map((signal) => Object.freeze({ ...signal })),
    ),
    evidence: Object.freeze(
      observation.evidence.map((reference) => Object.freeze({ ...reference })),
    ),
  });
}

function cloneProfile(
  profile: LearningCapabilityProfile,
): LearningCapabilityProfile {
  return Object.freeze({
    ...profile,
    evidenceIds: Object.freeze([...profile.evidenceIds]),
  });
}

function cloneProposal(
  proposal: LearningMissionProposal,
): LearningMissionProposal {
  return Object.freeze({
    ...proposal,
    resultObservationId: proposal.resultObservationId ?? null,
    completedAt: proposal.completedAt ?? null,
    mission: Object.freeze({
      ...proposal.mission,
      input: Object.freeze({
        ...proposal.mission.input,
        files: Object.freeze([...proposal.mission.input.files]),
      }),
    }),
  });
}

function boundedScore(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }

  return Math.round(value);
}

function rankedEligibleProfiles(
  profiles: ReadonlyMap<string, LearningCapabilityProfile>,
  recentSuccessfulCapabilityIds: readonly string[],
): readonly LearningCapabilityProfile[] {
  const all = [...profiles.values()];
  const eligible = all.filter((profile) => {
    const matrixEntry = getLearningMatrixEntry(profile.capabilityId);

    return (
      !matrixEntry ||
      matrixEntry.dependencies.every(
        (dependency) => (profiles.get(dependency)?.score ?? 0) >= 70,
      )
    );
  });

  const sorted = [...eligible];


  const recentlySuccessful = new Set(recentSuccessfulCapabilityIds);

  return sorted.sort((left, right) => {
    const leftRecent = recentlySuccessful.has(left.capabilityId) ? 1 : 0;
    const rightRecent = recentlySuccessful.has(right.capabilityId) ? 1 : 0;

    return (
      leftRecent - rightRecent ||
      directBlockageScore(right.capabilityId) -
        directBlockageScore(left.capabilityId) ||
      left.score - right.score ||
      left.observations - right.observations ||
      left.confidence - right.confidence ||
      left.capabilityId.localeCompare(right.capabilityId)
    );
  });
}

function directBlockageScore(
  capabilityId: string,
): number {
  return listLearningMatrixEntries().filter((entry) =>
    entry.dependencies.includes(capabilityId),
  ).length;
}

function getRecentSuccessfulCapabilityIds(
  observations: readonly LearningObservation[],
): readonly string[] {
  return [...observations]
    .filter((observation) => observation.outcome === "passed")
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    .slice(0, RECENT_SUCCESS_WINDOW)
    .map((observation) => observation.targetCapabilityId)
    .filter((capabilityId): capabilityId is string => Boolean(capabilityId));
}

function buildLearningSelection(
  profile: LearningCapabilityProfile,
  observations: readonly LearningObservation[],
): {
  readonly reasonForSelection: string;
  readonly expectedNewEvidence: readonly string[];
} {
  const matrixEntry = getLearningMatrixEntry(profile.capabilityId);
  const recentSuccessCapabilityIds = new Set(
    getRecentSuccessfulCapabilityIds(observations),
  );
  const expectedNewEvidence = matrixEntry
    ? matrixEntry.evidenceRequirements
    : Object.freeze([
        "Updated runtime evidence",
        "A concrete verification result",
        "A non-repeated capability signal",
      ]);
  const reasonForSelection = matrixEntry
    ? `Selected because ${profile.capabilityId} is a current open blockage with ${directBlockageScore(profile.capabilityId)} downstream dependents and ${recentSuccessCapabilityIds.has(profile.capabilityId) ? "recent success evidence exists, so this capability is now deprioritized" : "no recent successful repeat blocks it"}.`
    : `Selected because ${profile.capabilityId} is the current lowest evidence-backed gap without repeating the most recent successful capability.`;

  return Object.freeze({
    reasonForSelection,
    expectedNewEvidence,
  });
}

export class LearningEngine {
  readonly #events: RuntimeEventBus;
  readonly #stateStore: LearningStateStore;
  readonly #getCapabilities: () => readonly CapabilityRecord[];
  #state: PersistedLearningState = createInitialLearningState();

  constructor(options: LearningEngineOptions) {
    this.#events = options.events;
    this.#stateStore = options.stateStore ?? new FileLearningStateStore();
    this.#getCapabilities = options.getCapabilities;
  }

  async initialize(): Promise<void> {
    const loaded = await this.#stateStore.load();

    this.#state = Object.freeze({
      version: LEARNING_STORE_VERSION,
      observations: Object.freeze(loaded.observations.map(cloneObservation)),
      profiles: Object.freeze(loaded.profiles.map(cloneProfile)),
      proposals: Object.freeze(loaded.proposals.map(cloneProposal)),
    });

    this.#events.publish("learning.state.loaded", {
      observations: this.#state.observations.length,
      profiles: this.#state.profiles.length,
      proposals: this.#state.proposals.length,
    });
  }

  listObservations(): readonly LearningObservation[] {
    return this.#state.observations.map(cloneObservation);
  }

  listProfiles(): readonly LearningCapabilityProfile[] {
    return this.#state.profiles.map(cloneProfile);
  }

  getProfile(capabilityId: string): LearningCapabilityProfile | null {
    const profile = this.#state.profiles.find(
      (candidate) => candidate.capabilityId === capabilityId,
    );

    return profile ? cloneProfile(profile) : null;
  }

  listProposals(): readonly LearningMissionProposal[] {
    return this.#state.proposals.map(cloneProposal);
  }

  getProposal(proposalId: string): LearningMissionProposal | null {
    const proposal = this.#state.proposals.find(
      (candidate) => candidate.id === proposalId,
    );

    return proposal ? cloneProposal(proposal) : null;
  }

  summary(): LearningSummary {
    const proposals = this.#state.proposals;

    return Object.freeze({
      observations: this.#state.observations.length,
      profiles: this.#state.profiles.length,
      proposals: proposals.length,
      proposed: proposals.filter((proposal) => proposal.status === "proposed")
        .length,
      scheduled: proposals.filter((proposal) => proposal.status === "scheduled")
        .length,
      completed: proposals.filter((proposal) => proposal.status === "completed")
        .length,
      failed: proposals.filter((proposal) => proposal.status === "failed")
        .length,
      lastObservedAt: this.#state.observations.at(-1)?.observedAt ?? null,
    });
  }

  async observeAutonomousCycle(
    request: ObserveAutonomousLearningRequest,
  ): Promise<{
    readonly observation: LearningObservation;
    readonly proposal: LearningMissionProposal;
  }> {
    const existing = this.#state.observations.find(
      (observation) => observation.missionId === request.missionId,
    );

    if (existing) {
      const existingProposal = this.#state.proposals.find(
        (proposal) => proposal.sourceObservationId === existing.id,
      );

      if (!existingProposal) {
        throw new Error("Learning state is missing its proposal");
      }

      return Object.freeze({
        observation: cloneObservation(existing),
        proposal: cloneProposal(existingProposal),
      });
    }

    const evaluationScore = boundedScore(
      request.evaluationScore,
      "evaluationScore",
    );
    const accepted =
      request.executionStatus === "succeeded" &&
      request.evaluationDecision === "accepted";
    const sourceProposalId = request.sourceProposalId?.trim() || null;
    const targetCapabilityId = request.targetCapabilityId?.trim() || null;

    if ((sourceProposalId === null) !== (targetCapabilityId === null)) {
      throw new Error(
        "sourceProposalId and targetCapabilityId must be supplied together",
      );
    }

    const sourceProposal = sourceProposalId
      ? this.#state.proposals.find(
          (proposal) => proposal.id === sourceProposalId,
        )
      : null;

    if (
      sourceProposalId &&
      (!sourceProposal ||
        sourceProposal.status !== "scheduled" ||
        sourceProposal.scheduledMissionId !== request.missionId ||
        sourceProposal.targetCapabilityId !== targetCapabilityId)
    ) {
      throw new Error(
        "Learning feedback does not match a scheduled proposal mission",
      );
    }

    const uniqueCapabilityIds = [
      ...new Set([
        ...request.capabilityIds,
        ...(targetCapabilityId ? [targetCapabilityId] : []),
      ]),
    ].sort();

    if (uniqueCapabilityIds.length === 0) {
      throw new Error("At least one capabilityId is required");
    }

    const signals: LearningSignal[] = uniqueCapabilityIds.map(
      (capabilityId) => {
        let score = evaluationScore;
        let rationale = `Accepted evaluation ${request.evaluationId} scored ${evaluationScore}.`;

        if (capabilityId === "ai.provider.execute") {
          score = request.executionStatus === "succeeded" ? 100 : 0;
          rationale = `Provider execution ${request.executionId} was ${request.executionStatus}.`;
        } else if (capabilityId === "evaluation.output.assess") {
          rationale = `Evaluation ${request.evaluationId} was ${request.evaluationDecision} with score ${evaluationScore}.`;
        } else if (capabilityId === "mission.autonomous.continue") {
          score = accepted ? 100 : 0;
          rationale = accepted
            ? "The bounded cycle produced accepted continuation evidence."
            : "The cycle did not produce accepted continuation evidence.";
        } else if (capabilityId === targetCapabilityId) {
          score =
            accepted && request.capabilityResult === "pass"
              ? evaluationScore
              : 0;
          rationale = accepted
            ? `Governed learning proposal ${sourceProposalId} produced accepted ` +
              `${request.capabilityResult ?? "unclassified"} evidence scoring ${evaluationScore}.`
            : `Governed learning proposal ${sourceProposalId} did not produce accepted evidence.`;
        }

        return Object.freeze({
          capabilityId,
          score,
          outcome: score >= 70 ? "passed" : "failed",
          rationale,
        });
      },
    );
    const observedAt = new Date().toISOString();
    const observation: LearningObservation = Object.freeze({
      id: randomUUID(),
      missionId: request.missionId,
      missionKind: request.missionKind,
      executionId: request.executionId,
      evaluationId: request.evaluationId,
      evidenceMemoryId: request.evidenceMemoryId,
      sourceProposalId,
      targetCapabilityId,
      capabilityResult: request.capabilityResult ?? null,
      toolEvidenceMemoryId: request.toolEvidenceMemoryId ?? null,
      evaluationScore,
      outcome: accepted ? "passed" : "failed",
      signals: Object.freeze(signals),
      evidence: Object.freeze([
        Object.freeze({ type: "mission" as const, id: request.missionId }),
        Object.freeze({ type: "execution" as const, id: request.executionId }),
        Object.freeze({
          type: "evaluation" as const,
          id: request.evaluationId,
        }),
        Object.freeze({
          type: "project-memory" as const,
          id: request.evidenceMemoryId,
        }),
        ...(request.toolEvidenceMemoryId
          ? [
              Object.freeze({
                type: "project-memory" as const,
                id: request.toolEvidenceMemoryId,
              }),
            ]
          : []),
        ...uniqueCapabilityIds.map((id) =>
          Object.freeze({ type: "capability" as const, id }),
        ),
      ]),
      observedAt,
    });

    const profiles = new Map(
      this.#state.profiles.map((profile) => [profile.capabilityId, profile]),
    );

    for (const capability of this.#getCapabilities()) {
      if (profiles.has(capability.id)) {
        continue;
      }

      profiles.set(
        capability.id,
        Object.freeze({
          capabilityId: capability.id,
          score: Math.round(
            statusSeed[capability.status] * capability.confidence,
          ),
          confidence: Math.round(capability.confidence * 100) / 100,
          observations: 0,
          passed: 0,
          failed: 0,
          rationale:
            `Seeded from registry status ${capability.status} at ` +
            `${Math.round(capability.confidence * 100)}% confidence.`,
          evidenceIds: Object.freeze([capability.id]),
          updatedAt: observedAt,
        }),
      );
    }

    for (const signal of signals) {
      const current = profiles.get(signal.capabilityId);
      const observations = (current?.observations ?? 0) + 1;
      const priorTotal = (current?.score ?? 0) * (current?.observations ?? 0);
      const score = Math.round((priorTotal + signal.score) / observations);

      profiles.set(
        signal.capabilityId,
        Object.freeze({
          capabilityId: signal.capabilityId,
          score,
          confidence: Math.min(
            1,
            Math.round((0.5 + observations * 0.1) * 100) / 100,
          ),
          observations,
          passed:
            (current?.passed ?? 0) + (signal.outcome === "passed" ? 1 : 0),
          failed:
            (current?.failed ?? 0) + (signal.outcome === "failed" ? 1 : 0),
          rationale: signal.rationale,
          evidenceIds: Object.freeze(
            [
              ...(current?.evidenceIds ?? []),
              request.missionId,
              request.executionId,
              request.evaluationId,
              request.evidenceMemoryId,
            ].slice(-20),
          ),
          updatedAt: observedAt,
        }),
      );
    }

    const rankedProfiles = rankedEligibleProfiles(
      profiles,
      getRecentSuccessfulCapabilityIds(this.#state.observations),
    );
    const target = rankedProfiles[0];

    if (!target) {
      throw new Error("No capability profile is available for learning");
    }

    const targetCapability = this.#getCapabilities().find(
      (capability) => capability.id === target.capabilityId,
    );
    const matrixEntry = getLearningMatrixEntry(target.capabilityId);
    const selection = buildLearningSelection(target, this.#state.observations);
    const proposal: LearningMissionProposal = Object.freeze({
      id: randomUUID(),
      sourceObservationId: observation.id,
      targetCapabilityId: target.capabilityId,
      priority: 100 - target.score,
      reason:
        `${target.capabilityId} has the lowest evidence-backed score ` +
        `(${target.score}) at ${Math.round(target.confidence * 100)}% confidence.`,
      mission: Object.freeze({
        kind: "operator.autonomous-cycle" as const,
        title: `Learning evidence for ${target.capabilityId}`,
        input: Object.freeze({
          projectId: request.projectId,
          objective: matrixEntry
            ? `Run an isolated ${matrixEntry.exerciseTypes[0]} research exercise for ` +
              `${target.capabilityId}. Required evidence: ` +
              `${matrixEntry.evidenceRequirements.join("; ")}. ` +
              `This experimental track grants no operational authority.`
            : `Propose the smallest reversible verification exercise for ` +
              `capability ${target.capabilityId} (${targetCapability?.name ?? "unregistered"}). ` +
              `Use current repository evidence, state assumptions, acceptance criteria and exact tests.`,
          reasonForSelection: selection.reasonForSelection,
          expectedNewEvidence: selection.expectedNewEvidence,
          cycleIndex: 1 as const,
          maxCycles: 1 as const,
          ...(typeof request.maximumCostUsd === "number"
            ? { maximumCostUsd: request.maximumCostUsd }
            : {}),
          ...(typeof request.maximumDailyCostUsd === "number"
            ? { maximumDailyCostUsd: request.maximumDailyCostUsd }
            : {}),
          continuationAuthorized: false as const,
          files: Object.freeze([
            "GOVERNANCE/ROADMAP.md",
            "reconstruction/CURRENT_STATE.md",
            "reconstruction/NEXT_MISSION.md",
          ]),
        }),
      }),
      status: "proposed",
      scheduledMissionId: null,
      resultObservationId: null,
      createdAt: observedAt,
      scheduledAt: null,
      completedAt: null,
    });

    const proposals = this.#state.proposals.map((candidate) => {
      if (candidate.id !== sourceProposalId) {
        return candidate;
      }

      return Object.freeze({
        ...candidate,
        status: "completed" as const,
        resultObservationId: observation.id,
        completedAt: observedAt,
      });
    });

    await this.#save({
      observations: [...this.#state.observations, observation],
      profiles: [...profiles.values()].sort((left, right) =>
        left.capabilityId.localeCompare(right.capabilityId),
      ),
      proposals: [...proposals, proposal],
    });

    this.#events.publish("learning.observation.recorded", {
      observationId: observation.id,
      missionId: observation.missionId,
      outcome: observation.outcome,
      signals: observation.signals.length,
    });
    this.#events.publish("learning.proposal.created", {
      proposalId: proposal.id,
      targetCapabilityId: proposal.targetCapabilityId,
      capabilityResult: null,
      toolEvidenceMemoryId: null,
      priority: proposal.priority,
    });

    if (sourceProposalId) {
      this.#events.publish("learning.proposal.completed", {
        proposalId: sourceProposalId,
        missionId: request.missionId,
        observationId: observation.id,
        targetCapabilityId,
      });
    }

    return Object.freeze({
      observation: cloneObservation(observation),
      proposal: cloneProposal(proposal),
    });
  }

  async markProposalScheduled(
    proposalId: string,
    missionId: string,
  ): Promise<LearningMissionProposal> {
    const proposal = this.#state.proposals.find(
      (candidate) => candidate.id === proposalId,
    );

    if (!proposal) {
      throw new Error("Learning proposal not found");
    }

    if (proposal.status !== "proposed") {
      throw new Error("Learning proposal is already scheduled");
    }

    const scheduled: LearningMissionProposal = Object.freeze({
      ...proposal,
      status: "scheduled",
      scheduledMissionId: missionId,
      resultObservationId: null,
      scheduledAt: new Date().toISOString(),
      completedAt: null,
    });

    await this.#save({
      observations: this.#state.observations,
      profiles: this.#state.profiles,
      proposals: this.#state.proposals.map((candidate) =>
        candidate.id === proposalId ? scheduled : candidate,
      ),
    });

    this.#events.publish("learning.proposal.scheduled", {
      proposalId,
      missionId,
      targetCapabilityId: scheduled.targetCapabilityId,
    });

    return cloneProposal(scheduled);
  }

  async recordFailedExercise(
    request: RecordFailedLearningExerciseRequest,
  ): Promise<{
    readonly observation: LearningObservation;
    readonly failedProposal: LearningMissionProposal;
    readonly nextProposal: LearningMissionProposal;
  }> {
    const proposal = this.#state.proposals.find(
      (candidate) => candidate.id === request.proposalId,
    );

    if (
      !proposal ||
      proposal.status !== "scheduled" ||
      proposal.scheduledMissionId !== request.missionId
    ) {
      throw new Error(
        "Learning failure does not match a scheduled proposal mission",
      );
    }

    const existing = this.#state.observations.find(
      (observation) => observation.missionId === request.missionId,
    );

    if (existing) {
      throw new Error("Learning failure was already recorded");
    }

    const evaluationScore = boundedScore(
      request.evaluationScore,
      "evaluationScore",
    );
    const failedCheckIds = [...new Set(request.failedCheckIds)].sort();

    if (failedCheckIds.length === 0) {
      throw new Error("At least one failed evaluation check is required");
    }

    const observedAt = new Date().toISOString();
    const rationale =
      `Governed learning proposal ${proposal.id} failed evaluation ` +
      `${request.evaluationId} (${evaluationScore}); failed checks: ` +
      `${failedCheckIds.join(", ")}. ${request.reason.trim()}`;
    const signal: LearningSignal = Object.freeze({
      capabilityId: proposal.targetCapabilityId,
      score: 0,
      outcome: "failed",
      rationale,
    });
    const observation: LearningObservation = Object.freeze({
      id: randomUUID(),
      missionId: request.missionId,
      missionKind: "operator.autonomous-cycle",
      executionId: request.executionId,
      evaluationId: request.evaluationId,
      evidenceMemoryId: request.evidenceMemoryId,
      sourceProposalId: proposal.id,
      targetCapabilityId: proposal.targetCapabilityId,
      capabilityResult: null,
      toolEvidenceMemoryId: null,
      evaluationScore,
      outcome: "failed",
      signals: Object.freeze([signal]),
      evidence: Object.freeze([
        Object.freeze({ type: "mission" as const, id: request.missionId }),
        Object.freeze({
          type: "execution" as const,
          id: request.executionId,
        }),
        Object.freeze({
          type: "evaluation" as const,
          id: request.evaluationId,
        }),
        Object.freeze({
          type: "project-memory" as const,
          id: request.evidenceMemoryId,
        }),
        Object.freeze({
          type: "capability" as const,
          id: proposal.targetCapabilityId,
        }),
      ]),
      observedAt,
    });
    const profiles = new Map(
      this.#state.profiles.map((profile) => [profile.capabilityId, profile]),
    );
    const current = profiles.get(proposal.targetCapabilityId);

    if (!current) {
      throw new Error("Target capability profile is missing");
    }

    const observations = current.observations + 1;
    const score = Math.round(
      (current.score * current.observations) / observations,
    );

    profiles.set(
      proposal.targetCapabilityId,
      Object.freeze({
        ...current,
        score,
        confidence: Math.min(
          1,
          Math.round((0.5 + observations * 0.1) * 100) / 100,
        ),
        observations,
        failed: current.failed + 1,
        rationale,
        evidenceIds: Object.freeze(
          [
            ...current.evidenceIds,
            request.missionId,
            request.executionId,
            request.evaluationId,
            request.evidenceMemoryId,
          ].slice(-20),
        ),
        updatedAt: observedAt,
      }),
    );

    const failedProposal: LearningMissionProposal = Object.freeze({
      ...proposal,
      status: "failed",
      resultObservationId: observation.id,
      completedAt: observedAt,
    });
    const rankedProfiles = rankedEligibleProfiles(
      profiles,
      getRecentSuccessfulCapabilityIds(this.#state.observations),
    );
    const target = rankedProfiles[0];

    if (!target) {
      throw new Error("No capability profile is available after failure");
    }

    const targetCapability = this.#getCapabilities().find(
      (capability) => capability.id === target.capabilityId,
    );
    const matrixEntry = getLearningMatrixEntry(target.capabilityId);
    const selection = buildLearningSelection(target, this.#state.observations);
    const nextProposal: LearningMissionProposal = Object.freeze({
      id: randomUUID(),
      sourceObservationId: observation.id,
      targetCapabilityId: target.capabilityId,
      priority: 100 - target.score,
      reason:
        `${target.capabilityId} remains the highest evidence-backed gap ` +
        `after failed exercise ${proposal.id} (score ${target.score}).`,
      mission: Object.freeze({
        kind: "operator.autonomous-cycle" as const,
        title: `Recovery learning evidence for ${target.capabilityId}`,
        input: Object.freeze({
          projectId: request.projectId,
          objective: matrixEntry
            ? `Design a different isolated ${matrixEntry.exerciseTypes[0]} exercise for ` +
              `${target.capabilityId}. Preserve experimental status and collect: ` +
              `${matrixEntry.evidenceRequirements.join("; ")}.`
            : `Design a different, executable and reversible evidence exercise for ` +
              `capability ${target.capabilityId} (${targetCapability?.name ?? "unregistered"}). ` +
              `Address failed checks ${failedCheckIds.join(", ")} and do not repeat ` +
              `the provider-only exercise that failed to produce verified evidence.`,
          reasonForSelection: selection.reasonForSelection,
          expectedNewEvidence: selection.expectedNewEvidence,
          cycleIndex: 1 as const,
          maxCycles: 1 as const,
          continuationAuthorized: false as const,
          files: Object.freeze([
            "GOVERNANCE/ROADMAP.md",
            "reconstruction/CURRENT_STATE.md",
            "reconstruction/NEXT_MISSION.md",
          ]),
        }),
      }),
      status: "proposed",
      scheduledMissionId: null,
      resultObservationId: null,
      createdAt: observedAt,
      scheduledAt: null,
      completedAt: null,
    });

    await this.#save({
      observations: [...this.#state.observations, observation],
      profiles: [...profiles.values()].sort((left, right) =>
        left.capabilityId.localeCompare(right.capabilityId),
      ),
      proposals: [
        ...this.#state.proposals.map((candidate) =>
          candidate.id === proposal.id ? failedProposal : candidate,
        ),
        nextProposal,
      ],
    });

    this.#events.publish("learning.observation.recorded", {
      observationId: observation.id,
      missionId: observation.missionId,
      outcome: observation.outcome,
      signals: 1,
    });
    this.#events.publish("learning.proposal.failed", {
      proposalId: failedProposal.id,
      missionId: request.missionId,
      observationId: observation.id,
      targetCapabilityId: failedProposal.targetCapabilityId,
      failedCheckIds,
    });
    this.#events.publish("learning.proposal.created", {
      proposalId: nextProposal.id,
      targetCapabilityId: nextProposal.targetCapabilityId,
      priority: nextProposal.priority,
    });

    return Object.freeze({
      observation: cloneObservation(observation),
      failedProposal: cloneProposal(failedProposal),
      nextProposal: cloneProposal(nextProposal),
    });
  }

  async #save(state: {
    readonly observations: readonly LearningObservation[];
    readonly profiles: readonly LearningCapabilityProfile[];
    readonly proposals: readonly LearningMissionProposal[];
  }): Promise<void> {
    const persisted: PersistedLearningState = Object.freeze({
      version: LEARNING_STORE_VERSION,
      observations: Object.freeze(state.observations.map(cloneObservation)),
      profiles: Object.freeze(state.profiles.map(cloneProfile)),
      proposals: Object.freeze(state.proposals.map(cloneProposal)),
    });

    await this.#stateStore.save(persisted);
    this.#state = persisted;
  }
}
