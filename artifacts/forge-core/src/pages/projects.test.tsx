import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import Projects from "./projects";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/projects" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error("Timed out waiting for product overview");
}

test("Forge Control shows product status and starts a registered product", async () => {
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/start")) return Response.json({ started: true }, { status: 202 });
    return Response.json({
      products: [
        {
          product: { id: "forge-core", name: "Forge Core", rootPath: "C:/Forge/forge-core", description: "Core", startCommand: ["pnpm.cmd", "forge:start"], verificationCommand: ["pnpm.cmd", "validate"], origin: "forge-built", goal: "Build Forge", sourceMissionId: null, createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-16T00:00:00.000Z" },
          workspaceExists: true, running: true, managedProcess: false, canStart: false, canStop: false, lastChangedAt: "2026-08-16T12:00:00.000Z", lastVerification: { status: "passed", verifiedAt: "2026-08-16T12:30:00.000Z", source: "forge-validation", missionId: null }, currentWork: { missionId: "m1", title: "Productregister bouwen", status: "running" },
        },
        {
          product: { id: "assumption-engine", name: "Assumption Engine", rootPath: "D:/Forge/assumption-engine", description: "Assumptions", startCommand: ["pnpm.cmd", "dev"], verificationCommand: ["pnpm.cmd", "build"], origin: "introduced", goal: "Test assumptions", sourceMissionId: null, createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-16T00:00:00.000Z" },
          workspaceExists: true, running: false, managedProcess: false, canStart: true, canStop: false, lastChangedAt: null, lastVerification: null, currentWork: null,
        },
        {
          product: { id: "forge-cad-engine", name: "Forge CAD Engine", rootPath: "D:/Forge/forge-cad-engine", description: "CAD", startCommand: [], verificationCommand: [], origin: "forge-built", goal: "Build CAD", sourceMissionId: null, createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-16T00:00:00.000Z" },
          workspaceExists: false, running: false, managedProcess: false, canStart: false, canStop: false, lastChangedAt: null, lastVerification: null, currentWork: null,
        },
      ],
    });
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><TooltipProvider><Projects /></TooltipProvider></QueryClientProvider>);
  });
  await waitFor(() => document.body.textContent?.includes("Forge CAD Engine") === true);

  assert.match(document.body.textContent ?? "", /Productregister/);
  assert.match(document.body.textContent ?? "", /Productregister bouwen/);
  assert.match(document.body.textContent ?? "", /Geslaagd/);
  const start = document.querySelector<HTMLButtonElement>('button[aria-label="Assumption Engine starten"]');
  assert.equal(start?.disabled, false);
  await act(async () => { start?.click(); });
  await waitFor(() => requests.includes("POST /api/operator/products/assumption-engine/start"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  await act(async () => { root.unmount(); });
  queryClient.clear();
});