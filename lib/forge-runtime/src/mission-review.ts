// Mission review: deterministic Guardian review and Governor decision that
// close the Claude Mirror mission chain. These run inside the mission flow
// (MissionEngine.complete) and persist their verdict onto the mission output,
// so the deterministic Mirror projection can emit `guardian_reviewed` and
// `governor_released` / `governor_blocked` from authoritative data only.
//
// Step 1 keeps this rule-based and portable (no external providers, no
// platform lock-in). Step 2 will graft real specialised AI roles onto the
// same persisted shape without changing the projection contract.

import { createHash } from "node:crypto";

export type MissionGuardianOutcome =
  | "approved"
  | "changes_requested"
  | "blocked";

export type MissionGovernorVerdict = "released" | "blocked";

export type MissionReviewSeverity = "info" | "warning" | "critical";

// "rules" = deterministic rule-based review only (step 1). "rules+ai" = the
// rule-based review combined with a specialised AI Guardian verdict (step 2),
// where the AI can only make the outcome stricter, never milder.
export type MissionReviewBasis = "rules" | "rules+ai";

export interface MissionGuardianFinding {
  readonly severity: MissionReviewSeverity;
  readonly code: string;
  readonly message: string;
}

export interface MissionGuardianReview {
  readonly id: string;
  readonly reviewer: "guardian";
  readonly outcome: MissionGuardianOutcome;
  readonly summary: string;
  readonly findings: readonly MissionGuardianFinding[];
  readonly evidenceReference: string;
  readonly basis: MissionReviewBasis;
  readonly model: string | null;
  readonly reviewedAt: string;
}

export interface MissionGuardianAiVerdict {
  readonly outcome: MissionGuardianOutcome;
  readonly summary: string;
  readonly findings: readonly MissionGuardianFinding[];
}

export interface MissionGovernorDecision {
  readonly id: string;
  readonly authority: "governor";
  readonly decision: MissionGovernorVerdict;
  readonly rationale: string;
  readonly guardianReviewId: string;
  readonly guardianOutcome: MissionGuardianOutcome;
  readonly decidedAt: string;
}

export interface MissionReview {
  readonly guardianReview: MissionGuardianReview;
  readonly governorDecision: MissionGovernorDecision;
}

