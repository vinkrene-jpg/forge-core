import { createHash, randomUUID } from "node:crypto";
import {
  cloneAutonomyState,
  createInitialAutonomyState,
  missionCounts,
  requiresHardGovernanceBoundary,
  type AutonomousBacklogItem,
  type AutonomousRuntimeState,
  type AutonomousRuntimeSummary,
} from "./autonomy";
import {
  AUTONOMY_STORE_VERSION,
  FileAutonomyStateStore,
  type AutonomyStateStore,
} from "./autonomy-store";
import type { AiGatewaySummary } from "./ai-gateway";
import type { RuntimeEventBus } from "./event-bus";
import type { ApprovalRecord } from "./governance";
import type { LearningMissionProposal, LearningCapabilityProfile } from "./learning";
import { listLearningMatrixEntries } from "./learning-matrix";
import type { MissionRecord } from "./mission";

interface AutoMissionResult {
  readonly mission: MissionRecord;
}

interface WorkspacePlanSchedulingResult {
  readonly planningMission: MissionRecord;
}

const ROOT_CYCLE_COOLDOWN_MS = 60_000;
const RECENT_FINGERPRINT_LIMIT = 20;

export interface AutonomousEngineOptions {
  readonly events: RuntimeEventBus;
  readonly stateStore?: AutonomyStateStore;
  readonly pollIntervalMs?: number;
  readonly listMissions: () => readonly MissionRecord[];
  readonly listApprovals: () => readonly ApprovalRecord[];
  readonly approveApproval: (
    approvalId: string,
    actor: string,
    note?: string,
  ) => Promise<unknown>;
  readonly createMission: (request: {
    readonly kind: "operator.autonomous-cycle";
    readonly title: string;
    readonly input: Readonly<Record<string, unknown>>;
  }) => Promise<AutoMissionResult>;
  readonly listLearningProposals: () => readonly LearningMissionProposal[];
  readonly listLearningProfiles: () => readonly LearningCapabilityProfile[];
  readonly scheduleLearningProposal: (proposalId: string) => Promise<unknown>;
  readonly scheduleNextExercise: () => Promise<boolean>;
  readonly scheduleWorkspacePlan: (
    missionId: string,
  ) => Promise<WorkspacePlanSchedulingResult>;
  readonly aiGatewaySummary: () => AiGatewaySummary;
}

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeValue(value[key])]),
    );
  }

  return value;
}

function missionFingerprint(request: {
  readonly kind: string;
  readonly title: string;
  readonly input: Readonly<Record<string, unknown>>;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        normalizeValue({
          kind: request.kind,
          title: request.title,
          input: request.input,
        }),
      ),
    )
    .digest("hex");
}

function terminalMissionOutcome(mission: MissionRecord): string {
  const missionResult =
    isRecord(mission.output) && isRecord(mission.output.missionResult)
      ? mission.output.missionResult
      : null;

  if (typeof missionResult?.status === "string") {
    return missionResult.status;
  }

  if (mission.status === "succeeded") {
    return "completed";
  }

  if (mission.status === "failed") {
    return "failed";
  }

  return "blocked";
}

function isLearningMission(mission: MissionRecord): boolean {
  return (
    typeof mission.input.learningProposalId === "string" ||
    typeof mission.input.targetCapabilityId === "string"
  );
}

function hasRecentFingerprint(
  entries: readonly { readonly fingerprint: string; readonly recordedAt: string }[],
  fingerprint: string,
): boolean {
  return entries.some((entry) => entry.fingerprint === fingerprint);
}

function directBlockageScore(capabilityId: string): number {
  return listLearningMatrixEntries().filter((entry) =>
    entry.dependencies.includes(capabilityId),
  ).length;
}

function recentSuccessfulCapabilityIds(
  missions: readonly MissionRecord[],
): readonly string[] {
  return [...missions]
    .filter(
      (mission) =>
        mission.kind === "operator.autonomous-cycle" &&
        mission.status === "succeeded" &&
        typeof mission.input.targetCapabilityId === "string",
    )
    .sort((left, right) => right.completedAt?.localeCompare(left.completedAt ?? right.completedAt ?? "") ?? 0)
    .slice(0, 3)
    .map((mission) => mission.input.targetCapabilityId as string);
}

