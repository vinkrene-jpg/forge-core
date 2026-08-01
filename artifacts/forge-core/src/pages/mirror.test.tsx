import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Route, Router } from "wouter";
import { Layout } from "@/components/layout";
import { filterMirrorMissions, sortTimeline, type MirrorResumeResponse, type MirrorTimelineEvent } from "@/lib/mirror-api";
import { MirrorDetailPage, MirrorOverviewPage } from "@/pages/mirror";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/mirror",
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  location: dom.window.location,
  history: dom.window.history,
  localStorage: dom.window.localStorage,
  addEventListener: dom.window.addEventListener.bind(dom.window),
  removeEventListener: dom.window.removeEventListener.bind(dom.window),
  dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
  cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  IS_REACT_ACT_ENVIRONMENT: true,
  React,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
Object.defineProperty(dom.window, "matchMedia", {
  configurable: true,
  value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});

interface RequestRecord {
  readonly url: string;
  readonly method: string;
}

const baseMission = {
  missionId: "mission-alpha",
  title: "Bouw de Mirror-interface",
  status: "succeeded",
  firstOccurredAt: "2026-07-31T10:00:00.000Z",
  lastOccurredAt: "2026-07-31T11:00:00.000Z",
  eventCount: 4,
  integrityWarnings: [] as readonly string[],
};

function event(overrides: Partial<MirrorTimelineEvent>): MirrorTimelineEvent {
  return {
    missionId: "mission-alpha",
    eventId: "event-1",
    eventType: "input_received",
    occurredAt: "2026-07-31T10:00:00.000Z",
    sequence: 1,
    sourceType: "mission",
    sourceId: "mission-alpha",
    actorType: "operator",
    summary: "Opdracht ontvangen",
    payloadReference: "mission.input",
    status: "created",
    integrityFlags: [],
    ...overrides,
  };
}

const detailResponse = {
  mission: {
    id: "mission-alpha",
    title: "Bouw de Mirror-interface",
    status: "succeeded",
    createdAt: "2026-07-31T10:00:00.000Z",
    updatedAt: "2026-07-31T11:00:00.000Z",
  },
  timeline: [
    event({ eventId: "event-3", eventType: "result_published", occurredAt: "2026-07-31T11:00:00.000Z", sequence: 3, summary: "Resultaat gereed" }),
    event({ eventId: "event-1", sequence: 1 }),
    event({ eventId: "event-2", eventType: "approval_granted", occurredAt: "2026-07-31T10:30:00.000Z", sequence: 2, sourceType: "approval", sourceId: "approval-1", actorType: "governance", summary: "Goedgekeurd", status: "approved" }),
  ],
  approvals: [{ id: "approval-1", reason: "Veilige uitvoering" }],
  evidence: [event({ eventId: "evidence-1", eventType: "evidence_created", summary: "Build geslaagd" })],
  artifacts: [{ id: "artifact-1", path: "dist/index.js" }],
  assessments: [event({ eventId: "assessment-1", eventType: "evaluation_completed", summary: "Beoordeling geaccepteerd" })],
  result: { status: "completed", message: "Klaar" },
  missingLinks: ["guardian_review"],
  duplicateWarnings: ["duplicate source approval/approval-1 (2)"],
  integrityWarnings: ["missing guardian_review", "duplicate source approval/approval-1 (2)"],
};

const sessionResponse = {
  sessionId: "mirror-session-1234567890abcdef12345678",
  missionId: "mission-alpha",
  startedAt: "2026-07-31T10:00:00.000Z",
  lastActivity: "2026-07-31T11:00:00.000Z",
  status: "COMPLETED",
  currentPhase: "Afgerond",
  currentStep: "result_published",
  completionPercentage: 30,
  activeBlockers: [] as readonly string[],
  pendingApprovals: 0,
  pendingEvidence: false,
  pendingGuardian: true,
  pendingGovernor: false,
  nextRecommendedAction: "Geen actie nodig; het resultaat is gepubliceerd.",
};

