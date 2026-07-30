import assert from "node:assert/strict";
import test from "node:test";
import { handleMissionConsoleSubmit } from "./mission-console-submit";

test("Start missie posts the current proof-7 textarea intake request", async () => {
  const rawObjective = [
    "Maak uitsluitend één nieuw testbestand aan:",
    "",
    "Pad: sandbox/mirror-generic-build-proof-7.txt",
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
  const createRequest = {
    kind: "operator.autonomous-cycle" as const,
    title: rawObjective,
    input: {
      projectId: "forge-core",
      objective: rawObjective.replace(/\n+/g, " "),
      rawObjective,
      targets: [{
        path: "sandbox/mirror-generic-build-proof-7.txt",
        allowCreate: true,
      }],
      intakeObjectiveExecutionMode: "build-or-mutate",
      intakeObjectiveProfile: "generic-build",
    },
  };
  const requests: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });

    if (url === "/api/operator/mission-intake/preview") {
      return Response.json({
        originalCommand: rawObjective,
        interpretedGoal: rawObjective,
        missionKind: "operator.autonomous-cycle",
        request: createRequest,
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

    if (url === "/api/missions") {
      return Response.json({
        id: "planning-mission",
        ...createRequest,
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

    return Response.json({ error: "Unexpected request" }, { status: 500 });
  };

  try {
    await handleMissionConsoleSubmit(rawObjective);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, [
    {
      url: "/api/operator/mission-intake/preview",
      body: { command: rawObjective },
    },
    {
      url: "/api/missions",
      body: createRequest,
    },
  ]);
  assert.equal(
    (requests[1].body as typeof createRequest).input.rawObjective,
    rawObjective,
  );
  assert.deepEqual(
    (requests[1].body as typeof createRequest).input.targets,
    [{
      path: "sandbox/mirror-generic-build-proof-7.txt",
      allowCreate: true,
    }],
  );
  assert.equal(
    (requests[1].body as typeof createRequest).input
      .intakeObjectiveExecutionMode,
    "build-or-mutate",
  );
  assert.equal(
    (requests[1].body as typeof createRequest).input.intakeObjectiveProfile,
    "generic-build",
  );
});
