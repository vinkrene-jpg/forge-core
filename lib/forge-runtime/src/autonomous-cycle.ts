import { randomUUID } from "node:crypto";
import type { AiExecutionRecord } from "./ai-gateway";

export type AutonomousObjectiveExecutionMode =
  | "analysis-only"
  | "build-or-mutate";

export type AutonomousObjectiveProfile =
  | "generic-analysis"
  | "generic-build"
  | "file-create-read-hash";

export interface AutonomousActionReceipt {
  readonly id: string;
  readonly action: "write-file" | "read-file" | "compute-sha256" | "verify-file-exists";
  readonly targetPath: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly error: string | null;
}

export interface AutonomousFileEffect {
  readonly path: string;
  readonly existedBefore: boolean;
  readonly existsAfter: boolean;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
}

export interface AutonomousVerificationRun {
  readonly command: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly durationMs: number;
}

export interface AutonomousArtifactEvidence {
  readonly id: string;
  readonly kind: "file-hash-proof";
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
}

export interface AutonomousExecutionEvidence {
  readonly objectiveProfile: AutonomousObjectiveProfile;
  readonly receipts: readonly AutonomousActionReceipt[];
  readonly fileEffects: readonly AutonomousFileEffect[];
  readonly verificationRuns: readonly AutonomousVerificationRun[];
  readonly artifacts: readonly AutonomousArtifactEvidence[];
}

export interface AutonomousCycleInput {
  readonly projectId: string;
  readonly objective: string;
  readonly objectiveExecutionMode: AutonomousObjectiveExecutionMode;
  readonly objectiveProfile: AutonomousObjectiveProfile;
  readonly cycleIndex: number;
  readonly maxCycles: number;
  readonly rootMissionId: string | null;
  readonly previousMissionId: string | null;
  readonly continuationAuthorized: boolean;
  readonly files: readonly string[];
}

export interface AutonomousEvaluationCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface AutonomousEvaluation {
  readonly id: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly score: number;
  readonly decision: "accepted" | "rejected";
  readonly checks: readonly AutonomousEvaluationCheck[];
  readonly evaluatedAt: string;
}

function textInput(
  input: Readonly<Record<string, unknown>>,
  field: string,
  fallback?: string,
): string {
  const value = input[field] ?? fallback;

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value.trim();
}

function optionalText(
  input: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = input[field];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }

  return value.trim() || null;
}

