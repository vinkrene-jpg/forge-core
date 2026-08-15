import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import Capabilities from "./capabilities-live";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/capabilities",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for capability gaps");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

test("shows ranked outcome gaps and releases a candidate GoalSpec", async () => {
  const requests: Array<{ readonly url: string; readonly method: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url === "/api/runtime") {
      return Response.json({ capabilities: { operational: 2, validated: 0, experimental: 0, total: 2 } });
    }
    if (url === "/api/capabilities") {
      return Response.json({ capabilities: [{
        id: "evaluation.output.assess",
        name: "Output Evaluation",
        description: "Evaluates output",
        status: "operational",
        version: "1.0.0",
        confidence: 1,
        source: "test",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      }] });
    }
    if (url === "/api/capability-gaps") {
      return Response.json({ candidates: [{
        id: "gap-top",
        capabilityId: "evaluation.output.assess",
        capabilityName: "Output Evaluation",
        cause: "evaluation-rejected:verification-explicit",
        occurrences: 3,
        missionIds: ["590a73c5-full", "455dd01a-full", "ed87826a-full"],
        latestAt: "2026-08-15T00:00:00.000Z",
        proposedGoalSpec: {
          objective: "Strengthen output evaluation",
          desiredBehavior: ["Rejected output yields capability evidence."],
          constraints: ["No authority widening."],
          acceptanceCriteria: [{ id: "gap", statement: "Gap is handled safely.", evidence: "Mission evidence exists." }],
        },
        releasedGoalSpecMissionId: null,
      }] });
    }
    if (url === "/api/capability-goal-runs" && !init?.method) {
      return Response.json({ runs: [] });
    }
    if (url === "/api/capability-goal-runs" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { mandate: Record<string, unknown> };
      assert.deepEqual(body.mandate, {
        allowedDirectories: ["lib/", "artifacts/"],
        maximumGoals: 3,
        maximumCapabilityImprovements: 2,
        maximumImprovementDepth: 2,
        maximumDurationMs: 3_600_000,
        maximumCostUsd: 5,
      });
      return Response.json({ id: "goal-run", status: "awaiting_approval", approval: { id: "approval" } }, { status: 202 });
    }
    if (url === "/api/capability-gaps/gap-top/release" && init?.method === "POST") {
      return Response.json({ mission: { id: "released-goal", status: "not_started" } }, { status: 201 });
    }
    return Response.json({ error: `Unexpected request: ${url}` }, { status: 500 });
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Capabilities /></QueryClientProvider>);
    });
    await waitFor(() => container.textContent?.includes("3 keer") === true);
    assert.match(container.textContent ?? "", /Wat mist Forge/);
    assert.match(container.textContent ?? "", /evaluation-rejected:verification-explicit/);
    assert.match(container.textContent ?? "", /590a73c5 · 455dd01a · ed87826a/);
    assert.match(container.textContent ?? "", /Strengthen output evaluation/);

    const runButton = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Run-mandaat aanvragen")
    );
    assert.ok(runButton);
    await act(async () => runButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => requests.some((request) =>
      request.url === "/api/capability-goal-runs" && request.method === "POST"
    ));

    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("GoalSpec vrijgeven")
    );
    assert.ok(button);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => requests.some((request) =>
      request.url === "/api/capability-gaps/gap-top/release" && request.method === "POST"
    ));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});