const resumeResponse: MirrorResumeResponse = {
  resumeAvailable: true,
  ambiguous: false,
  resume: {
    missionId: "mission-alpha",
    sessionId: "mirror-session-1234567890abcdef12345678",
    missionTitle: "Bouw de Mirror-interface",
    resumeStatus: "BLOCKED",
    lastVerifiedAt: "2026-07-31T11:00:00.000Z",
    lastVerifiedEventId: "event-3",
    lastCompletedPhase: "Bewijs",
    lastCompletedStep: "evidence_created",
    currentPhase: "Geblokkeerd",
    currentStep: "error_recorded",
    completionPercentage: 45,
    activeBlockers: ["Runtime-test ontbreekt"],
    pendingApprovals: 0,
    pendingEvidence: false,
    pendingGuardian: true,
    pendingGovernor: false,
    lastKnownCommit: { value: null, certainty: "ONBEKEND", source: null },
    lastKnownRuntimeState: { value: null, certainty: "ONBEKEND", source: null },
    nextRecommendedAction: {
      actionType: "RESOLVE_BLOCKER",
      explanation: "Voer de ontbrekende runtime-test uit.",
      source: "SessionModel.activeBlockers",
      prerequisite: "Testbewijs vereist.",
      forbiddenActions: ["Niet automatisch uitvoeren."],
      confidence: "HIGH",
    },
    resumeReason: "Bewezen event.",
    integrityWarnings: ["missing guardian_review"],
    fieldCertainty: { currentState: "AFGELEID" },
    evidenceSources: [],
    missingData: ["lastKnownCommit"],
  },
  candidates: [],
  nextRecommendedAction: {
    actionType: "RESOLVE_BLOCKER",
    explanation: "Voer de ontbrekende runtime-test uit.",
    source: "SessionModel.activeBlockers",
    prerequisite: "Testbewijs vereist.",
    forbiddenActions: ["Niet automatisch uitvoeren."],
    confidence: "HIGH",
  },
  integrityWarnings: ["missing guardian_review"],
};

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${message}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount(
  component: React.ReactNode,
  fetcher: typeof fetch,
): Promise<{ readonly container: HTMLElement; readonly root: Root; readonly requests: RequestRecord[] }> {
  const requests: RequestRecord[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return fetcher(input, init);
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
  });
  return { container, root, requests };
}

async function unmount(root: Root): Promise<void> {
  const container = rootContainer(root);
  await act(async () => root.unmount());
  container?.remove();
}

function rootContainer(root: Root): HTMLElement | null {
  return (root as unknown as { _internalRoot?: { containerInfo?: HTMLElement } })
    ._internalRoot?.containerInfo ?? null;
}

function listFetcher(missions = [baseMission], resume = resumeResponse): typeof fetch {
  return async (input) => {
    if (String(input) === "/api/mirror/missions") return Response.json({ missions });
    if (String(input) === "/api/mirror/resume") return Response.json(resume);
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
}

function detailFetcher(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url === "/api/mirror/missions/mission-alpha") {
    return Promise.resolve(Response.json(detailResponse));
  }
  if (url === "/api/mirror/session/mission-alpha") {
    return Promise.resolve(Response.json(sessionResponse));
  }
  return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
}

