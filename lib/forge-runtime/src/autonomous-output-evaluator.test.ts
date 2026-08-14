import assert from "node:assert/strict";
import test from "node:test";

import type { AiExecutionRecord } from "./ai-gateway.js";
import {
  AutonomousOutputEvaluator,
  type AutonomousExecutionEvidence,
} from "./autonomous-cycle.js";

function execution(
  missionId: string,
  outputText: string,
  providerId: AiExecutionRecord["providerId"] = "local-model",
): AiExecutionRecord {
  const now = new Date().toISOString();
  return {
    id: "execution-1",
    missionId,
    compositionId: "composition-1",
    projectId: "forge-core",
    routeProfileId: "balanced-reasoning",
    providerId,
    model: "qwen2.5-coder:7b",
    status: "succeeded",
    inputChars: 500,
    outputText,
    usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
    estimatedCostUsd: 0,
    providerResponseId: null,
    error: null,
    createdAt: now,
    startedAt: now,
    completedAt: now,
  };
}

const groundedAnalysis = `
De database-opbouw is terug te vinden in lib/forge-runtime/src/runtime.ts en
lib/forge-runtime/src/autonomous-cycle.ts. De eerste locatie koppelt missies,
uitvoeringen en evaluaties. De tweede locatie bevat de mode-specifieke
beoordeling. De huidige afwijzing ontstaat doordat algemene trefwoordchecks ook
op analyse-uitvoer worden toegepast. De aanbevolen vervolgstap is om analyse en
bouw afzonderlijk te beoordelen en de genoemde repositorypaden als herleidbare
bronverwijzingen te bewaren.
`;

test("accepts grounded analysis without artificial assumptions or verification headings", () => {
  const evaluation = new AutonomousOutputEvaluator().evaluate(
    "mission-1",
    execution("mission-1", groundedAnalysis),
    { objectiveExecutionMode: "analysis-only", objectiveProfile: "generic-analysis" },
  );

  assert.equal(evaluation.decision, "accepted");
  assert.equal(evaluation.score, 100);
  assert.equal(
    evaluation.checks.some((check) => check.id === "assumptions-explicit"),
    false,
  );
  assert.equal(
    evaluation.checks.some((check) => check.id === "verification-explicit"),
    false,
  );
  assert.equal(
    evaluation.checks.find((check) => check.id === "analysis-grounded")?.passed,
    true,
  );
});

test("rejects ungrounded analysis", () => {
  const output = "Deze analyse bevat een uitgebreide algemene beschouwing zonder herleidbare repositorylocatie, bronvermelding of concrete codeverwijzing. ".repeat(3);
  const evaluation = new AutonomousOutputEvaluator().evaluate(
    "mission-2",
    execution("mission-2", output),
    { objectiveExecutionMode: "analysis-only", objectiveProfile: "generic-analysis" },
  );

  assert.equal(evaluation.decision, "rejected");
  assert.equal(
    evaluation.checks.find((check) => check.id === "analysis-grounded")?.passed,
    false,
  );
});

test("build evaluation still requires assumptions, verification, and execution evidence", () => {
  const evidence: AutonomousExecutionEvidence = {
    objectiveProfile: "generic-build",
    receipts: [
      {
        id: "receipt-1",
        action: "write-file",
        targetPath: "sandbox/example.ts",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        ok: true,
        error: null,
      },
    ],
    fileEffects: [
      {
        path: "sandbox/example.ts",
        existedBefore: false,
        existsAfter: true,
        beforeSha256: null,
        afterSha256: "a".repeat(64),
      },
    ],
    verificationRuns: [],
    artifacts: [
      {
        id: "artifact-1",
        kind: "file-hash-proof",
        path: "sandbox/example.ts",
        content: "example",
        sha256: "a".repeat(64),
      },
    ],
  };
  const output = "De module is toegevoegd en de uitvoer bevat voldoende inhoud om als substantieel te gelden, maar vermeldt bewust geen aparte koppen voor de twee verplichte bouwvoorwaarden. ".repeat(2);
  const evaluation = new AutonomousOutputEvaluator().evaluate(
    "mission-3",
    execution("mission-3", output),
    {
      objectiveExecutionMode: "build-or-mutate",
      objectiveProfile: "generic-build",
      executionEvidence: evidence,
    },
  );

  assert.equal(evaluation.decision, "rejected");
  assert.equal(
    evaluation.checks.find((check) => check.id === "assumptions-explicit")?.passed,
    false,
  );
  assert.equal(
    evaluation.checks.find((check) => check.id === "verification-explicit")?.passed,
    false,
  );
});

test("generic build checks the validated workspace plan assumptions field", () => {
  const now = new Date().toISOString();
  const evidence: AutonomousExecutionEvidence = {
    objectiveProfile: "generic-build",
    receipts: [{
      id: "receipt-structured-assumptions",
      action: "write-file",
      targetPath: "sandbox/example.ts",
      startedAt: now,
      completedAt: now,
      durationMs: 1,
      ok: true,
      error: null,
    }],
    fileEffects: [{
      path: "sandbox/example.ts",
      existedBefore: false,
      existsAfter: true,
      beforeSha256: null,
      afterSha256: "a".repeat(64),
    }],
    verificationRuns: [],
    artifacts: [{
      id: "artifact-structured-assumptions",
      kind: "file-hash-proof",
      path: "sandbox/example.ts",
      content: "example",
      sha256: "a".repeat(64),
    }],
  };
  const output = (
    "Assumptions in free text must not provide authority. Verification completed with persisted receipts, file effects, and artifact evidence. "
  ).repeat(2);
  const evaluator = new AutonomousOutputEvaluator();
  const options = {
    objectiveExecutionMode: "build-or-mutate" as const,
    objectiveProfile: "generic-build" as const,
    executionEvidence: evidence,
  };

  const withField = evaluator.evaluate(
    "mission-structured-assumptions",
    execution("mission-structured-assumptions", output),
    { ...options, workspacePlanAssumptions: [] },
  );
  assert.equal(withField.decision, "accepted");
  assert.equal(
    withField.checks.find((check) => check.id === "assumptions-explicit")?.passed,
    true,
  );

  const withoutField = evaluator.evaluate(
    "mission-structured-assumptions",
    execution("mission-structured-assumptions", output),
    options,
  );
  assert.equal(withoutField.decision, "rejected");
  assert.equal(
    withoutField.checks.find((check) => check.id === "assumptions-explicit")?.passed,
    false,
  );
});