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

interface MirrorMissionListResponse {
  readonly missions: readonly MirrorMissionListItem[];
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