import type { MirrorMissionProjection, MirrorTimelineEvent } from "./mirrorProjection";
import { projectMirrorSession, type MirrorSessionModel } from "./mirrorSession";

export type ResumeCertainty = "BEWEZEN" | "AFGELEID" | "ONBEKEND" | "VERMOEDELIJK_VERLOPEN";

export interface ResumeEvidenceValue<T> {
  readonly value: T | null;
  readonly certainty: ResumeCertainty;
  readonly source: string | null;
}

export interface ResumeRuntimeState {
  readonly runtimeBuildSha: string | null;
  readonly runtimeModulePath: string | null;
  readonly status: string | null;
}

export interface ResumeAction {
  readonly actionType:
    | "RESOLVE_BLOCKER"
    | "WAIT_FOR_APPROVAL"
    | "COLLECT_EVIDENCE"
    | "REQUEST_GUARDIAN_REVIEW"
    | "REQUEST_GOVERNOR_DECISION"
    | "CONTINUE_EXECUTION"
    | "CHOOSE_MISSION"
    | "NO_ACTIVE_MISSION";
  readonly explanation: string;
  readonly source: string;
  readonly prerequisite: string;
  readonly forbiddenActions: readonly string[];
  readonly confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface ResumeEvidenceSource {
  readonly sourceType: MirrorTimelineEvent["sourceType"];
  readonly sourceId: string;
  readonly eventId: string;
  readonly certainty: ResumeCertainty;
}

export interface ResumeModel {
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
  readonly lastKnownCommit: ResumeEvidenceValue<string>;
  readonly lastKnownRuntimeState: ResumeEvidenceValue<ResumeRuntimeState>;
  readonly nextRecommendedAction: ResumeAction;
  readonly resumeReason: string;
  readonly fieldCertainty: {
    readonly lastVerifiedState: ResumeCertainty;
    readonly lastCompletedState: ResumeCertainty;
    readonly currentState: ResumeCertainty;
    readonly nextRecommendedAction: ResumeCertainty;
  };
  readonly integrityWarnings: readonly string[];
  readonly evidenceSources: readonly ResumeEvidenceSource[];
  readonly missingData: readonly string[];
}

export interface ResumeCandidate {
  readonly missionId: string;
  readonly missionTitle: string;
  readonly resumeStatus: MirrorSessionModel["status"];
  readonly lastVerifiedAt: string;
  readonly selectionReason: string;
}

export interface ResumeSelectionResult {
  readonly resumeAvailable: boolean;
  readonly ambiguous: boolean;
  readonly resume: ResumeModel | null;
  readonly candidates: readonly ResumeCandidate[];
  readonly nextRecommendedAction: ResumeAction;
  readonly integrityWarnings: readonly string[];
}

const COMPLETED_PHASES: Readonly<Partial<Record<MirrorTimelineEvent["eventType"], string>>> = Object.freeze({
  approval_granted: "Goedkeuring",
  execution_completed: "Uitvoering",
  evidence_created: "Bewijs",
  evaluation_completed: "Beoordeling",
  guardian_reviewed: "Guardian",
  governor_released: "Vrijgave",
  result_published: "Afgerond",
});

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function actionFor(session: MirrorSessionModel): ResumeAction {
  const forbiddenActions = Object.freeze([
    "Geen mutatie uitvoeren vanuit Mirror Resume.",
    "Geen ontbrekend bewijs of approval veronderstellen.",
  ]);
  if (session.activeBlockers.length > 0) {
    return Object.freeze({
      actionType: "RESOLVE_BLOCKER",
      explanation: "Inspecteer en herstel eerst de laatst bewezen blokkade.",
      source: "SessionModel.activeBlockers",
      prerequisite: "De blokkade moet met nieuw autoritatief bewijs zijn opgelost.",
      forbiddenActions,
      confidence: "HIGH",
    });
  }
  if (session.pendingApprovals > 0) {
    return Object.freeze({
      actionType: "WAIT_FOR_APPROVAL",
      explanation: "Wacht op de openstaande menselijke goedkeuring.",
      source: "SessionModel.pendingApprovals",
      prerequisite: "Een autoritatief approval-record met beslissing is vereist.",
      forbiddenActions,
      confidence: "HIGH",
    });
  }
  if (session.pendingEvidence) {
    return Object.freeze({
      actionType: "COLLECT_EVIDENCE",
      explanation: "Verzamel en controleer het ontbrekende uitvoeringsbewijs.",
      source: "SessionModel.pendingEvidence",
      prerequisite: "Een mission-gekoppeld evidence-record is vereist.",
      forbiddenActions,
      confidence: "HIGH",
    });
  }
  if (session.pendingGuardian) {
    return Object.freeze({
      actionType: "REQUEST_GUARDIAN_REVIEW",
      explanation: "Laat Guardian het bestaande bewijs beoordelen.",
      source: "SessionModel.pendingGuardian",
      prerequisite: "Beschikbaar bewijs moet autoritatief aan de missie gekoppeld zijn.",
      forbiddenActions,
      confidence: "HIGH",
    });
  }
  if (session.pendingGovernor) {
    return Object.freeze({
      actionType: "REQUEST_GOVERNOR_DECISION",
      explanation: "Laat Governor de beoordeelde missie vrijgeven of blokkeren.",
      source: "SessionModel.pendingGovernor",
      prerequisite: "Een bewezen Guardian-review is vereist.",
      forbiddenActions,
      confidence: "HIGH",
    });
  }
  return Object.freeze({
    actionType: "CONTINUE_EXECUTION",
    explanation: session.nextRecommendedAction,
    source: "SessionModel.nextRecommendedAction",
    prerequisite: "Controleer dat de bronstores sinds de laatste activiteit niet zijn gewijzigd.",
    forbiddenActions,
    confidence: session.status === "ACTIVE" ? "MEDIUM" : "LOW",
  });
}

function provenCommit(projection: MirrorMissionProjection): ResumeEvidenceValue<string> {
  const output = record(projection.mission.output);
  const executionEvidence = record(output?.executionEvidence);
  const commitSha = text(executionEvidence?.commitSha) ?? text(output?.commitSha);
  return Object.freeze(commitSha
    ? { value: commitSha, certainty: "BEWEZEN", source: "mission.output.executionEvidence.commitSha" }
    : { value: null, certainty: "ONBEKEND", source: null });
}

function provenRuntimeState(
  projection: MirrorMissionProjection,
): ResumeEvidenceValue<ResumeRuntimeState> {
  const output = record(projection.mission.output);
  const snapshot = record(output?.preExecutionSnapshot);
  if (!snapshot) {
    return Object.freeze({ value: null, certainty: "ONBEKEND", source: null });
  }
  const value = Object.freeze({
    runtimeBuildSha: text(snapshot.runtimeBuildSha),
    runtimeModulePath: text(snapshot.runtimeModulePath),
    status: text(snapshot.status),
  });
  if (!value.runtimeBuildSha && !value.runtimeModulePath && !value.status) {
    return Object.freeze({ value: null, certainty: "ONBEKEND", source: null });
  }
  return Object.freeze({
    value,
    certainty: "BEWEZEN",
    source: "mission.output.preExecutionSnapshot",
  });
}

export function projectMirrorResume(projection: MirrorMissionProjection): ResumeModel {
  const session = projectMirrorSession(projection);
  const guardianBlockers = projection.timeline
    .filter((event) => event.eventType === "guardian_reviewed" &&
      ["failed", "rejected", "blocked"].includes(event.status))
    .map((event) => event.summary);
  const activeBlockers = unique([...session.activeBlockers, ...guardianBlockers]);
  const resumeSession: MirrorSessionModel = activeBlockers.length > session.activeBlockers.length
    ? Object.freeze({
        ...session,
        status: "BLOCKED",
        currentPhase: "Geblokkeerd",
        activeBlockers,
      })
    : session;
  const lastEvent = projection.timeline.at(-1);
  const completedEvent = [...projection.timeline].reverse().find(
    (event) => COMPLETED_PHASES[event.eventType] !== undefined &&
      !["failed", "rejected", "blocked", "cancelled", "pending", "running"].includes(event.status),
  );
  const lastKnownCommit = provenCommit(projection);
  const lastKnownRuntimeState = provenRuntimeState(projection);
  const missingData = unique([
    ...projection.missingLinks,
    ...(lastKnownCommit.value ? [] : ["lastKnownCommit"]),
    ...(lastKnownRuntimeState.value ? [] : ["lastKnownRuntimeState"]),
  ]);
  const integrityWarnings = unique([
    ...projection.integrityWarnings,
    ...projection.timeline.flatMap((event) => event.integrityFlags),
  ]);

  return Object.freeze({
    missionId: projection.mission.id,
    sessionId: session.sessionId,
    missionTitle: projection.mission.title,
    resumeStatus: resumeSession.status,
    lastVerifiedAt: lastEvent?.occurredAt ?? projection.mission.updatedAt,
    lastVerifiedEventId: lastEvent?.eventId ?? null,
    lastCompletedPhase: completedEvent ? COMPLETED_PHASES[completedEvent.eventType] ?? "Onbekend" : "Geen",
    lastCompletedStep: completedEvent?.eventType ?? "geen_bewezen_voltooide_stap",
    currentPhase: resumeSession.currentPhase,
    currentStep: resumeSession.currentStep,
    completionPercentage: resumeSession.completionPercentage,
    activeBlockers,
    pendingApprovals: resumeSession.pendingApprovals,
    pendingEvidence: resumeSession.pendingEvidence,
    pendingGuardian: resumeSession.pendingGuardian,
    pendingGovernor: resumeSession.pendingGovernor,
    lastKnownCommit,
    lastKnownRuntimeState,
    nextRecommendedAction: actionFor(resumeSession),
    resumeReason: `Hervat op basis van ${lastEvent ? `bewezen event ${lastEvent.eventId}` : "de autoritatieve missie"}.`,
    fieldCertainty: Object.freeze({
      lastVerifiedState: lastEvent ? "BEWEZEN" : "ONBEKEND",
      lastCompletedState: completedEvent ? "BEWEZEN" : "ONBEKEND",
      currentState: "AFGELEID",
      nextRecommendedAction: "AFGELEID",
    }),
    integrityWarnings,
    evidenceSources: Object.freeze(projection.timeline.map((event) => Object.freeze({
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      eventId: event.eventId,
      certainty: "BEWEZEN" as const,
    }))),
    missingData,
  });
}

function selectionAction(
  actionType: "CHOOSE_MISSION" | "NO_ACTIVE_MISSION",
  explanation: string,
): ResumeAction {
  return Object.freeze({
    actionType,
    explanation,
    source: "deterministic resume candidate selection",
    prerequisite: actionType === "CHOOSE_MISSION"
      ? "René kiest expliciet één missionId uit de getoonde kandidaten."
      : "Er moet eerst een autoritatieve onvoltooide missie bestaan.",
    forbiddenActions: Object.freeze([
      "Geen kandidaat stilzwijgend kiezen.",
      "Geen selectie als nieuwe waarheid opslaan.",
      "Geen missie automatisch uitvoeren.",
    ]),
    confidence: "HIGH",
  });
}

function compareResume(left: ResumeModel, right: ResumeModel): number {
  return right.lastVerifiedAt.localeCompare(left.lastVerifiedAt) ||
    left.missionId.localeCompare(right.missionId);
}

function candidate(model: ResumeModel, selectionReason: string): ResumeCandidate {
  return Object.freeze({
    missionId: model.missionId,
    missionTitle: model.missionTitle,
    resumeStatus: model.resumeStatus,
    lastVerifiedAt: model.lastVerifiedAt,
    selectionReason,
  });
}

export function selectMirrorResume(
  projections: readonly MirrorMissionProjection[],
  explicitMissionId?: string,
): ResumeSelectionResult {
  const models = projections.map(projectMirrorResume);
  if (explicitMissionId) {
    const explicit = models.find((model) => model.missionId === explicitMissionId) ?? null;
    return Object.freeze({
      resumeAvailable: explicit !== null,
      ambiguous: false,
      resume: explicit,
      candidates: Object.freeze([]),
      nextRecommendedAction: explicit?.nextRecommendedAction ?? selectionAction(
        "NO_ACTIVE_MISSION",
        "De expliciet gevraagde missie bestaat niet.",
      ),
      integrityWarnings: Object.freeze(explicit ? explicit.integrityWarnings : ["unknown missionId"]),
    });
  }

  const tiers: readonly [readonly ResumeModel[], string][] = [
    [models.filter((model) => model.resumeStatus === "ACTIVE" || model.resumeStatus === "BLOCKED"), "actieve of geblokkeerde missie"],
    [models.filter((model) => model.pendingApprovals > 0 || model.pendingEvidence || model.pendingGuardian || model.pendingGovernor), "missie met openstaande governancestap"],
    [models.filter((model) => model.resumeStatus !== "COMPLETED"), "laatst actieve onvoltooide missie"],
  ];
  const selectedTier = tiers.find(([items]) => items.length > 0);
  if (!selectedTier) {
    const action = selectionAction("NO_ACTIVE_MISSION", "Geen hervatbare missie gevonden.");
    return Object.freeze({
      resumeAvailable: false,
      ambiguous: false,
      resume: null,
      candidates: Object.freeze([]),
      nextRecommendedAction: action,
      integrityWarnings: Object.freeze([]),
    });
  }

  const ranked = [...selectedTier[0]].sort(compareResume);
  if (ranked.length > 1) {
    const warning = `Meerdere hervatbare missies op prioriteit: ${selectedTier[1]}.`;
    return Object.freeze({
      resumeAvailable: true,
      ambiguous: true,
      resume: null,
      candidates: Object.freeze(ranked.slice(0, 5).map((model) => candidate(model, selectedTier[1]))),
      nextRecommendedAction: selectionAction("CHOOSE_MISSION", "Kies expliciet één missie om te hervatten."),
      integrityWarnings: Object.freeze([warning]),
    });
  }

  const resume = ranked[0];
  return Object.freeze({
    resumeAvailable: true,
    ambiguous: false,
    resume,
    candidates: Object.freeze([]),
    nextRecommendedAction: resume.nextRecommendedAction,
    integrityWarnings: resume.integrityWarnings,
  });
}