function buildAutonomySelection(
  capabilityId: string,
  missions: readonly MissionRecord[],
): { readonly reasonForSelection: string; readonly expectedNewEvidence: readonly string[] } {
  const matrixEntry = listLearningMatrixEntries().find(
    (entry) => entry.capabilityId === capabilityId,
  );
  const recentSuccessSet = new Set(recentSuccessfulCapabilityIds(missions));
  const expectedNewEvidence = matrixEntry
    ? matrixEntry.evidenceRequirements
    : Object.freeze([
        "A new runtime evidence trail",
        "A concrete verification result",
        "A non-repeated capability signal",
      ]);

  return Object.freeze({
    reasonForSelection: matrixEntry
      ? `Selected because ${capabilityId} has the largest open blockage score (${directBlockageScore(capabilityId)}) and ${recentSuccessSet.has(capabilityId) ? "was recently executed successfully, so it is temporarily deprioritized unless no larger blockage exists" : "has not been repeated recently"}.`
      : `Selected because ${capabilityId} is the current best available open blockage without repeating recent successful work.`,
    expectedNewEvidence,
  });
}

function cloneBacklog(item: AutonomousBacklogItem): AutonomousBacklogItem {
  return Object.freeze({
    ...item,
    files: Object.freeze([...item.files]),
    missionId: item.missionId ?? null,
    lastError: item.lastError ?? null,
  });
}

export class AutonomousEngine {
  readonly #events: RuntimeEventBus;
  readonly #stateStore: AutonomyStateStore;
  readonly #pollIntervalMs: number;
  readonly #listMissions: AutonomousEngineOptions["listMissions"];
  readonly #listApprovals: AutonomousEngineOptions["listApprovals"];
  readonly #createMission: AutonomousEngineOptions["createMission"];
  readonly #listLearningProposals: AutonomousEngineOptions["listLearningProposals"];
  readonly #listLearningProfiles: AutonomousEngineOptions["listLearningProfiles"];
  readonly #scheduleLearningProposal: AutonomousEngineOptions["scheduleLearningProposal"];
  readonly #scheduleNextExercise: AutonomousEngineOptions["scheduleNextExercise"];
  readonly #scheduleWorkspacePlan: AutonomousEngineOptions["scheduleWorkspacePlan"];
  readonly #aiGatewaySummary: AutonomousEngineOptions["aiGatewaySummary"];

  #state: AutonomousRuntimeState = createInitialAutonomyState();
  #running = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #tickInFlight = false;
  #activeTick: Promise<void> | null = null;
  readonly #pendingPersists = new Set<Promise<void>>();

  constructor(options: AutonomousEngineOptions) {
    this.#events = options.events;
    this.#stateStore = options.stateStore ?? new FileAutonomyStateStore();
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.#listMissions = options.listMissions;
    this.#listApprovals = options.listApprovals;
    this.#createMission = options.createMission;
    this.#listLearningProposals = options.listLearningProposals;
    this.#listLearningProfiles = options.listLearningProfiles;
    this.#scheduleLearningProposal = options.scheduleLearningProposal;
    this.#scheduleNextExercise = options.scheduleNextExercise;
    this.#scheduleWorkspacePlan = options.scheduleWorkspacePlan;
    this.#aiGatewaySummary = options.aiGatewaySummary;
  }

