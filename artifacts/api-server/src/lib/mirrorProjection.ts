import { createHash } from "node:crypto";
import type {
  AiExecutionRecord,
  ApprovalRecord,
  LearningObservation,
  MissionRecord,
  ProjectMemoryEntry,
} from "@workspace/forge-runtime";

export type MirrorEventType =
  | "input_received"
  | "interpretation_created"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "execution_started"
  | "execution_completed"
  | "evidence_created"
  | "evaluation_completed"
  | "guardian_reviewed"
  | "governor_released"
  | "governor_blocked"
  | "result_published"
  | "error_recorded";

export interface MirrorProjectionSource {
  listMissions(): readonly MissionRecord[];
  listApprovals(): readonly ApprovalRecord[];
  listAiExecutions(): readonly AiExecutionRecord[];
  listLearningObservations(): readonly LearningObservation[];
  listProjectMemories(
    projectId: string,
    kind?: "evidence",
  ): readonly ProjectMemoryEntry[];
}

export interface MirrorTimelineEvent {
  readonly missionId: string;
  readonly eventId: string;
  readonly eventType: MirrorEventType;
  readonly occurredAt: string;
  readonly sequence: number;
  readonly sourceType:
    | "mission"
    | "approval"
    | "ai_execution"
    | "runtime_audit"
    | "artifact"
    | "learning_observation"
    | "project_memory";
  readonly sourceId: string;
  readonly actorType: "operator" | "forge" | "provider" | "governance";
  readonly summary: string;
  readonly payloadReference: string;
  readonly status: string;
  readonly integrityFlags: readonly string[];
}

export interface MirrorMissionProjection {
  readonly mission: MissionRecord;
  readonly timeline: readonly MirrorTimelineEvent[];
  readonly approvals: readonly ApprovalRecord[];
  readonly evidence: readonly MirrorTimelineEvent[];
  readonly artifacts: readonly Readonly<Record<string, unknown>>[];
  readonly assessments: readonly MirrorTimelineEvent[];
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly missingLinks: readonly string[];
  readonly duplicateWarnings: readonly string[];
  readonly integrityWarnings: readonly string[];
}

export interface MirrorMissionListItem {
  readonly missionId: string;
  readonly title: string;
  readonly status: string;
  readonly firstOccurredAt: string;
  readonly lastOccurredAt: string;
  readonly eventCount: number;
  readonly integrityWarnings: readonly string[];
}

interface MirrorProjectionSnapshot {
  readonly missions: readonly MissionRecord[];
  readonly missionById: ReadonlyMap<string, MissionRecord>;
  readonly approvalsByMissionId: ReadonlyMap<string, readonly ApprovalRecord[]>;
  readonly executionsByMissionId: ReadonlyMap<string, readonly AiExecutionRecord[]>;
  readonly observationsByMissionId: ReadonlyMap<string, readonly LearningObservation[]>;
  readonly evidenceByMissionId: ReadonlyMap<string, readonly ProjectMemoryEntry[]>;
}

export class MirrorProjectionTimeoutError extends Error {
  constructor() {
    super("Mirror mission list projection exceeded its time limit");
    this.name = "MirrorProjectionTimeoutError";
  }
}

interface EventInput {
  readonly eventType: MirrorEventType;
  readonly occurredAt: string;
  readonly sourceType: MirrorTimelineEvent["sourceType"];
  readonly sourceId: string;
  readonly actorType: MirrorTimelineEvent["actorType"];
  readonly summary: string;
  readonly payloadReference: string;
  readonly status: string;
  readonly integrityFlags?: readonly string[];
}

const eventOrder: Readonly<Record<MirrorEventType, number>> = Object.freeze({
  input_received: 10,
  interpretation_created: 20,
  approval_requested: 30,
  approval_granted: 40,
  approval_rejected: 40,
  execution_started: 50,
  execution_completed: 60,
  evidence_created: 70,
  evaluation_completed: 80,
  guardian_reviewed: 90,
  governor_released: 100,
  governor_blocked: 100,
  result_published: 110,
  error_recorded: 110,
});

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function records(value: unknown): Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<Readonly<Record<string, unknown>>[]>((items, item) => {
    const candidate = record(item);
    if (candidate) items.push(candidate);
    return items;
  }, []);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function eventId(missionId: string, input: EventInput): string {
  return createHash("sha256")
    .update([
      missionId,
      input.eventType,
      input.sourceType,
      input.sourceId,
      input.occurredAt,
    ].join("\0"))
    .digest("hex");
}

