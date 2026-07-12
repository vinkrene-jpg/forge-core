import { randomUUID } from "node:crypto";
import type { AiExecutionRecord } from "./ai-gateway";

export interface AutonomousCycleInput {
  readonly projectId: string;
  readonly objective: string;
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

  return Object.freeze({
    projectId: textInput(input, "projectId", "forge-core"),
    objective: textInput(input, "objective"),
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
    } = {},
  ): AutonomousEvaluation {
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
