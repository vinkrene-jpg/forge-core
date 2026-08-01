import { createHash } from "node:crypto";
import type {
  MirrorMissionProjection,
  MirrorTimelineEvent,
} from "./mirrorProjection";

export type MirrorSessionStatus =
  | "NOT_STARTED"
  | "ACTIVE"
  | "WAITING_APPROVAL"
  | "WAITING_EVIDENCE"
  | "WAITING_REVIEW"
  | "READY_FOR_RELEASE"
  | "COMPLETED"
  | "BLOCKED";

export interface MirrorSessionModel {
  readonly sessionId: string;
  readonly missionId: string;
  readonly startedAt: string;
  readonly lastActivity: string;
  readonly status: MirrorSessionStatus;
  readonly currentPhase: string;
  readonly currentStep: string;
  readonly completionPercentage: number;
  readonly activeBlockers: readonly string[];
  readonly pendingApprovals: number;
  readonly pendingEvidence: boolean;
  readonly pendingGuardian: boolean;
  readonly pendingGovernor: boolean;
  readonly nextRecommendedAction: string;
}

interface ProgressMilestone {
  readonly id: string;
  readonly percentage: number;
  readonly achieved: (events: readonly MirrorTimelineEvent[]) => boolean;
}

function hasEvent(
  events: readonly MirrorTimelineEvent[],
  ...eventTypes: readonly string[]
): boolean {
  return events.some((event) => eventTypes.includes(event.eventType));
}

// Percentages are earned only by persisted timeline evidence; time and inferred
// intent never contribute. A result can therefore be terminal while still
// exposing an incomplete evidence chain.
export const SESSION_PROGRESS_MILESTONES: readonly ProgressMilestone[] = Object.freeze([
  { id: "input", percentage: 10, achieved: (events) => hasEvent(events, "input_received") },
  { id: "interpretation", percentage: 10, achieved: (events) => hasEvent(events, "interpretation_created") },
  { id: "approval", percentage: 10, achieved: (events) => hasEvent(events, "approval_granted", "approval_rejected") },
  { id: "execution_started", percentage: 10, achieved: (events) => hasEvent(events, "execution_started") },
  { id: "execution_completed", percentage: 15, achieved: (events) => hasEvent(events, "execution_completed") },
  { id: "evidence", percentage: 15, achieved: (events) => hasEvent(events, "evidence_created") },
  { id: "review", percentage: 10, achieved: (events) => hasEvent(events, "evaluation_completed", "guardian_reviewed") },
  { id: "guardian", percentage: 5, achieved: (events) => hasEvent(events, "guardian_reviewed") },
  { id: "governor", percentage: 5, achieved: (events) => hasEvent(events, "governor_released", "governor_blocked") },
  { id: "result", percentage: 10, achieved: (events) => hasEvent(events, "result_published") },
]);

const PHASES: Readonly<Record<MirrorSessionStatus, string>> = Object.freeze({
  NOT_STARTED: "Voorbereiding",
  ACTIVE: "Uitvoering",
  WAITING_APPROVAL: "Goedkeuring",
  WAITING_EVIDENCE: "Bewijs",
  WAITING_REVIEW: "Beoordeling",
  READY_FOR_RELEASE: "Vrijgave",
  COMPLETED: "Afgerond",
  BLOCKED: "Geblokkeerd",
});

function sessionId(missionId: string): string {
  return `mirror-session-${createHash("sha256").update(missionId).digest("hex").slice(0, 24)}`;
}

function unique(items: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(items)].sort());
}

function deriveStatus(
  projection: MirrorMissionProjection,
  activeBlockers: readonly string[],
  pendingApprovals: number,
  pendingEvidence: boolean,
  pendingGuardian: boolean,
  pendingGovernor: boolean,
): MirrorSessionStatus {
  const events = projection.timeline;
  if (activeBlockers.length > 0) return "BLOCKED";
  if (hasEvent(events, "result_published")) return "COMPLETED";
  if (pendingApprovals > 0) return "WAITING_APPROVAL";
  if (pendingEvidence) return "WAITING_EVIDENCE";
  if (pendingGuardian) return "WAITING_REVIEW";
  if (pendingGovernor) return "READY_FOR_RELEASE";
  if (!hasEvent(events, "execution_started", "execution_completed")) {
    return "NOT_STARTED";
  }
  return "ACTIVE";
}