function compareEvents(left: MirrorTimelineEvent, right: MirrorTimelineEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) ||
    eventOrder[left.eventType] - eventOrder[right.eventType] ||
    left.sourceType.localeCompare(right.sourceType) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.eventId.localeCompare(right.eventId);
}

function indexByMissionId<T extends { readonly missionId: string | null }>(
  recordsToIndex: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const index = new Map<string, T[]>();
  for (const item of recordsToIndex) {
    if (!item.missionId) continue;
    const recordsForMission = index.get(item.missionId) ?? [];
    recordsForMission.push(item);
    index.set(item.missionId, recordsForMission);
  }
  return index;
}

function assertBeforeDeadline(deadline: number): void {
  if (performance.now() > deadline) {
    throw new MirrorProjectionTimeoutError();
  }
}

function createEvent(missionId: string, input: EventInput): MirrorTimelineEvent {
  return Object.freeze({
    missionId,
    eventId: eventId(missionId, input),
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    sequence: 0,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    actorType: input.actorType,
    summary: input.summary,
    payloadReference: input.payloadReference,
    status: input.status,
    integrityFlags: Object.freeze([...(input.integrityFlags ?? [])]),
  });
}

function projectId(mission: MissionRecord): string {
  return text(mission.input.projectId) ?? "forge-core";
}

function resultRecord(mission: MissionRecord): Readonly<Record<string, unknown>> | null {
  return record(mission.output?.missionResult) ?? mission.output;
}

export class MirrorProjectionService {
  readonly #source: MirrorProjectionSource;

  constructor(source: MirrorProjectionSource) {
    this.#source = source;
  }

  #loadSnapshot(deadline: number): MirrorProjectionSnapshot {
    const missions = this.#source.listMissions();
    assertBeforeDeadline(deadline);
    const approvals = this.#source.listApprovals();
    assertBeforeDeadline(deadline);
    const executions = this.#source.listAiExecutions();
    assertBeforeDeadline(deadline);
    const observations = this.#source.listLearningObservations();
    assertBeforeDeadline(deadline);

    const missionById = new Map(missions.map((mission) => [mission.id, mission]));
    const evidenceByMissionId = new Map<string, ProjectMemoryEntry[]>();
    const projectIds = new Set(missions.map(projectId));
    for (const currentProjectId of projectIds) {
      const memories = this.#source.listProjectMemories(currentProjectId, "evidence");
      for (const memory of memories) {
        const candidates = new Set(
          `${memory.source}\n${memory.content}`
            .split(/[^A-Za-z0-9_-]+/)
            .filter(Boolean),
        );
        for (const candidate of candidates) {
          if (!missionById.has(candidate)) continue;
          const recordsForMission = evidenceByMissionId.get(candidate) ?? [];
          recordsForMission.push(memory);
          evidenceByMissionId.set(candidate, recordsForMission);
        }
      }
      assertBeforeDeadline(deadline);
    }

