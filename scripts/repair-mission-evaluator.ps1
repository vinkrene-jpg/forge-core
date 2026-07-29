$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo

$branch = (git branch --show-current).Trim()
if ($branch -ne "forge-mission-reliability") {
    throw "Verkeerde branch: $branch. Verwacht forge-mission-reliability."
}

$sourcePath = Join-Path $repo "lib/forge-runtime/src/autonomous-cycle.ts"
$testPath = Join-Path $repo "lib/forge-runtime/src/autonomous-output-evaluator.test.ts"

$source = [System.IO.File]::ReadAllText($sourcePath)

$oldBlock = @'
    const output = execution.outputText ?? "";
    const checks: AutonomousEvaluationCheck[] = [
      {
        id: "provider-succeeded",
        passed: execution.status === "succeeded",
        detail: `Provider status: ${execution.status}`,
      },
      {
        id: "mission-linked",
        passed: execution.missionId === missionId,
        detail: `Execution mission: ${execution.missionId ?? "none"}`,
      },
      {
        id: "output-substantive",
        passed: output.trim().length >= 200,
        detail: `Output characters: ${output.trim().length}`,
      },
      {
        id: "assumptions-explicit",
        passed: /assumptions?|aannames?/i.test(output),
        detail: "Output must state assumptions explicitly.",
      },
      {
        id: "verification-explicit",
        passed: /verif|tests?|controle|bewijs/i.test(output),
        detail: "Output must contain verification guidance.",
      },
      {
        id: "secret-free",
        passed: !secretPatterns.some((pattern) => pattern.test(output)),
        detail: "Output must not contain credential-shaped material.",
      },
    ];

    if (options.objectiveExecutionMode === "build-or-mutate") {
'@

$newBlock = @'
    const output = execution.outputText ?? "";
    const executionMode = options.objectiveExecutionMode ?? "analysis-only";
    const checks: AutonomousEvaluationCheck[] = [
      {
        id: "provider-succeeded",
        passed: execution.status === "succeeded",
        detail: `Provider status: ${execution.status}`,
      },
      {
        id: "mission-linked",
        passed: execution.missionId === missionId,
        detail: `Execution mission: ${execution.missionId ?? "none"}`,
      },
      {
        id: "output-substantive",
        passed: output.trim().length >= 200,
        detail: `Output characters: ${output.trim().length}`,
      },
      {
        id: "secret-free",
        passed: !secretPatterns.some((pattern) => pattern.test(output)),
        detail: "Output must not contain credential-shaped material.",
      },
    ];

    if (executionMode === "analysis-only") {
      const groundedReference =
        /(?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._-]+|(?:^|\s)(?:bron|bronnen|evidence|source|bestand|file|regel|line|codeverwijzing|code reference)(?:\s|:|$)/im;
      checks.push({
        id: "analysis-grounded",
        passed: groundedReference.test(output),
        detail: "Analysis output must cite a source, file, line, code reference, or repository path.",
      });
    }

    if (executionMode === "build-or-mutate") {
      checks.push(
        {
          id: "assumptions-explicit",
          passed: /assumptions?|aannames?/i.test(output),
          detail: "Build output must state assumptions explicitly.",
        },
        {
          id: "verification-explicit",
          passed: /verif|tests?|controle|bewijs/i.test(output),
          detail: "Build output must contain verification guidance.",
        },
      );
'@

if (-not $source.Contains($oldBlock)) {
    throw "Verwacht evaluatorblok niet gevonden; er is niets gewijzigd."
}

$updated = $source.Replace($oldBlock, $newBlock)
[System.IO.File]::WriteAllText($sourcePath, $updated, [System.Text.UTF8Encoding]::new($false))

$testContent = @'
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
'@

[System.IO.File]::WriteAllText($testPath, $testContent, [System.Text.UTF8Encoding]::new($false))

pnpm.cmd --filter @workspace/forge-runtime test -- autonomous-output-evaluator.test.ts
if ($LASTEXITCODE -ne 0) {
    throw "Evaluator-tests zijn mislukt; commit is niet gemaakt."
}

pnpm.cmd --filter @workspace/forge-runtime typecheck
if ($LASTEXITCODE -ne 0) {
    throw "Typecheck is mislukt; commit is niet gemaakt."
}

git add -- $sourcePath $testPath
git commit -m "fix(runtime): evaluate analysis and build outputs separately"
if ($LASTEXITCODE -ne 0) {
    throw "Git-commit is mislukt."
}

Write-Host "RESULTAAT: GESLAAGD" -ForegroundColor Green
Write-Host "Evaluator is mode-specifiek gemaakt, tests en typecheck zijn groen en de wijziging is gecommit." -ForegroundColor Green
