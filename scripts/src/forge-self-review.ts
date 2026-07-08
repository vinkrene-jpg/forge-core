// Forge Self-Upgrade Loop — analysis runner.
//
// Reads the machine-readable upgrade backlog (config/forge-upgrades.json),
// analyzes the current codebase against each goal using read-only evidence
// checks, and writes a markdown report to reports/forge-self-review.md.
//
// Hard guarantees (owner gate):
// - READ-ONLY analysis: never modifies source code.
// - Never runs git, never commits, never deploys.
// - Never touches .env, secrets, VPS or production configuration.
// - Only writes the report file inside reports/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

export interface EvidencePattern {
  file: string;
  contains: string;
}

export interface UpgradeGoal {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  risk: "low" | "medium" | "high";
  status: string;
  acceptanceCriteria: string[];
  testRequirements: string[];
  ownerApprovalRequired: boolean;
  evidence?: {
    filesExist?: string[];
    patterns?: EvidencePattern[];
  };
}

export interface UpgradeBacklog {
  version: number;
  description: string;
  upgrades: UpgradeGoal[];
}

const REQUIRED_FIELDS: (keyof UpgradeGoal)[] = [
  "id",
  "title",
  "description",
  "priority",
  "risk",
  "status",
  "acceptanceCriteria",
  "testRequirements",
  "ownerApprovalRequired",
];

export class BacklogValidationError extends Error {}

export function parseBacklog(raw: string): UpgradeBacklog {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new BacklogValidationError(`Backlog is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const backlog = data as Partial<UpgradeBacklog>;
  if (!Array.isArray(backlog.upgrades) || backlog.upgrades.length === 0) {
    throw new BacklogValidationError("Backlog must contain a non-empty 'upgrades' array.");
  }
  for (const [i, goal] of backlog.upgrades.entries()) {
    for (const field of REQUIRED_FIELDS) {
      const value = (goal as unknown as Record<string, unknown>)[field];
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
        throw new BacklogValidationError(`Upgrade #${i + 1} (${goal.id ?? "no id"}) is missing mandatory field '${field}'.`);
      }
    }
    if (!Array.isArray(goal.acceptanceCriteria) || goal.acceptanceCriteria.length === 0) {
      throw new BacklogValidationError(`Upgrade ${goal.id}: 'acceptanceCriteria' must be a non-empty array.`);
    }
    if (!Array.isArray(goal.testRequirements) || goal.testRequirements.length === 0) {
      throw new BacklogValidationError(`Upgrade ${goal.id}: 'testRequirements' must be a non-empty array.`);
    }
  }
  return backlog as UpgradeBacklog;
}

export interface GoalAnalysis {
  goal: UpgradeGoal;
  currentStatus: "implemented" | "partial" | "missing";
  missingParts: string[];
  presentParts: string[];
  proposedChange: string;
}

const SECRET_FILE_DENYLIST = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|.*secret.*|.*credential.*)$/i;

function safeResolve(rel: string): string {
  if (SECRET_FILE_DENYLIST.test(rel)) {
    throw new BacklogValidationError(`Evidence path refers to a secret/credential file and is not allowed: ${rel}`);
  }
  const abs = path.resolve(repoRoot, rel);
  if (!abs.startsWith(repoRoot + path.sep)) {
    throw new BacklogValidationError(`Evidence path escapes the repository: ${rel}`);
  }
  // Resolve symlinks so a link inside the repo cannot point outside of it.
  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(repoRoot);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new BacklogValidationError(`Evidence path resolves outside the repository via symlink: ${rel}`);
    }
    if (SECRET_FILE_DENYLIST.test(real)) {
      throw new BacklogValidationError(`Evidence path resolves to a secret/credential file: ${rel}`);
    }
  }
  return abs;
}

