import { useQuery } from "@tanstack/react-query";

export interface MirrorMissionListItem {
  readonly missionId: string;
  readonly title: string;
  readonly status: string;
  readonly firstOccurredAt: string;
  readonly lastOccurredAt: string;
  readonly eventCount: number;
  readonly integrityWarnings: readonly string[];
}

export interface MirrorTimelineEvent {
  readonly missionId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly sequence: number;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly actorType: string;
  readonly summary: string;
  readonly payloadReference: string;
  readonly status: string;
  readonly integrityFlags: readonly string[];
}

export interface MirrorMissionDetail {
  readonly mission: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly timeline: readonly MirrorTimelineEvent[];
  readonly approvals: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly MirrorTimelineEvent[];
  readonly artifacts: readonly Readonly<Record<string, unknown>>[];
  readonly assessments: readonly MirrorTimelineEvent[];
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly missingLinks: readonly string[];
  readonly duplicateWarnings: readonly string[];
  readonly integrityWarnings: readonly string[];
}

export interface MirrorSessionModel {
  readonly sessionId: string;
  readonly missionId: string;
  readonly startedAt: string;
  readonly lastActivity: string;
  readonly status:
    | "NOT_STARTED"
    | "ACTIVE"
    | "WAITING_APPROVAL"
    | "WAITING_EVIDENCE"
    | "WAITING_REVIEW"
    | "READY_FOR_RELEASE"
    | "COMPLETED"
    | "BLOCKED";
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

export interface MirrorResumeAction {
  readonly actionType: string;
  readonly explanation: string;
  readonly source: string;
  readonly prerequisite: string;
  readonly forbiddenActions: readonly string[];
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface MirrorResumeModel {
  readonly missionId: string;
  readonly sessionId: string;
  readonly missionTitle: string;
  readonly resumeStatus: MirrorSessionModel["status"];
  readonly lastVerifiedAt: string;
  readonly lastVerifiedEventId: string | null;
  readonly lastCompletedPhase: string;
  readonly lastCompletedStep: string;
  readonly currentPhase: string;
  readonly currentStep: string;
  readonly completionPercentage: number;
  readonly activeBlockers: readonly string[];
  readonly pendingApprovals: number;
  readonly pendingEvidence: boolean;
  readonly pendingGuardian: boolean;
  readonly pendingGovernor: boolean;
  readonly lastKnownCommit: {
    readonly value: string | null;
    readonly certainty: string;
    readonly source: string | null;
  };
  readonly lastKnownRuntimeState: {
    readonly value: Readonly<Record<string, unknown>> | null;
    readonly certainty: string;
    readonly source: string | null;
  };
  readonly nextRecommendedAction: MirrorResumeAction;
  readonly resumeReason: string;
  readonly integrityWarnings: readonly string[];
  readonly fieldCertainty: { readonly currentState: string };
  readonly evidenceSources: readonly Readonly<Record<string, unknown>>[];
  readonly missingData: readonly string[];
}

export interface MirrorResumeResponse {
  readonly resumeAvailable: boolean;
  readonly ambiguous: boolean;
  readonly resume: MirrorResumeModel | null;
  readonly candidates: readonly {
    readonly missionId: string;
    readonly missionTitle: string;
    readonly resumeStatus: MirrorSessionModel["status"];
    readonly lastVerifiedAt: string;
    readonly selectionReason: string;
  }[];
  readonly nextRecommendedAction: MirrorResumeAction;
  readonly integrityWarnings: readonly string[];
}

interface MirrorMissionListResponse {
  readonly missions: readonly MirrorMissionListItem[];
}

export interface MirrorMissionIntakeRequest {
  readonly requestId: string;
  readonly title: string;
  readonly objective: string;
  readonly context: string;
  readonly requestedBy: string;
  readonly priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly string[];
}

export interface MirrorMissionIntakeResponse {
  readonly missionId: string;
  readonly status: "NOT_STARTED";
  readonly createdAt: string;
  readonly detailUrl: string;
}

export class MirrorApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MirrorApiError";
    this.status = status;
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: "GET", signal });
  if (!response.ok) {
    throw new MirrorApiError(
      response.status,
      response.status === 404
        ? "Deze missie is niet gevonden."
        : "Mirror kon niet worden geladen.",
    );
  }
  return response.json() as Promise<T>;
}