function record(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<Readonly<Record<string, unknown>>[]>((items, item) => {
    const candidate = record(item);
    if (candidate) items.push(candidate);
    return items;
  }, []);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function deterministicId(
  prefix: string,
  missionId: string,
  reviewedAt: string,
  discriminator: string,
): string {
  return `${prefix}-${createHash("sha256")
    .update([missionId, prefix, reviewedAt, discriminator].join("\0"))
    .digest("hex")
    .slice(0, 32)}`;
}

/**
 * Rule-based Guardian review over the already-persisted execution evidence and
 * evaluation. It never invents evidence: its verdict is derived only from what
 * the mission output already contains. The outcome can only be as strict as the
 * evidence allows — a hard failure blocks, otherwise the mission is approved.
 */
export function deriveMissionGuardianReview(
  missionId: string,
  output: Readonly<Record<string, unknown>>,
  reviewedAt: string,
): MissionGuardianReview {
  const findings: MissionGuardianFinding[] = [];

  const evaluation = record(output.evaluation);
  const executionEvidence = record(output.executionEvidence);
  const evaluationDecision = evaluation ? text(evaluation.decision) : null;

  if (evaluation && evaluationDecision !== null && evaluationDecision !== "accepted") {
    findings.push({
      severity: "critical",
      code: "evaluation_rejected",
      message: `Evaluation ${text(evaluation.id) ?? "unknown"} decision was ${evaluationDecision}.`,
    });
  }

  let verificationRuns = 0;
  let artifactCount = 0;
  if (executionEvidence) {
    const runs = records(executionEvidence.verificationRuns);
    verificationRuns = runs.length;
    const failedRuns = runs.filter((run) => run.exitCode !== 0);
    if (failedRuns.length > 0) {
      findings.push({
        severity: "critical",
        code: "verification_failed",
        message: `${failedRuns.length} verification run(s) exited non-zero.`,
      });
    }

    const failedReceipts = records(executionEvidence.receipts).filter(
      (receipt) => receipt.ok !== true,
    );
    if (failedReceipts.length > 0) {
      findings.push({
        severity: "critical",
        code: "receipt_failed",
        message: `${failedReceipts.length} execution receipt(s) reported failure.`,
      });
    }

    artifactCount = records(executionEvidence.artifacts).length;
  }

  const hasCritical = findings.some((finding) => finding.severity === "critical");
  const hasWarning = findings.some((finding) => finding.severity === "warning");
  const outcome: MissionGuardianOutcome = hasCritical
    ? "blocked"
    : hasWarning
      ? "changes_requested"
      : "approved";

  const summary =
    outcome === "approved"
      ? `Guardian approved the mission: evaluation ${
          evaluationDecision ?? "not required"
        }, ${verificationRuns} verification run(s), ${artifactCount} artifact(s).`
      : outcome === "blocked"
        ? `Guardian blocked the mission: ${findings
            .filter((finding) => finding.severity === "critical")
            .map((finding) => finding.message)
            .join(" ")}`
        : `Guardian requested changes: ${findings
            .map((finding) => finding.message)
            .join(" ")}`;

  return Object.freeze({
    id: deterministicId("guardian", missionId, reviewedAt, outcome),
    reviewer: "guardian",
    outcome,
    summary,
    findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
    evidenceReference: executionEvidence
      ? "mission.output.executionEvidence"
      : evaluation
        ? "mission.output.evaluation"
        : "mission.output",
    basis: "rules",
    model: null,
    reviewedAt,
  });
}

const GUARDIAN_OUTCOME_RANK: Readonly<Record<MissionGuardianOutcome, number>> =
  Object.freeze({ approved: 0, changes_requested: 1, blocked: 2 });

const GUARDIAN_AI_CATEGORIES: readonly string[] = Object.freeze([
  "architecture",
  "security",
  "correctness",
  "regression_risk",
  "evidence_quality",
  "maintainability",
  "other",
]);

/**
 * Instructions for the specialised AI Guardian role. The model reviews the
 * persisted evidence of a completed mission and returns a strict JSON verdict.
 * It is explicitly told it can only tighten the rule-based outcome.
 */
export const GUARDIAN_AI_INSTRUCTIONS =
  `You are the AI Guardian of Forge Core: an independent reviewer of a completed mission's evidence.\n` +
  `Review the mission below and judge whether its result may be released. Assess correctness, security,\n` +
  `regression risk, architecture impact and the quality/completeness of the execution evidence.\n\n` +
  `Respond with ONLY a JSON object, no prose, in exactly this shape:\n` +
  `{"outcome":"approved|changes_requested|blocked","summary":"<max 3 sentences>","findings":[{"severity":"info|warning|critical","category":"architecture|security|correctness|regression_risk|evidence_quality|maintainability|other","message":"<specific finding>"}]}\n\n` +
  `Rules: "blocked" only for critical problems that must stop release. "changes_requested" when a human should review first.\n` +
  `"approved" only when there are no significant concerns. When uncertain, prefer "changes_requested".`;

/**
 * Builds a compact, deterministic context block describing the mission and its
 * persisted evidence for the AI Guardian prompt.
 */
export function buildGuardianReviewContext(
  title: string,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
  rulesReview: MissionGuardianReview,
): string {
  const evaluation = record(output.evaluation);
  const executionEvidence = record(output.executionEvidence);
  const lines: string[] = [];
  lines.push(`MISSION: ${title}`);
  lines.push(`OBJECTIVE: ${text(input.objective) ?? text(input.rawObjective) ?? "-"}`);
  lines.push(
    `RULE-BASED GUARDIAN: outcome=${rulesReview.outcome}; ${rulesReview.summary}`,
  );
  if (evaluation) {
    lines.push(
      `EVALUATION: decision=${text(evaluation.decision) ?? "unknown"}, score=${
        typeof evaluation.score === "number" ? evaluation.score : "n/a"
      }`,
    );
    const failedChecks = records(evaluation.checks).filter(
      (check) => check.passed === false,
    );
    if (failedChecks.length > 0) {
      lines.push(
        `FAILED CHECKS: ${failedChecks
          .map((check) => text(check.id) ?? "unknown")
          .join(", ")}`,
      );
    }
  } else {
    lines.push("EVALUATION: none");
  }
  if (executionEvidence) {
    const runs = records(executionEvidence.verificationRuns);
    lines.push(
      `EVIDENCE: ${records(executionEvidence.artifacts).length} artifact(s), ${
        records(executionEvidence.receipts).length
      } receipt(s), ${runs.length} verification run(s); ` +
        `exit codes: ${runs.map((run) => String(run.exitCode ?? "n/a")).join(",") || "none"}`,
    );
  } else {
    lines.push("EVIDENCE: none");
  }
  return lines.join("\n");
}

/**
 * Defensively parses the AI Guardian's JSON verdict. Any parsing problem is
 * treated as "changes_requested" (owner review), never as a silent pass.
 */
export function parseGuardianAiVerdict(
  outputText: string,
): MissionGuardianAiVerdict {
  const fallback: MissionGuardianAiVerdict = Object.freeze({
    outcome: "changes_requested",
    summary: "AI Guardian response could not be parsed; treated as changes_requested.",
    findings: Object.freeze([
      Object.freeze({
        severity: "warning" as const,
        code: "review_quality",
        message: "AI Guardian returned an unparseable verdict. Manual review recommended.",
      }),
    ]),
  });

  const start = outputText.indexOf("{");
  const end = outputText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText.slice(start, end + 1));
  } catch {
    return fallback;
  }

  const verdict = record(parsed);
  if (!verdict) return fallback;

  const rawOutcome = text(verdict.outcome);
  const outcome: MissionGuardianOutcome =
    rawOutcome === "approved" || rawOutcome === "changes_requested" || rawOutcome === "blocked"
      ? rawOutcome
      : "changes_requested";

  const findings: MissionGuardianFinding[] = records(verdict.findings)
    .slice(0, 30)
    .map((finding) => {
      const severity = text(finding.severity);
      const category = text(finding.category);
      return Object.freeze({
        severity:
          severity === "info" || severity === "warning" || severity === "critical"
            ? severity
            : "warning",
        code: category && GUARDIAN_AI_CATEGORIES.includes(category) ? category : "other",
        message: (text(finding.message) ?? "Unspecified AI finding").slice(0, 500),
      });
    });

  return Object.freeze({
    outcome,
    summary: (text(verdict.summary) ?? "").slice(0, 2_000),
    findings: Object.freeze(findings),
  });
}