export function analyzeGoal(goal: UpgradeGoal, root: string = repoRoot): GoalAnalysis {
  const missingParts: string[] = [];
  const presentParts: string[] = [];

  for (const rel of goal.evidence?.filesExist ?? []) {
    const abs = safeResolve(rel);
    if (fs.existsSync(abs)) presentParts.push(`file exists: ${rel}`);
    else missingParts.push(`missing file: ${rel}`);
  }
  for (const p of goal.evidence?.patterns ?? []) {
    const abs = safeResolve(p.file);
    if (!fs.existsSync(abs)) {
      missingParts.push(`missing file for pattern check: ${p.file}`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    if (content.includes(p.contains)) presentParts.push(`'${p.contains}' found in ${p.file}`);
    else missingParts.push(`'${p.contains}' not found in ${p.file}`);
  }

  const total = presentParts.length + missingParts.length;
  const currentStatus: GoalAnalysis["currentStatus"] =
    total === 0 || missingParts.length === total ? "missing" : missingParts.length === 0 ? "implemented" : "partial";

  const proposedChange =
    currentStatus === "implemented"
      ? "No change needed; keep acceptance criteria covered by the listed tests."
      : `Implement the missing parts (${missingParts.join("; ")}) via the normal governance pipeline (proposal → test → Guardian → Governor → owner approval).`;

  return { goal, currentStatus, missingParts, presentParts, proposedChange };
}

export function renderReport(analyses: GoalAnalysis[], generatedAt: string): string {
  const lines: string[] = [
    "# Forge Self-Review Report",
    "",
    `Generated: ${generatedAt}`,
    "",
    "> Read-only analysis by the Forge Self-Upgrade Loop (`pnpm forge:self-review`).",
    "> This workflow only proposes changes. It never modifies code, never commits,",
    "> never deploys and never touches .env, secrets, VPS or production settings.",
    "",
    `Goals analyzed: ${analyses.length} — implemented: ${analyses.filter((a) => a.currentStatus === "implemented").length}, partial: ${analyses.filter((a) => a.currentStatus === "partial").length}, missing: ${analyses.filter((a) => a.currentStatus === "missing").length}`,
    "",
  ];
  for (const a of analyses) {
    lines.push(
      `## ${a.goal.id} — ${a.goal.title}`,
      "",
      a.goal.description,
      "",
      `- **Current status:** ${a.currentStatus}`,
      `- **Missing parts:** ${a.missingParts.length > 0 ? "" : "none"}`,
      ...a.missingParts.map((m) => `  - ${m}`),
      `- **Evidence present:** ${a.presentParts.length > 0 ? "" : "none"}`,
      ...a.presentParts.map((p) => `  - ${p}`),
      `- **Proposed change:** ${a.proposedChange}`,
      `- **Risk:** ${a.goal.risk}`,
      `- **Required tests:**`,
      ...a.goal.testRequirements.map((t) => `  - ${t}`),
      `- **Owner approval required:** ${a.goal.ownerApprovalRequired ? "yes" : "no"}`,
      "",
    );
  }
  lines.push("---", "", "_No automatic changes were made. All proposals require the normal governance pipeline and, where marked, explicit owner approval._", "");
  return lines.join("\n");
}

function assertReportPathConfined(reportPath: string): string {
  const reportsDir = path.resolve(repoRoot, "reports");
  const resolved = path.resolve(reportPath);
  if (!resolved.startsWith(reportsDir + path.sep)) {
    throw new BacklogValidationError(`Report path must be inside ${reportsDir}: ${reportPath}`);
  }
  fs.mkdirSync(reportsDir, { recursive: true });
  // Resolve symlinks on every existing ancestor so a link inside reports/
  // cannot redirect the write outside the repository.
  const realReportsDir = fs.realpathSync(reportsDir);
  let probe = path.dirname(resolved);
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realReportsDir && !realProbe.startsWith(realReportsDir + path.sep)) {
    throw new BacklogValidationError(`Report path resolves outside reports/ via symlink: ${reportPath}`);
  }
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(realReportsDir + path.sep)) {
      throw new BacklogValidationError(`Report file resolves outside reports/ via symlink: ${reportPath}`);
    }
  }
  return resolved;
}

export function runSelfReview(backlogPath: string, reportPath: string): { report: string; analyses: GoalAnalysis[] } {
  const confined = assertReportPathConfined(reportPath);
  const raw = fs.readFileSync(backlogPath, "utf8");
  const backlog = parseBacklog(raw);
  const analyses = backlog.upgrades.map((g) => analyzeGoal(g));
  const report = renderReport(analyses, new Date().toISOString());
  fs.mkdirSync(path.dirname(confined), { recursive: true });
  fs.writeFileSync(confined, report, "utf8");
  return { report, analyses };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const backlogPath = path.join(repoRoot, "config", "forge-upgrades.json");
  const reportPath = path.join(repoRoot, "reports", "forge-self-review.md");
  try {
    const { analyses } = runSelfReview(backlogPath, reportPath);
    const summary = analyses.map((a) => `${a.goal.id}: ${a.currentStatus}`).join(", ");
    console.log(`Self-review complete — ${summary}`);
    console.log(`Report written to ${path.relative(repoRoot, reportPath)}`);
  } catch (e) {
    console.error(`Self-review failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