test("MIRROR_UI_01 frontend acceptance", { concurrency: false }, async (suite) => {
  await suite.test("1. navigatie toont Mirror als hoofdtoegang", async () => {
    const mounted = await mount(
      <Router><Layout><div>Inhoud</div></Layout></Router>,
      async (input) => String(input) === "/api/forge/runtime"
        ? Response.json({ health: { status: "ok" }, persistence: { runtimeId: "runtime-test" } })
        : Response.json({ error: "unexpected" }, { status: 500 }),
    );
    const link = [...mounted.container.querySelectorAll("a")].find((item) => item.textContent?.trim() === "Mirror");
    assert.equal(link?.getAttribute("href"), "/mirror");
    await unmount(mounted.root);
  });

  await suite.test("2-3. lijst laadt met één lijstrequest en geen detailrequest per regel", async () => {
    const mounted = await mount(<MirrorOverviewPage />, listFetcher());
    await waitFor(() => mounted.container.textContent?.includes("Bouw de Mirror-interface") === true, "lijst");
    assert.equal(mounted.requests.filter((request) => request.url === "/api/mirror/missions").length, 1);
    assert.equal(mounted.requests.filter((request) => request.url === "/api/mirror/resume").length, 1);
    assert.equal(mounted.requests.some((request) => request.url.includes("/api/mirror/missions/")), false);
    await unmount(mounted.root);
  });

  await suite.test("4. zoeken op missionId, titel of samenvatting", () => {
    const records = [baseMission, { ...baseMission, missionId: "mission-beta", title: "Andere missie" }];
    assert.deepEqual(filterMirrorMissions(records, "MISSION-BETA", "all").map((item) => item.missionId), ["mission-beta"]);
    assert.deepEqual(filterMirrorMissions(records, "andere", "all").map((item) => item.missionId), ["mission-beta"]);
  });

  await suite.test("5. statusfilter", () => {
    const records = [baseMission, { ...baseMission, missionId: "mission-running", title: "Lopende missie", status: "running" }];
    assert.deepEqual(filterMirrorMissions(records, "", "running").map((item) => item.missionId), ["mission-running"]);
  });

  await suite.test("6. lege toestand", async () => {
    const mounted = await mount(<MirrorOverviewPage />, listFetcher([]));
    await waitFor(() => mounted.container.textContent?.includes("Geen missies gevonden") === true, "lege toestand");
    await unmount(mounted.root);
  });

  await suite.test("7. API-fout stopt en opnieuw proberen werkt", async () => {
    let attempts = 0;
    const mounted = await mount(<MirrorOverviewPage />, async (input) => {
      if (String(input) === "/api/mirror/resume") return Response.json(resumeResponse);
      attempts += 1;
      return attempts === 1 ? Response.json({ error: "offline" }, { status: 500 }) : Response.json({ missions: [baseMission] });
    });
    await waitFor(() => mounted.container.textContent?.includes("Opnieuw proberen") === true, "foutmelding");
    assert.equal(attempts, 1);
    const button = [...mounted.container.querySelectorAll("button")].find((item) => item.textContent?.includes("Opnieuw proberen"));
    assert.ok(button);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => mounted.container.textContent?.includes("Bouw de Mirror-interface") === true, "retryresultaat");
    assert.equal(attempts, 2);
    await unmount(mounted.root);
  });

  await suite.test("8. detail laadt alle gekoppelde secties", async () => {
    dom.window.history.replaceState({}, "", "/mirror/mission-alpha");
    const mounted = await mount(<Router><Route path="/mirror/:missionId"><MirrorDetailPage /></Route></Router>, detailFetcher);
    await waitFor(() => mounted.container.textContent?.includes("Chronologische tijdlijn") === true, "detail");
    for (const label of ["Goedkeuringen", "Bewijs", "Bestanden", "Beoordelingen", "Resultaat"]) assert.match(mounted.container.textContent ?? "", new RegExp(label));
    assert.match(mounted.container.textContent ?? "", /Claude Mirror/);
    assert.match(mounted.container.textContent ?? "", /Voortgang/);
    assert.match(mounted.container.textContent ?? "", /Volgende stap/);
    assert.match(mounted.container.textContent ?? "", /Geen actieve blockers/);
    await unmount(mounted.root);
  });

  await suite.test("9-10. tijdlijn sorteert chronologisch en deterministisch bij gelijke tijden", () => {
    const sameTime = "2026-07-31T10:00:00.000Z";
    const sorted = sortTimeline([
      event({ eventId: "z", sequence: 2, occurredAt: sameTime, sourceId: "z" }),
      event({ eventId: "late", sequence: 3, occurredAt: "2026-07-31T11:00:00.000Z" }),
      event({ eventId: "a", sequence: 1, occurredAt: sameTime, sourceId: "a" }),
    ]);
    assert.deepEqual(sorted.map((item) => item.eventId), ["a", "z", "late"]);
  });

  await suite.test("11-12. integriteitswaarschuwingen en ontbrekende schakels zijn zichtbaar", async () => {
    dom.window.history.replaceState({}, "", "/mirror/mission-alpha");
    const mounted = await mount(<Router><Route path="/mirror/:missionId"><MirrorDetailPage /></Route></Router>, detailFetcher);
    await waitFor(() => mounted.container.textContent?.includes("Guardian-beoordeling ontbreekt") === true, "ontbrekende schakel");
    assert.match(mounted.container.textContent ?? "", /Dubbele gebeurtenis gedetecteerd/);
    assert.match(mounted.container.textContent ?? "", /missing guardian_review/);
    await unmount(mounted.root);
  });

  await suite.test("13. onbekende missionId heeft nette 404-weergave", async () => {
    dom.window.history.replaceState({}, "", "/mirror/onbekend");
    const mounted = await mount(<Router><Route path="/mirror/:missionId"><MirrorDetailPage /></Route></Router>, async () => Response.json({ error: "not found" }, { status: 404 }));
    await waitFor(() => mounted.container.textContent?.includes("Missie niet gevonden") === true, "404");
    assert.match(mounted.container.textContent ?? "", /Terug naar Missies/);
    await unmount(mounted.root);
  });

  await suite.test("14. Mirror UI verstuurt uitsluitend GET", async () => {
    dom.window.history.replaceState({}, "", "/mirror/mission-alpha");
    const mounted = await mount(<Router><Route path="/mirror/:missionId"><MirrorDetailPage /></Route></Router>, detailFetcher);
    await waitFor(() => mounted.container.querySelector("[data-testid=\"claude-mirror-session\"]") !== null, "sessionrequest");
    assert.deepEqual([...new Set(mounted.requests.map((request) => request.method))], ["GET"]);
    assert.deepEqual(mounted.requests.map((request) => request.url).sort(), [
      "/api/mirror/missions/mission-alpha",
      "/api/mirror/session/mission-alpha",
    ]);
    await unmount(mounted.root);
  });

  await suite.test("15. 3.000 missies renderen begrensd tot 50 rijen", async () => {
    dom.window.history.replaceState({}, "", "/mirror");
    const many = Array.from({ length: 3_000 }, (_, index) => ({ ...baseMission, missionId: `mission-${String(index).padStart(4, "0")}`, title: `Missie ${index}` }));
    const startedAt = performance.now();
    const mounted = await mount(<MirrorOverviewPage />, listFetcher(many));
    await waitFor(() => mounted.container.querySelectorAll("tbody tr").length === 50, "grote lijst");
    const elapsedMs = performance.now() - startedAt;
    assert.equal(mounted.container.querySelectorAll("tbody tr").length, 50);
    assert.ok(elapsedMs < 2_000, `begrensde render duurde ${elapsedMs.toFixed(0)} ms`);
    assert.equal(mounted.requests.length, 2);
    await unmount(mounted.root);
  });

  await suite.test("16-17. Verdergaan toont bewezen resume-data en alleen navigatieacties", async () => {
    dom.window.history.replaceState({}, "", "/mirror");
    const mounted = await mount(<MirrorOverviewPage />, listFetcher());
    await waitFor(() => mounted.container.querySelector("[data-testid=\"mirror-resume\"]")?.textContent?.includes("Runtime-test ontbreekt") === true, "resume");
    const panel = mounted.container.querySelector("[data-testid=\"mirror-resume\"]");
    const text = panel?.textContent ?? "";
    for (const value of ["Verdergaan", "evidence_created", "45%", "Voer de ontbrekende runtime-test uit", "AFGELEID"]) assert.match(text, new RegExp(value));
    assert.deepEqual([...panel?.querySelectorAll("a") ?? []].map((link) => link.textContent), ["Open missie", "Bekijk tijdlijn"]);
    assert.equal(panel?.querySelector("button"), null);
    assert.deepEqual([...new Set(mounted.requests.map((request) => request.method))], ["GET"]);
    await unmount(mounted.root);
  });

  await suite.test("ambiguïteit toont maximaal vijf kandidaten zonder schrijfknop", async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      missionId: `candidate-${index}`,
      missionTitle: `Kandidaat ${index}`,
      resumeStatus: "ACTIVE" as const,
      lastVerifiedAt: "2026-08-01T10:00:00.000Z",
      selectionReason: "actieve missie",
    }));
    const ambiguous: MirrorResumeResponse = {
      ...resumeResponse,
      ambiguous: true,
      resume: null,
      candidates,
      nextRecommendedAction: {
        ...resumeResponse.nextRecommendedAction,
        actionType: "CHOOSE_MISSION",
        explanation: "Kies expliciet één missie om te hervatten.",
      },
      integrityWarnings: ["Meerdere hervatbare missies."],
    };
    const mounted = await mount(<MirrorOverviewPage />, listFetcher([baseMission], ambiguous));
    await waitFor(() => mounted.container.textContent?.includes("Meerdere mogelijke missies") === true, "ambiguïteit");
    const panel = mounted.container.querySelector("[data-testid=\"mirror-resume\"]");
    assert.equal(panel?.querySelectorAll("a").length, 10);
    assert.equal(panel?.querySelector("button"), null);
    assert.match(panel?.textContent ?? "", /Meerdere hervatbare missies/);
    await unmount(mounted.root);
  });
});