function stricterOutcome(
  a: MissionGuardianOutcome,
  b: MissionGuardianOutcome,
): MissionGuardianOutcome {
  return GUARDIAN_OUTCOME_RANK[a] >= GUARDIAN_OUTCOME_RANK[b] ? a : b;
}

/**
 * Combines the deterministic rule-based review with the AI Guardian verdict.
 * The combined outcome is the stricter of the two — an AI "approved" can never
 * override a rules "blocked", exactly like the Locked Core module reviewer.
 */
export function combineGuardianReview(
  missionId: string,
  rulesReview: MissionGuardianReview,
  aiVerdict: MissionGuardianAiVerdict,
  model: string | null,
  reviewedAt: string,
): MissionGuardianReview {
  const outcome = stricterOutcome(rulesReview.outcome, aiVerdict.outcome);
  const findings: MissionGuardianFinding[] = [
    ...rulesReview.findings.map((finding) =>
      Object.freeze({ ...finding, message: `[rules] ${finding.message}` }),
    ),
    ...aiVerdict.findings.map((finding) =>
      Object.freeze({ ...finding, message: `[ai] ${finding.message}` }),
    ),
  ];
  const summary =
    `Combined Guardian review (outcome ${outcome}; rules ${rulesReview.outcome}, ai ${aiVerdict.outcome}). ` +
    (aiVerdict.summary || rulesReview.summary);

  return Object.freeze({
    id: deterministicId("guardian", missionId, reviewedAt, `rules+ai:${outcome}`),
    reviewer: "guardian",
    outcome,
    summary: summary.slice(0, 2_400),
    findings: Object.freeze(findings),
    evidenceReference: rulesReview.evidenceReference,
    basis: "rules+ai",
    model,
    reviewedAt,
  });
}

/**
 * Governor decision layer. Governor never releases a mission that Guardian did
 * not approve: the release is derived solely from the Guardian outcome, so the
 * chain bewijs -> guardian_reviewed -> governor_released -> result_published can
 * only close when the review is clean.
 */
export function deriveMissionGovernorDecision(
  missionId: string,
  guardianReview: MissionGuardianReview,
  decidedAt: string,
): MissionGovernorDecision {
  const released = guardianReview.outcome === "approved";
  const decision: MissionGovernorVerdict = released ? "released" : "blocked";
  const rationale = released
    ? `Governor released the mission: Guardian review ${guardianReview.id} approved with no blocking findings.`
    : `Governor blocked the mission: Guardian review ${guardianReview.id} returned outcome '${guardianReview.outcome}'.`;

  return Object.freeze({
    id: deterministicId("governor", missionId, decidedAt, decision),
    authority: "governor",
    decision,
    rationale,
    guardianReviewId: guardianReview.id,
    guardianOutcome: guardianReview.outcome,
    decidedAt,
  });
}

/**
 * Convenience helper that runs the full Guardian -> Governor phase for a
 * completed mission output at a single, persisted point in time.
 */
export function deriveMissionReview(
  missionId: string,
  output: Readonly<Record<string, unknown>>,
  reviewedAt: string,
): MissionReview {
  const guardianReview = deriveMissionGuardianReview(
    missionId,
    output,
    reviewedAt,
  );
  const governorDecision = deriveMissionGovernorDecision(
    missionId,
    guardianReview,
    reviewedAt,
  );
  return Object.freeze({ guardianReview, governorDecision });
}