  resume(): AutonomousRuntimeSummary {
    this.#state = cloneAutonomyState({
      ...this.#state,
      loopPauseReason: null,
      loopPauseDetails: null,
      loopPauseRequiresResume: false,
      loopPauseMissionId: null,
      nextRootCycleNotBefore: null,
    });

    void this.#persist();
    this.#schedule(0);

    return this.summary();
  }

  async initialize(): Promise<void> {
    const loaded = await this.#stateStore.load();

    this.#state = cloneAutonomyState({
      ...loaded.state,
      loopStatus: "stopped",
    });

    await this.#persist();
  }

  summary(): AutonomousRuntimeSummary {
    const missions = this.#listMissions();
    const approvals = this.#listApprovals().filter(
      (approval) => approval.status === "pending",
    );
    const hardApprovals = approvals.filter(requiresHardGovernanceBoundary);
    const missionSummary = missionCounts(missions);
    const costs = this.#aiGatewaySummary();
    const cooldownActive =
      this.#state.nextRootCycleNotBefore !== null &&
      this.#state.nextRootCycleNotBefore > now();

    return Object.freeze({
      ...this.#state,
      loopPaused: this.#state.loopPauseReason !== null || cooldownActive,
      pauseReason: cooldownActive
        ? "Autonomous cycle cooldown"
        : this.#state.loopPauseReason,
      pauseDetails: cooldownActive
        ? `Next root autonomous cycle not before ${this.#state.nextRootCycleNotBefore}`
        : this.#state.loopPauseDetails,
      pauseUntil: cooldownActive ? this.#state.nextRootCycleNotBefore : null,
      pauseRequiresResume: this.#state.loopPauseRequiresResume,
      pendingApprovals: approvals.length,
      pendingHardApprovals: hardApprovals.length,
      queuedMissions: missionSummary.queued,
      runningMissions: missionSummary.running,
      awaitingApprovalMissions: missionSummary.awaitingApproval,
      latestMissionId: missionSummary.latestMissionId,
      costBudgetUsd: costs.budgetLimitUsd,
      costSpentUsd: costs.totalEstimatedCostUsd,
      costRemainingUsd: costs.budgetRemainingUsd,
    });
  }

  async setEnabled(enabled: boolean): Promise<AutonomousRuntimeSummary> {
    this.#state = cloneAutonomyState({
      ...this.#state,
      enabled,
      loopStatus: enabled && this.#running ? "running" : "stopped",
      blockedByHardGovernance: false,
      blockingApprovalId: null,
      blockingRiskLevel: null,
    });
    await this.#persist();

    if (enabled && this.#running) {
      this.#schedule(0);
    }

    return this.summary();
  }

  start(): void {
    if (this.#running) {
      return;
    }

    this.#running = true;
    this.#state = cloneAutonomyState({
      ...this.#state,
      loopStatus: this.#state.enabled ? "running" : "stopped",
    });

    void this.#persist();
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#running = false;

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    if (this.#activeTick !== null) {
      await this.#activeTick;
    }

    if (this.#pendingPersists.size > 0) {
      await Promise.all([...this.#pendingPersists]);
    }

    this.#state = cloneAutonomyState({
      ...this.#state,
      loopStatus: "stopped",
    });

    await this.#persist();
  }

  #schedule(delayMs: number): void {
    if (!this.#running) {
      return;
    }

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      const activeTick = this.#tick();
      this.#activeTick = activeTick;
      void activeTick.then(
        () => {
          if (this.#activeTick === activeTick) {
            this.#activeTick = null;
          }
        },
        () => {
          if (this.#activeTick === activeTick) {
            this.#activeTick = null;
          }
        },
      );
    }, delayMs);
  }

  async #tick(): Promise<void> {
    if (!this.#running || !this.#state.enabled || this.#tickInFlight) {
      this.#schedule(this.#pollIntervalMs);
      return;
    }

    this.#tickInFlight = true;

    try {
      await this.#runTick();
    } catch {
      // Background autonomy ticks must not crash the runtime test process.
    } finally {
      this.#tickInFlight = false;
      this.#schedule(this.#pollIntervalMs);
    }
  }

  async #runTick(): Promise<void> {
    const timestamp = now();
    const missions = this.#listMissions();
    const approvals = this.#listApprovals().filter(
      (approval) => approval.status === "pending",
    );

    const backlog = this.#syncBacklogFromMissions(this.#state.backlog, missions);

    this.#state = cloneAutonomyState({
      ...this.#state,
      lastTickAt: timestamp,
      totalTicks: this.#state.totalTicks + 1,
      backlog,
    });

    const latestTerminalMission = [...missions]
      .filter(
        (mission) =>
          mission.kind === "operator.autonomous-cycle" &&
          (mission.status === "succeeded" ||
            mission.status === "failed" ||
            mission.status === "cancelled"),
      )
      .sort((left, right) => {
        const leftCompletedAt = left.completedAt ?? left.updatedAt;
        const rightCompletedAt = right.completedAt ?? right.updatedAt;

        return rightCompletedAt.localeCompare(leftCompletedAt);
      })
      .at(0);

    if (
      latestTerminalMission &&
      latestTerminalMission.id !== this.#state.lastObservedMissionId
    ) {
      await this.#observeTerminalMission(latestTerminalMission);
    }

    const hardApproval = approvals.find(requiresHardGovernanceBoundary) ?? null;

    if (hardApproval) {
      this.#state = cloneAutonomyState({
        ...this.#state,
        blockedByHardGovernance: true,
        blockingApprovalId: hardApproval.id,
        blockingRiskLevel: hardApproval.assessment.riskLevel,
      });
      await this.#persist();
      return;
    }

    if (approvals.length > 0) {
      this.#state = cloneAutonomyState({
        ...this.#state,
        loopPauseReason: "Awaiting approval",
        loopPauseDetails:
          "An autonomous mission approval is open and must be resolved before the loop can continue.",
        loopPauseRequiresResume: false,
        loopPauseMissionId: approvals[0]?.id ?? null,
      });
      await this.#persist();
      return;
    }

    if (this.#state.loopPauseReason !== null && this.#state.loopPauseRequiresResume) {
      await this.#persist();
      return;
    }

    const clearTransientPause =
      this.#state.loopPauseReason !== null &&
      !this.#state.loopPauseRequiresResume;

    this.#state = cloneAutonomyState({
      ...this.#state,
      blockedByHardGovernance: false,
      blockingApprovalId: null,
      blockingRiskLevel: null,
      loopPauseReason: clearTransientPause ? null : this.#state.loopPauseReason,
      loopPauseDetails: clearTransientPause ? null : this.#state.loopPauseDetails,
      loopPauseRequiresResume:
        clearTransientPause ? false : this.#state.loopPauseRequiresResume,
      loopPauseMissionId:
        clearTransientPause ? null : this.#state.loopPauseMissionId,
    });

    const hasWorkInFlight = missions.some(
      (mission) =>
        mission.status === "running" ||
        mission.status === "queued" ||
        mission.status === "awaiting_approval",
    );

    if (hasWorkInFlight) {
      const activeMission = missions.find(
        (mission) =>
          mission.status === "running" ||
          mission.status === "queued" ||
          mission.status === "awaiting_approval",
      );

      this.#state = cloneAutonomyState({
        ...this.#state,
        loopPauseReason: "A mission is already in flight",
        loopPauseDetails:
          "The loop waits for the current mission to finish before scheduling another one.",
        loopPauseRequiresResume: false,
        loopPauseMissionId: activeMission?.id ?? null,
      });
      await this.#persist();
      return;
    }

    const scheduledWorkspace = await this.#scheduleReadyWorkspacePlan(missions);

    if (scheduledWorkspace) {
      await this.#persist();
      return;
    }

    const scheduledExercise = await this.#scheduleNextExercise();

    if (scheduledExercise) {
      await this.#persist();
      return;
    }

    const scheduledLearning = await this.#tryScheduleLearningProposal();

    if (scheduledLearning) {
      await this.#persist();
      return;
    }

    const scheduledRoot = await this.#scheduleNextAutonomousCycle();

    if (!scheduledRoot) {
      await this.#persist();
      return;
    }

    await this.#persist();
  }

  async #observeTerminalMission(mission: MissionRecord): Promise<void> {
    const outcome = terminalMissionOutcome(mission);
    const observedAt = mission.completedAt ?? mission.updatedAt ?? now();
    const fingerprint = missionFingerprint({
      kind: mission.kind,
      title: mission.title,
      input: mission.input,
    });
    const repeatedOutcome =
      this.#state.lastMissionOutcome === outcome
        ? this.#state.repeatOutcomeCount + 1
        : 1;
    const recent = [
      ...this.#state.recentMissionFingerprints.filter(
        (entry) => entry.fingerprint !== fingerprint,
      ),
      Object.freeze({ fingerprint, recordedAt: observedAt }),
    ].slice(-RECENT_FINGERPRINT_LIMIT);
    const learningMission = isLearningMission(mission);

    if (repeatedOutcome >= 2) {
      this.#state = cloneAutonomyState({
        ...this.#state,
        lastObservedMissionId: mission.id,
        lastMissionOutcome: outcome,
        repeatOutcomeCount: repeatedOutcome,
        recentMissionFingerprints: Object.freeze(recent),
        loopPauseReason: "Repeated autonomous outcome",
        loopPauseDetails:
          `Autonomous mission ${mission.id} repeated outcome ${outcome}; explicit resume is required.`,
        loopPauseRequiresResume: true,
        loopPauseMissionId: mission.id,
        nextRootCycleNotBefore: null,
      });
      return;
    }

    if (learningMission) {
      this.#state = cloneAutonomyState({
        ...this.#state,
        lastObservedMissionId: mission.id,
        lastMissionOutcome: outcome,
        repeatOutcomeCount: repeatedOutcome,
        recentMissionFingerprints: Object.freeze(recent),
        loopPauseReason: "Learning exercise finished",
        loopPauseDetails:
          outcome === "completed"
            ? `Learning mission ${mission.id} completed successfully. Resume explicitly to continue.`
            : `Learning mission ${mission.id} ended with ${outcome}. Resume explicitly after resolving the blocker.`,
        loopPauseRequiresResume: true,
        loopPauseMissionId: mission.id,
        nextRootCycleNotBefore: null,
      });
      return;
    }

    if (outcome !== "completed") {
      this.#state = cloneAutonomyState({
        ...this.#state,
        lastObservedMissionId: mission.id,
        lastMissionOutcome: outcome,
        repeatOutcomeCount: repeatedOutcome,
        recentMissionFingerprints: Object.freeze(recent),
        loopPauseReason: "Autonomous mission ended",
        loopPauseDetails:
          `Autonomous mission ${mission.id} ended with ${outcome}; explicit resume is required.`,
        loopPauseRequiresResume: true,
        loopPauseMissionId: mission.id,
        nextRootCycleNotBefore: null,
      });
      return;
    }

    this.#state = cloneAutonomyState({
      ...this.#state,
      lastObservedMissionId: mission.id,
      lastMissionOutcome: outcome,
      repeatOutcomeCount: repeatedOutcome,
      recentMissionFingerprints: Object.freeze(recent),
      nextRootCycleNotBefore: new Date(
        Date.now() + ROOT_CYCLE_COOLDOWN_MS,
      ).toISOString(),
      loopPauseReason: null,
      loopPauseDetails: null,
      loopPauseRequiresResume: false,
      loopPauseMissionId: null,
    });
  }

  async #scheduleReadyWorkspacePlan(
    missions: readonly MissionRecord[],
  ): Promise<boolean> {
    const succeededPlans = missions
      .filter(
        (mission) =>
          mission.kind === "operator.workspace-plan" &&
          mission.status === "succeeded",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    for (const mission of succeededPlans) {
      if (this.#state.scheduledWorkspacePlans.includes(mission.id)) {
        continue;
      }

      await this.#scheduleWorkspacePlan(mission.id);

      this.#state = cloneAutonomyState({
        ...this.#state,
        scheduledWorkspacePlans: Object.freeze([
          ...this.#state.scheduledWorkspacePlans,
          mission.id,
        ].slice(-100)),
      });

      return true;
    }

    return false;
  }

  async #tryScheduleLearningProposal(): Promise<boolean> {
    const proposal = this.#listLearningProposals()
      .filter((candidate) => candidate.status === "proposed")
      .sort((left, right) => right.priority - left.priority)
      .at(0);

    if (!proposal) {
      return false;
    }

    await this.#scheduleLearningProposal(proposal.id);
    return true;
  }

  async #scheduleNextAutonomousCycle(): Promise<boolean> {
    const candidate = this.#nextBacklogItem();
    const candidateFingerprint = missionFingerprint({
      kind: "operator.autonomous-cycle",
      title: `Autonomous mission cycle: ${candidate.objective.slice(0, 80)}`,
      input: {
        projectId: "forge-core",
        objective: candidate.objective,
        cycleIndex: 1,
        maxCycles: 1,
        continuationAuthorized: false,
        files: candidate.files,
      },
    });

    if (
      this.#state.nextRootCycleNotBefore !== null &&
      this.#state.nextRootCycleNotBefore > now()
    ) {
      this.#state = cloneAutonomyState({
        ...this.#state,
        loopPauseReason: "Root-cycle cooldown",
        loopPauseDetails:
          `Next autonomous cycle is paused until ${this.#state.nextRootCycleNotBefore}.`,
        loopPauseRequiresResume: false,
        loopPauseMissionId: null,
      });

      return false;
    }

    if (
      hasRecentFingerprint(
        this.#state.recentMissionFingerprints,
        candidateFingerprint,
      )
    ) {
      this.#state = cloneAutonomyState({
        ...this.#state,
        loopPauseReason: "Duplicate autonomous cycle",
        loopPauseDetails:
          "The same autonomous mission context was executed recently, so the loop will not schedule it again yet.",
        loopPauseRequiresResume: false,
        loopPauseMissionId: null,
      });

      return false;
    }

    const mission = await this.#createMission({
      kind: "operator.autonomous-cycle",
      title: `Autonomous mission cycle: ${candidate.objective.slice(0, 80)}`,
      input: {
        projectId: "forge-core",
        objective: candidate.objective,
        reasonForSelection: candidate.selectionReason,
        expectedNewEvidence: candidate.expectedNewEvidence,
        cycleIndex: 1,
        maxCycles: 1,
        continuationAuthorized: false,
        files: candidate.files,
      },
    });

    const updatedBacklog = this.#state.backlog.map((item) => {
      if (item.id !== candidate.id) {
        return item;
      }

      return cloneBacklog({
        ...item,
        status: "scheduled",
        missionId: mission.mission.id,
        updatedAt: now(),
      });
    });

    const recordedAt = now();
    this.#state = cloneAutonomyState({
      ...this.#state,
      cyclesScheduled: this.#state.cyclesScheduled + 1,
      recentMissionFingerprints: Object.freeze(
        [
          ...this.#state.recentMissionFingerprints.filter(
            (entry) => entry.fingerprint !== candidateFingerprint,
          ),
          Object.freeze({
            fingerprint: candidateFingerprint,
            recordedAt,
          }),
        ].slice(-RECENT_FINGERPRINT_LIMIT),
      ),
      backlog: Object.freeze(updatedBacklog),
    });

    return true;
  }

  #nextBacklogItem(): AutonomousBacklogItem {
    const existing = this.#state.backlog
      .filter((item) => item.status === "proposed")
      .sort((left, right) => right.priority - left.priority)
      .at(0);

    if (existing) {
      return existing;
    }

    const profile = [...this.#listLearningProfiles()].sort(
      (left, right) => left.score - right.score,
    )[0];
    const capability = profile?.capabilityId ?? "mission.autonomous.continue";
    const selectionReason = profile
      ? `Selected from learning profile because ${capability} has score ${profile.score}.`
      : "Selected as default autonomy backlog item because no learning profile is available.";
    const expectedNewEvidence = Object.freeze([
      "Updated runtime evidence",
      "A concrete verification result",
      "A non-repeated capability signal",
    ]);
    const objective =
      `Analyseer huidige runtime-evidence en voer de volgende kleine, reversible stap uit ` +
      `om capability ${capability} te verbeteren. Lever concrete verificatie-instructies.`;

    const item: AutonomousBacklogItem = Object.freeze({
      id: randomUUID(),
      objective,
      selectionReason,
      expectedNewEvidence,
      priority: profile ? Math.max(1, 100 - profile.score) : 50,
      status: "proposed",
      source: profile ? "learning-profile" : "default-autonomy",
      files: Object.freeze([
        "GOVERNANCE/ROADMAP.md",
        "reconstruction/CURRENT_STATE.md",
        "reconstruction/NEXT_MISSION.md",
      ]),
      missionId: null,
      lastError: null,
      createdAt: now(),
      updatedAt: now(),
    });

    this.#state = cloneAutonomyState({
      ...this.#state,
      backlog: Object.freeze([...this.#state.backlog, item].slice(-200)),
    });

    return item;
  }

  #syncBacklogFromMissions(
    backlog: readonly AutonomousBacklogItem[],
    missions: readonly MissionRecord[],
  ): readonly AutonomousBacklogItem[] {
    const byMission = new Map(missions.map((mission) => [mission.id, mission]));

    return backlog.map((item) => {
      if (!item.missionId) {
        return item;
      }

      const mission = byMission.get(item.missionId);

      if (!mission) {
        return item;
      }

      if (mission.status === "succeeded" && item.status !== "completed") {
        return cloneBacklog({
          ...item,
          status: "completed",
          updatedAt: now(),
          lastError: null,
        });
      }

      if (
        (mission.status === "failed" || mission.status === "cancelled") &&
        item.status !== "failed"
      ) {
        return cloneBacklog({
          ...item,
          status: "failed",
          updatedAt: now(),
          lastError: mission.lastError,
        });
      }

      if (mission.status === "running" && item.status !== "running") {
        return cloneBacklog({
          ...item,
          status: "running",
          updatedAt: now(),
        });
      }

      return item;
    });
  }

  async #persist(): Promise<void> {
    const persistence = this.#stateStore.save(
      Object.freeze({
        version: AUTONOMY_STORE_VERSION,
        state: this.#state,
      }),
    );
    this.#pendingPersists.add(persistence);
    void persistence.then(
      () => this.#pendingPersists.delete(persistence),
      () => this.#pendingPersists.delete(persistence),
    );
    await persistence;
  }
}