    return Object.freeze({
      missions,
      missionById,
      approvalsByMissionId: indexByMissionId(approvals),
      executionsByMissionId: indexByMissionId(executions),
      observationsByMissionId: indexByMissionId(observations),
      evidenceByMissionId,
    });
  }

  listMissions(timeoutMs = 1_250): readonly MirrorMissionListItem[] {
    const projections = this.listMissionProjections(timeoutMs);
    const missions = projections.map((projection) => Object.freeze({
      missionId: projection.mission.id,
      title: projection.mission.title,
      status: projection.mission.status,
      firstOccurredAt: projection.timeline[0]?.occurredAt ?? projection.mission.createdAt,
      lastOccurredAt: projection.timeline.at(-1)?.occurredAt ?? projection.mission.updatedAt,
      eventCount: projection.timeline.length,
      integrityWarnings: projection.integrityWarnings,
    }));
    missions.sort((left, right) =>
      left.firstOccurredAt.localeCompare(right.firstOccurredAt) ||
      left.missionId.localeCompare(right.missionId));
    return Object.freeze(missions);
  }

  listMissionProjections(timeoutMs = 1_250): readonly MirrorMissionProjection[] {
    const deadline = performance.now() + timeoutMs;
    const snapshot = this.#loadSnapshot(deadline);
    const projections = snapshot.missions.map((mission, index) => {
      if (index % 100 === 0) assertBeforeDeadline(deadline);
      return this.#projectMission(mission, snapshot);
    });
    assertBeforeDeadline(deadline);
    return Object.freeze(projections);
  }

  getMission(missionId: string): MirrorMissionProjection | null {
    const snapshot = this.#loadSnapshot(Number.POSITIVE_INFINITY);
    const mission = snapshot.missionById.get(missionId);
    if (!mission) {
      return null;
    }

    return this.#projectMission(mission, snapshot);
  }

  #projectMission(
    mission: MissionRecord,
    snapshot: MirrorProjectionSnapshot,
  ): MirrorMissionProjection {
    const events: MirrorTimelineEvent[] = [];
    const inputSummary = text(mission.input.rawObjective) ??
      text(mission.input.objective) ?? mission.title;
    events.push(createEvent(mission.id, {
      eventType: "input_received",
      occurredAt: mission.createdAt,
      sourceType: "mission",
      sourceId: mission.id,
      actorType: "operator",
      summary: inputSummary,
      payloadReference: "mission.input",
      status: mission.status,
    }));
    const isInertMirrorIntake =
      mission.kind === "operator.mirror-intake" && mission.status === "not_started";
    if (!isInertMirrorIntake) {
      events.push(createEvent(mission.id, {
        eventType: "interpretation_created",
        occurredAt: mission.createdAt,
        sourceType: "mission",
        sourceId: mission.id,
        actorType: "forge",
        summary: text(mission.input.objective) ?? mission.title,
        payloadReference: "mission.input.objective",
        status: "created",
      }));
    }

    const approvals = snapshot.approvalsByMissionId.get(mission.id) ?? [];
    for (const approval of approvals) {
      events.push(createEvent(mission.id, {
        eventType: "approval_requested",
        occurredAt: approval.createdAt,
        sourceType: "approval",
        sourceId: approval.id,
        actorType: "governance",
        summary: approval.assessment.reason,
        payloadReference: `approval:${approval.id}`,
        status: "pending",
      }));
      if (approval.status !== "pending" && approval.decidedAt) {
        events.push(createEvent(mission.id, {
          eventType: approval.status === "approved"
            ? "approval_granted"
            : "approval_rejected",
          occurredAt: approval.decidedAt,
          sourceType: "approval",
          sourceId: approval.id,
          actorType: "governance",
          summary: approval.note ?? `${approval.status} by ${approval.decidedBy ?? "unknown"}`,
          payloadReference: `approval:${approval.id}`,
          status: approval.status,
        }));
      }
    }

    const executions = snapshot.executionsByMissionId.get(mission.id) ?? [];
    for (const execution of executions) {
      events.push(createEvent(mission.id, {
        eventType: "execution_started",
        occurredAt: execution.startedAt,
        sourceType: "ai_execution",
        sourceId: execution.id,
        actorType: "provider",
        summary: `${execution.providerId ?? "unavailable"}/${execution.model ?? "unknown"}`,
        payloadReference: `aiExecution:${execution.id}`,
        status: "running",
      }));
      if (execution.completedAt) {
        events.push(createEvent(mission.id, {
          eventType: execution.status === "succeeded"
            ? "execution_completed"
            : "error_recorded",
          occurredAt: execution.completedAt,
          sourceType: "ai_execution",
          sourceId: execution.id,
          actorType: "provider",
          summary: execution.error ?? `AI execution ${execution.status}`,
          payloadReference: `aiExecution:${execution.id}`,
          status: execution.status,
        }));
      }
    }

    const output = mission.output;
    const executionEvidence = record(output?.executionEvidence);
    const sourceArtifacts = records(executionEvidence?.artifacts);
    const artifacts: Readonly<Record<string, unknown>>[] = sourceArtifacts.map(
      (artifact) => Object.freeze({
        ...artifact,
        sourceMissionId: text(artifact.missionId),
        missionId: mission.id,
      }),
    );
    const artifactMissionMismatches = sourceArtifacts
      .filter((artifact) => text(artifact.missionId) !== null && text(artifact.missionId) !== mission.id)
      .map((artifact) => `artifact ${text(artifact.id) ?? "unknown"} has mismatched missionId`);
    if (executionEvidence) {
      events.push(createEvent(mission.id, {
        eventType: "evidence_created",
        occurredAt: mission.completedAt ?? mission.updatedAt,
        sourceType: "mission",
        sourceId: mission.id,
        actorType: "forge",
        summary: `${artifacts.length} artifact(s) with execution evidence`,
        payloadReference: "mission.output.executionEvidence",
        status: "recorded",
      }));
    }
    for (const receipt of records(executionEvidence?.receipts)) {
      const receiptId = text(receipt.id) ?? "unknown";
      const ok = receipt.ok === true;
      events.push(createEvent(mission.id, {
        eventType: ok ? "execution_completed" : "error_recorded",
        occurredAt: text(receipt.completedAt) ?? mission.updatedAt,
        sourceType: "runtime_audit",
        sourceId: receiptId,
        actorType: "forge",
        summary: `${text(receipt.action) ?? "runtime action"}: ${text(receipt.targetPath) ?? "unknown target"}`,
        payloadReference: `mission.output.executionEvidence.receipts:${receiptId}`,
        status: ok ? "succeeded" : "failed",
      }));
    }
    for (const artifact of artifacts) {
      const artifactId = text(artifact.id) ?? "unknown";
      events.push(createEvent(mission.id, {
        eventType: "evidence_created",
        occurredAt: mission.completedAt ?? mission.updatedAt,
        sourceType: "artifact",
        sourceId: artifactId,
        actorType: "forge",
        summary: `${text(artifact.kind) ?? "artifact"}: ${text(artifact.path) ?? artifactId}`,
        payloadReference: `mission.output.executionEvidence.artifacts:${artifactId}`,
        status: "recorded",
        integrityFlags: artifactMissionMismatches.some((warning) => warning.includes(artifactId))
          ? ["mismatched_mission_id"]
          : [],
      }));
    }

    const evaluation = record(output?.evaluation);
    if (evaluation) {
      events.push(createEvent(mission.id, {
        eventType: "evaluation_completed",
        occurredAt: mission.completedAt ?? mission.updatedAt,
        sourceType: "mission",
        sourceId: text(evaluation.id) ?? mission.id,
        actorType: "forge",
        summary: `Evaluation ${text(evaluation.decision) ?? "recorded"}`,
        payloadReference: "mission.output.evaluation",
        status: text(evaluation.decision) ?? "recorded",
      }));
    }

    // Guardian review and Governor decision are produced by the mission flow
    // (MissionEngine.complete) and persisted on the mission output. The
    // projection surfaces them as authoritative timeline events; it never
    // synthesizes a review that the flow did not record.
    const guardianReview = record(output?.guardianReview);
    if (guardianReview) {
      events.push(createEvent(mission.id, {
        eventType: "guardian_reviewed",
        occurredAt: text(guardianReview.reviewedAt) ?? mission.completedAt ?? mission.updatedAt,
        sourceType: "mission",
        sourceId: text(guardianReview.id) ?? mission.id,
        actorType: "governance",
        summary: text(guardianReview.summary) ??
          `Guardian review ${text(guardianReview.outcome) ?? "recorded"}`,
        payloadReference: "mission.output.guardianReview",
        status: text(guardianReview.outcome) ?? "recorded",
      }));
    }

    const governorDecision = record(output?.governorDecision);
    if (governorDecision) {
      const decision = text(governorDecision.decision);
      events.push(createEvent(mission.id, {
        eventType: decision === "released" ? "governor_released" : "governor_blocked",
        occurredAt: text(governorDecision.decidedAt) ?? mission.completedAt ?? mission.updatedAt,
        sourceType: "mission",
        sourceId: text(governorDecision.id) ?? mission.id,
        actorType: "governance",
        summary: text(governorDecision.rationale) ?? `Governor ${decision ?? "decision"}`,
        payloadReference: "mission.output.governorDecision",
        status: decision ?? "recorded",
      }));
    }

    for (const observation of snapshot.observationsByMissionId.get(mission.id) ?? []) {
      events.push(createEvent(mission.id, {
        eventType: "evidence_created",
        occurredAt: observation.observedAt,
        sourceType: "learning_observation",
        sourceId: observation.id,
        actorType: "forge",
        summary: `Learning observation ${observation.outcome}`,
        payloadReference: `learningObservation:${observation.id}`,
        status: observation.outcome,
      }));
    }

    for (const memory of snapshot.evidenceByMissionId.get(mission.id) ?? []) {
      events.push(createEvent(mission.id, {
        eventType: "evidence_created",
        occurredAt: memory.createdAt,
        sourceType: "project_memory",
        sourceId: memory.id,
        actorType: "forge",
        summary: memory.content.slice(0, 160),
        payloadReference: `projectMemory:${memory.id}`,
        status: "recorded",
      }));
    }

    if (mission.status === "succeeded") {
      events.push(createEvent(mission.id, {
        eventType: "result_published",
        occurredAt: mission.completedAt ?? mission.updatedAt,
        sourceType: "mission",
        sourceId: mission.id,
        actorType: "forge",
        summary: text(record(output?.missionResult)?.message) ?? "Mission succeeded",
        payloadReference: "mission.output",
        status: mission.status,
      }));
    } else if (mission.status === "failed" || mission.status === "cancelled") {
      events.push(createEvent(mission.id, {
        eventType: "error_recorded",
        occurredAt: mission.completedAt ?? mission.updatedAt,
        sourceType: "mission",
        sourceId: mission.id,
        actorType: "forge",
        summary: mission.lastError ?? `Mission ${mission.status}`,
        payloadReference: "mission.lastError",
        status: mission.status,
      }));
    }

    const duplicates = new Map<string, number>();
    for (const event of events) {
      const key = `${event.eventType}\0${event.sourceType}\0${event.sourceId}`;
      duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
    }
    const duplicateWarnings = [...duplicates]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => `duplicate source ${key.replaceAll("\0", "/")} (${count})`)
      .sort();
    const duplicateKeys = new Set(
      [...duplicates].filter(([, count]) => count > 1).map(([key]) => key),
    );
    const sorted = events
      .map((event) => {
        const key = `${event.eventType}\0${event.sourceType}\0${event.sourceId}`;
        return duplicateKeys.has(key)
          ? Object.freeze({
              ...event,
              integrityFlags: Object.freeze([...event.integrityFlags, "duplicate_source"]),
            })
          : event;
      })
      .sort(compareEvents)
      .map((event, index) => Object.freeze({ ...event, sequence: index + 1 }));

    const missingLinks: string[] = [];
    if (mission.status === "awaiting_approval" && approvals.length === 0) {
      missingLinks.push("approval");
    }
    if (mission.status === "succeeded" && mission.kind === "operator.workspace-change" && !executionEvidence) {
      missingLinks.push("evidence");
    }
    if (mission.status === "succeeded" && !resultRecord(mission)) {
      missingLinks.push("result");
    }
    if (!isInertMirrorIntake && !events.some((event) => event.eventType === "guardian_reviewed")) {
      missingLinks.push("guardian_review");
    }
    if (!isInertMirrorIntake && !events.some((event) => event.eventType === "governor_released" || event.eventType === "governor_blocked")) {
      missingLinks.push("governor_decision");
    }
    const integrityWarnings = Object.freeze([
      ...duplicateWarnings,
      ...artifactMissionMismatches,
      ...missingLinks.map((link) => `missing ${link}`),
    ]);

    return Object.freeze({
      mission: Object.freeze({ ...mission }),
      timeline: Object.freeze(sorted),
      approvals: Object.freeze([...approvals]),
      evidence: Object.freeze(sorted.filter((event) => event.eventType === "evidence_created")),
      artifacts: Object.freeze(artifacts),
      assessments: Object.freeze(sorted.filter((event) =>
        event.eventType === "evaluation_completed" ||
        event.eventType === "guardian_reviewed" ||
        event.eventType === "governor_released" ||
        event.eventType === "governor_blocked")),
      result: resultRecord(mission),
      missingLinks: Object.freeze(missingLinks),
      duplicateWarnings: Object.freeze(duplicateWarnings),
      integrityWarnings,
    });
  }
}