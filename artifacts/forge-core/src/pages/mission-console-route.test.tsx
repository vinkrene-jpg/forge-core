import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";

const rawObjective = [
  "Maak uitsluitend één nieuw testbestand aan:",
  "",
  "Pad: sandbox/mirror-generic-build-proof-10.txt",
  "",
  "Exacte inhoud: Forge generic-build live approval proof",
  "Datum: 2026-07-30",
  "Doel: tweede workspace approval en echte execution evidence aantonen",
  "",
  "Wijzig geen enkel ander bestand.",
  "Gebruik dit exacte pad als expliciet target met allowCreate=true.",
  "Voer typecheck uit als verificatie.",
  "Niet pushen.",
].join("\n");

function brokenLivePreviewRequest(command: string) {
  return {
    kind: "operator.autonomous-cycle" as const,
    title: command,
    input: {
      projectId: "forge-core",
      objective: command.replace(/\n+/g, " "),
      proofTargetPath: command.includes("mirror-generic-build-proof-10.txt")
        ? "mirror-generic-build-proof-10.txt"
        : undefined,
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for mounted Mission Console");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("mounted / route canonicalizes proof-10 in the final Start missie POST", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    { url: "http://localhost/" },
  );
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown }> = [];
  let finalCreateBody: Readonly<Record<string, unknown>> | null = null;

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
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(callback, 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body =
      typeof init?.body === "string"
        ? JSON.parse(init.body) as Readonly<Record<string, unknown>>
        : null;
    requests.push({ url, body });

    if (url === "/api/operator/mission-intake/preview") {
      const command = String(body?.command ?? "");
      const request = brokenLivePreviewRequest(command);
      return Response.json({
        originalCommand: command,
        interpretedGoal: command,
        missionKind: request.kind,
        request,
        governance: {
          status: "approval_required",
          decision: "require_approval",
          riskLevel: "medium",
          reason: "Operator approval required.",
          hardBoundaryActive: true,
        },
        expectedCapabilities: [],
      });
    }

    if (url === "/api/missions" && init?.method === "POST") {
      finalCreateBody = body;
      return Response.json({
        id: "mounted-route-planning-mission",
        ...finalCreateBody,
        status: "awaiting_approval",
        createdAt: "2026-07-30T10:00:00.000Z",
        updatedAt: "2026-07-30T10:00:00.000Z",
        startedAt: null,
        completedAt: null,
        attempts: 0,
        interruptedCount: 0,
        output: null,
        lastError: null,
        governance: {
          decision: "require_approval",
          riskLevel: "medium",
        },
        approval: {
          id: "operator-approval",
          status: "pending",
        },
        capabilityAnalysis: {},
      }, { status: 202 });
    }

    if (url === "/api/missions/mounted-route-planning-mission") {
      return Response.json({
        id: "mounted-route-planning-mission",
        ...finalCreateBody,
        status: "awaiting_approval",
        output: null,
      });
    }

    return Response.json({ error: `Unexpected request: ${url}` }, { status: 500 });
  };

  const [{ act }, { createRoot }, { default: App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../App"),
  ]);
  const container = document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(React.createElement(App));
    });
    assert.match(
      container.textContent ?? "",
      /Build mission-console-mounted-submit-2026-07-30\.2/,
    );

    const textarea = container.querySelector("textarea");
    assert.ok(textarea);
    const valueSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    assert.ok(valueSetter);

    await act(async () => {
      valueSetter.call(textarea, rawObjective);
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await waitFor(() =>
      requests.some(
        (request) =>
          request.url === "/api/operator/mission-intake/preview" &&
          (request.body as { command?: unknown })?.command === rawObjective,
      ),
    );

    const startButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Start missie"),
    );
    assert.ok(startButton);
    await act(async () => {
      await waitFor(() => !startButton.disabled);
    });
    assert.equal(startButton.disabled, false);

    await act(async () => {
      startButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      await waitFor(() => finalCreateBody !== null);
    });

    const postedRequest = finalCreateBody as
      | ReturnType<typeof brokenLivePreviewRequest> & {
          readonly input: {
            readonly rawObjective: string;
            readonly targets: readonly {
              readonly path: string;
              readonly allowCreate: boolean;
            }[];
            readonly objectiveExecutionMode: string;
            readonly objectiveProfile: string;
            readonly proofTargetPath: string;
          };
        }
      | null;
    assert.ok(postedRequest);
    assert.equal(postedRequest.input.rawObjective, rawObjective);
    assert.deepEqual(postedRequest.input.targets, [{
      path: "sandbox/mirror-generic-build-proof-10.txt",
      allowCreate: true,
    }]);
    assert.equal(
      postedRequest.input.objectiveExecutionMode,
      "build-or-mutate",
    );
    assert.equal(
      postedRequest.input.objectiveProfile,
      "generic-build",
    );
    assert.equal(
      postedRequest.input.proofTargetPath,
      "sandbox/mirror-generic-build-proof-10.txt",
    );

    const diagnostics = container.querySelector(
      "[data-testid=\"mission-console-request-diagnostics\"]",
    )?.textContent ?? "";
    assert.match(diagnostics, /\/api\/missions/);
    assert.match(diagnostics, /sandbox\/mirror-generic-build-proof-10\.txt/);
    assert.match(diagnostics, /build-or-mutate/);
    assert.match(diagnostics, /generic-build/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