function boundedInteger(
  input: Readonly<Record<string, unknown>>,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = input[field] ?? fallback;

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

export function classifyAutonomousObjective(
  objective: string,
): {
  readonly mode: AutonomousObjectiveExecutionMode;
  readonly profile: AutonomousObjectiveProfile;
} {
  const normalized = objective.toLowerCase();
  const hasProofTextFile = /\b[a-z0-9._-]*proof[a-z0-9._-]*\.txt\b/i.test(normalized);
  const hasHash =
    normalized.includes("sha-256") ||
    normalized.includes("sha256") ||
    normalized.includes("hash");
  const hasReadback =
    normalized.includes("lees") ||
    normalized.includes("read");

  if (hasProofTextFile && hasHash && hasReadback) {
    return Object.freeze({
      mode: "build-or-mutate" as const,
      profile: "file-create-read-hash" as const,
    });
  }

  const buildIndicators = [
    "bouw ",
    " maak ",
    "create ",
    "write ",
    "bestand",
    "file",
    "build",
    "compile",
    "wijzig",
    "modify",
    "implement code",
  ];
  const buildLikely = buildIndicators.some((token) => normalized.includes(token));

  if (buildLikely) {
    return Object.freeze({
      mode: "build-or-mutate" as const,
      profile: "generic-build" as const,
    });
  }

  return Object.freeze({
    mode: "analysis-only" as const,
    profile: "generic-analysis" as const,
  });
}

export function parseAutonomousCycleInput(
  input: Readonly<Record<string, unknown>>,
): AutonomousCycleInput {
  const cycleIndex = boundedInteger(input, "cycleIndex", 1, 1, 5);
  const maxCycles = boundedInteger(input, "maxCycles", 2, 1, 5);

  if (cycleIndex > maxCycles) {
    throw new Error("cycleIndex cannot exceed maxCycles");
  }

  const rawFiles = input.files ?? [];

  if (!Array.isArray(rawFiles)) {
    throw new Error("files must be an array");
  }

  const files = rawFiles
    .map((file) => {
      if (typeof file !== "string" || file.trim().length === 0) {
        throw new Error("files must contain non-empty strings");
      }

      return file.trim();
    })
    .slice(0, 8);

  const objective = textInput(input, "objective");
  const classified = classifyAutonomousObjective(objective);

  return Object.freeze({
    projectId: textInput(input, "projectId", "forge-core"),
    objective,
    objectiveExecutionMode: classified.mode,
    objectiveProfile: classified.profile,
    cycleIndex,
    maxCycles,
    rootMissionId: optionalText(input, "rootMissionId"),
    previousMissionId: optionalText(input, "previousMissionId"),
    continuationAuthorized: input.continuationAuthorized === true,
    files: Object.freeze(files),
  });
}

const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /OPENAI_API_KEY\s*=/i,
  /AZURE_CLIENT_SECRET\s*=/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export class AutonomousOutputEvaluator {
  evaluate(
    missionId: string,
    execution: AiExecutionRecord,
    options: {
      readonly requiredEvidenceId?: string | null;
      readonly executionEvidence?: AutonomousExecutionEvidence | null;
      readonly objectiveExecutionMode?: AutonomousObjectiveExecutionMode;
      readonly objectiveProfile?: AutonomousObjectiveProfile;
    } = {},
  ): AutonomousEvaluation {
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
      const evidence = options.executionEvidence ?? null;
      const hasReceipts = (evidence?.receipts.length ?? 0) > 0;
      const hasArtifacts = (evidence?.artifacts.length ?? 0) > 0;
      const hasFileEffects = (evidence?.fileEffects.length ?? 0) > 0;

      checks.push(
        {
          id: "build-provider-capable",
          passed: execution.providerId !== "manual-fallback",
          detail:
            execution.providerId === "manual-fallback"
              ? "Build/mutate objective may not be accepted on manual-fallback."
              : `Provider route: ${execution.providerId}`,
        },
        {
          id: "execution-evidence-present",
          passed: hasReceipts,
          detail: `Action receipts: ${evidence?.receipts.length ?? 0}`,
        },
        {
          id: "file-effects-present",
          passed: hasFileEffects,
          detail: `File effects: ${evidence?.fileEffects.length ?? 0}`,
        },
        {
          id: "artifact-evidence-present",
          passed: hasArtifacts,
          detail: `Artifacts: ${evidence?.artifacts.length ?? 0}`,
        },
      );

      if (options.objectiveProfile === "file-create-read-hash") {
        const proof = evidence?.artifacts.find(
          (artifact) => artifact.kind === "file-hash-proof",
        );
        checks.push({
          id: "file-hash-proof-complete",
          passed:
            typeof proof?.path === "string" &&
            proof.path.length > 0 &&
            typeof proof.content === "string" &&
            proof.content.length > 0 &&
            /^[a-f0-9]{64}$/.test(proof?.sha256 ?? ""),
          detail: proof
            ? `Proof file: ${proof.path}`
            : "Missing file-hash-proof artifact.",
        });
      }
    }

    if (options.requiredEvidenceId) {
      checks.push(
        {
          id: "tool-evidence-cited",
          passed: output.includes(options.requiredEvidenceId),
          detail: `Output must cite evidence ${options.requiredEvidenceId}.`,
        },
        {
          id: "capability-result-explicit",
          passed: /CAPABILITY_RESULT:\s*(?:PASS|GAP)\b/i.test(output),
          detail: "Output must declare CAPABILITY_RESULT: PASS or GAP.",
        },
      );
    }

    const passed = checks.filter((check) => check.passed).length;
    const score = Math.round((passed / checks.length) * 100);

    return Object.freeze({
      id: randomUUID(),
      missionId,
      executionId: execution.id,
      score,
      decision: checks.every((check) => check.passed) ? "accepted" : "rejected",
      checks: Object.freeze(checks.map((check) => Object.freeze(check))),
      evaluatedAt: new Date().toISOString(),
    });
  }
}

export function parseCapabilityResult(
  output: string,
): "pass" | "gap" | null {
  const match = /CAPABILITY_RESULT:\s*(PASS|GAP)\b/i.exec(output);

  if (!match) {
    return null;
  }

  return match[1].toUpperCase() === "PASS" ? "pass" : "gap";
}