function nextAction(
  status: MirrorSessionStatus,
  projection: MirrorMissionProjection,
): string {
  if (status === "BLOCKED") return "Los de actieve blokkade op voordat de missie verdergaat.";
  if (status === "COMPLETED") return "Geen actie nodig; het resultaat is gepubliceerd.";
  if (status === "WAITING_APPROVAL") return "Wacht op de vereiste goedkeuring.";
  if (status === "WAITING_EVIDENCE") return "Verzamel en controleer het ontbrekende uitvoeringsbewijs.";
  if (status === "WAITING_REVIEW") return "Laat Guardian het beschikbare bewijs beoordelen.";
  if (status === "READY_FOR_RELEASE") return "Governor kan de missie vrijgeven of blokkeren.";
  if (status === "NOT_STARTED") return "Start de goedgekeurde missie-uitvoering.";
  if (!hasEvent(projection.timeline, "execution_completed")) {
    return "Voltooi de actieve uitvoering en leg het resultaat vast.";
  }
  return "Controleer de actuele missiestap.";
}

export function projectMirrorSession(
  projection: MirrorMissionProjection,
): MirrorSessionModel {
  const events = projection.timeline;
  const pendingApprovals = projection.approvals.filter(
    (approval) => approval.status === "pending",
  ).length;
  const executionFinished = hasEvent(events, "execution_completed");
  const pendingEvidence = executionFinished && projection.evidence.length === 0;
  const hasEvidence = projection.evidence.length > 0;
  const guardianReviewed = hasEvent(events, "guardian_reviewed");
  const governorDecided = hasEvent(events, "governor_released", "governor_blocked");
  const pendingGuardian = hasEvidence && !guardianReviewed;
  const pendingGovernor = guardianReviewed && !governorDecided;
  const activeBlockers = unique([
    ...events
      .filter((event) => event.eventType === "error_recorded")
      .map((event) => event.summary),
    ...events
      .filter((event) => event.eventType === "governor_blocked")
      .map((event) => event.summary),
    ...events
      .filter((event) => event.eventType === "approval_rejected")
      .map((event) => event.summary),
    ...projection.duplicateWarnings,
    ...projection.integrityWarnings.filter((warning) =>
      warning.includes("mismatched missionId")),
    ...projection.missingLinks
      .filter((link) =>
        (link === "approval" && projection.mission.status === "awaiting_approval") ||
        (link === "result" && projection.mission.status === "succeeded"))
      .map((link) => `missing ${link}`),
  ]);
  const status = deriveStatus(
    projection,
    activeBlockers,
    pendingApprovals,
    pendingEvidence,
    pendingGuardian,
    pendingGovernor,
  );
  const completionPercentage = SESSION_PROGRESS_MILESTONES.reduce(
    (total, milestone) => total + (milestone.achieved(events) ? milestone.percentage : 0),
    0,
  );
  const firstEvent = events[0];
  const lastEvent = events.at(-1);

  return Object.freeze({
    sessionId: sessionId(projection.mission.id),
    missionId: projection.mission.id,
    startedAt: firstEvent?.occurredAt ?? projection.mission.createdAt,
    lastActivity: lastEvent?.occurredAt ?? projection.mission.updatedAt,
    status,
    currentPhase: PHASES[status],
    currentStep: lastEvent?.eventType ?? "mission_not_started",
    completionPercentage,
    activeBlockers,
    pendingApprovals,
    pendingEvidence,
    pendingGuardian,
    pendingGovernor,
    nextRecommendedAction: nextAction(status, projection),
  });
}