export async function createMirrorMission(
  request: MirrorMissionIntakeRequest,
): Promise<MirrorMissionIntakeResponse> {
  const response = await fetch("/api/mirror/missions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": request.requestId,
      "X-Forge-Actor": request.requestedBy,
      "X-Forge-Role": "owner",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new MirrorApiError(
      response.status,
      typeof body?.error === "string" ? body.error : "De missie kon niet worden opgeslagen.",
    );
  }
  return response.json() as Promise<MirrorMissionIntakeResponse>;
}

export function useMirrorMissions() {
  return useQuery({
    queryKey: ["mirror", "missions"],
    queryFn: ({ signal }) =>
      getJson<MirrorMissionListResponse>("/api/mirror/missions", signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useMirrorMission(missionId: string) {
  return useQuery({
    queryKey: ["mirror", "mission", missionId],
    queryFn: ({ signal }) =>
      getJson<MirrorMissionDetail>(
        `/api/mirror/missions/${encodeURIComponent(missionId)}`,
        signal,
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useMirrorSession(missionId: string) {
  return useQuery({
    queryKey: ["mirror", "session", missionId],
    queryFn: ({ signal }) =>
      getJson<MirrorSessionModel>(
        `/api/mirror/session/${encodeURIComponent(missionId)}`,
        signal,
      ),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useMirrorResume(missionId?: string) {
  return useQuery({
    queryKey: ["mirror", "resume", missionId ?? "default"],
    queryFn: ({ signal }) => getJson<MirrorResumeResponse>(
      missionId
        ? `/api/mirror/resume/${encodeURIComponent(missionId)}`
        : "/api/mirror/resume",
      signal,
    ),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function sortTimeline(
  timeline: readonly MirrorTimelineEvent[],
): readonly MirrorTimelineEvent[] {
  return [...timeline].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.sequence - right.sequence ||
    left.eventType.localeCompare(right.eventType) ||
    left.sourceType.localeCompare(right.sourceType) ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.eventId.localeCompare(right.eventId));
}

export function filterMirrorMissions(
  missions: readonly MirrorMissionListItem[],
  search: string,
  status: string,
): readonly MirrorMissionListItem[] {
  const normalizedSearch = search.trim().toLocaleLowerCase("nl-NL");
  return missions
    .filter((mission) => status === "all" || mission.status === status)
    .filter((mission) =>
      normalizedSearch.length === 0 ||
      mission.missionId.toLocaleLowerCase("nl-NL").includes(normalizedSearch) ||
      mission.title.toLocaleLowerCase("nl-NL").includes(normalizedSearch))
    .sort((left, right) =>
      right.lastOccurredAt.localeCompare(left.lastOccurredAt) ||
      left.missionId.localeCompare(right.missionId));
}

export const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  input_received: "Input ontvangen",
  interpretation_created: "Interpretatie gemaakt",
  approval_requested: "Goedkeuring gevraagd",
  approval_granted: "Goedkeuring verleend",
  approval_rejected: "Goedkeuring afgewezen",
  execution_started: "AI-uitvoering gestart",
  execution_completed: "Uitvoering voltooid",
  evidence_created: "Bewijs vastgelegd",
  evaluation_completed: "Beoordeling voltooid",
  guardian_reviewed: "Guardian-beoordeling",
  governor_released: "Governor heeft vrijgegeven",
  governor_blocked: "Governor heeft geblokkeerd",
  result_published: "Resultaat gepubliceerd",
  error_recorded: "Fout vastgelegd",
});

export const MISSING_LINK_LABELS: Readonly<Record<string, string>> = Object.freeze({
  approval: "Goedkeuring ontbreekt",
  evidence: "Bewijs ontbreekt",
  guardian_review: "Guardian-beoordeling ontbreekt",
  governor_decision: "Governor-besluit ontbreekt",
  result: "Resultaat ontbreekt",
});