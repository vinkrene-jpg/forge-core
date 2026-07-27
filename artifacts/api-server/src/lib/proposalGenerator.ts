// Proposal Generator: turns an existing task or improvement into a concrete
// code proposal, generated via the AI Gateway (task type "codegeneration").
// Generated files are written EXCLUSIVELY into a newly created sandbox.
// Protected core paths are always blocked and audit-logged. No installation
// happens here — the normal chain (real test runner → Guardian → Governor →
// owner approval) remains mandatory for anything this module produces.

import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import {
  db,
  tasksTable,
  improvementsTable,
  modulesTable,
  sandboxesTable,
  sandboxFilesTable,
  proposalsTable,
  type ProposalRow,
  type ModuleRow,
  type SandboxRow,
} from "@workspace/db";
import { invokeGateway, GatewayError } from "./aiGateway";
import { isProtectedPath } from "./corelock";
import { ensureSandboxDir } from "./storage";
import { audit } from "./audit";
import { logger } from "./logger";

const MODULE_TYPES = [
  "planner",
  "architect",
  "frontend-builder",
  "backend-builder",
  "database-builder",
  "test-generator",
  "security-reviewer",
  "ux-reviewer",
  "documentation-generator",
  "performance-analyzer",
  "dependency-checker",
] as const;

const RISK_LEVELS = ["low", "medium", "high"] as const;

const MAX_FILES = 30;
const MAX_FILE_CONTENT = 100_000;

export class ProposalSourceNotFoundError extends Error {}

export interface ProposalSource {
  type: "task" | "improvement";
  id: number;
  title: string;
  description: string;
}

async function loadSource(sourceType: "task" | "improvement", sourceId: number): Promise<ProposalSource> {
  if (sourceType === "task") {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, sourceId));
    if (!task) throw new ProposalSourceNotFoundError(`Task ${sourceId} not found`);
    const description = [
      `Goal: ${task.goal ?? "-"}`,
      `Scope: ${task.scope ?? "-"}`,
      `Risk: ${task.risk}`,
      `Acceptance criteria: ${task.acceptanceCriteria ?? "-"}`,
    ].join("\n");
    return { type: "task", id: task.id, title: task.title, description };
  }
  const [imp] = await db.select().from(improvementsTable).where(eq(improvementsTable.id, sourceId));
  if (!imp) throw new ProposalSourceNotFoundError(`Improvement ${sourceId} not found`);
  const description = [
    `Cause: ${imp.cause ?? "-"}`,
    `Proposed module: ${imp.proposedModule ?? "-"}`,
    `Expected improvement: ${imp.expectedImprovement ?? "-"}`,
    `Risk: ${imp.risk}`,
    `Required tests: ${imp.requiredTests ?? "-"}`,
  ].join("\n");
  return { type: "improvement", id: imp.id, title: imp.problem, description };
}

const GENERATION_INSTRUCTIONS = `You are the Proposal Generator of Forge Core, an autonomous development platform.
Turn the development request below into a concrete, self-contained Node.js module proposal.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{"moduleName":"<kebab-case name>","moduleType":"planner|architect|frontend-builder|backend-builder|database-builder|test-generator|security-reviewer|ux-reviewer|documentation-generator|performance-analyzer|dependency-checker","purpose":"<one sentence>","riskEstimate":"low|medium|high","summary":"<max 3 sentences: what the proposal does and why>","files":[{"path":"<relative path>","content":"<full file content>"}]}

Hard requirements for "files":
- Include a package.json with a "test" script using exactly "node --test --test-isolation=none" (in-process isolation is required by the sandboxed test runner) and NO install-time scripts.
- Include at least one test file so the real test runner can verify the proposal.
- package.json must also contain "lint", "typecheck" and "build" scripts that fail when their real checks fail.
- Never call external or paid APIs, never purchase anything and never perform a production deploy.
- Acceptance requires typecheck, build, unit tests and scope integrity to pass.
- Use plain Node.js (CommonJS or ESM) with zero external dependencies unless absolutely necessary.
- All paths must be relative (e.g. "index.js", "test/index.test.js"). Never use absolute paths or "..".
- Never touch or reference Forge core files; the proposal lives entirely inside its own sandbox.
- Keep it small and reviewable: at most ${MAX_FILES} files.`;

interface ParsedProposal {
  moduleName: string;
  moduleType: (typeof MODULE_TYPES)[number];
  purpose: string;
  riskEstimate: (typeof RISK_LEVELS)[number];
  summary: string;
  files: { path: string; content: string }[];
}

export class ProposalParseError extends Error {}

export function parseProposalResponse(response: string): ParsedProposal {
  const start = response.indexOf("{");
  const end = response.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ProposalParseError("AI response contained no JSON object.");
  }
  let parsed: {
    moduleName?: unknown;
    moduleType?: unknown;
    purpose?: unknown;
    riskEstimate?: unknown;
    summary?: unknown;
    files?: unknown;
  };
  try {
    parsed = JSON.parse(response.slice(start, end + 1)) as typeof parsed;
  } catch {
    throw new ProposalParseError("AI response JSON could not be parsed.");
  }
  const rawFiles = Array.isArray(parsed.files) ? (parsed.files as { path?: unknown; content?: unknown }[]) : [];
  const files = rawFiles
    .filter((f) => f && typeof f.path === "string" && f.path.length > 0 && typeof f.content === "string")
    .slice(0, MAX_FILES)
    .map((f) => ({ path: (f.path as string).trim(), content: (f.content as string).slice(0, MAX_FILE_CONTENT) }));
  if (files.length === 0) {
    throw new ProposalParseError("AI response contained no usable files.");
  }
  const moduleName =
    typeof parsed.moduleName === "string" && parsed.moduleName.trim().length > 0
      ? parsed.moduleName.trim().slice(0, 100)
      : "generated-proposal";
  const moduleType = MODULE_TYPES.includes(parsed.moduleType as (typeof MODULE_TYPES)[number])
    ? (parsed.moduleType as (typeof MODULE_TYPES)[number])
    : "planner";
  const riskEstimate = RISK_LEVELS.includes(parsed.riskEstimate as (typeof RISK_LEVELS)[number])
    ? (parsed.riskEstimate as (typeof RISK_LEVELS)[number])
    : "medium";
  return {
    moduleName,
    moduleType,
    purpose: typeof parsed.purpose === "string" ? parsed.purpose.slice(0, 500) : "",
    riskEstimate,
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
    files,
  };
}

export function isUnsafeRelativePath(p: string): boolean {
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  const segments = p.split(/[\\/]+/);
  return segments.some((s) => s === "..");
}

export async function generateProposal(input: {
  sourceType: "task" | "improvement";
  sourceId: number;
  instructions?: string;
}): Promise<ProposalRow> {
  const source = await loadSource(input.sourceType, input.sourceId);

  const prompt = [
    GENERATION_INSTRUCTIONS,
    "",
    `REQUEST (${source.type} #${source.id}): ${source.title}`,
    source.description,
    ...(input.instructions ? ["", `ADDITIONAL OWNER INSTRUCTIONS: ${input.instructions}`] : []),
  ].join("\n");

  let gateway;
  try {
    gateway = await invokeGateway("codegeneration", prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [failedRow] = (await db
      .insert(proposalsTable)
      .values({
        sourceType: source.type,
        sourceId: source.id,
        prompt,
        status: "failed",
        errorMessage: message.slice(0, 1000),
      })
      .returning()) as unknown as ProposalRow[];
    await audit({
      actor: "proposal-generator",
      action: "proposal_failed",
      targetType: "proposal",
      targetId: failedRow.id,
      details: `AI Gateway failed for ${source.type} #${source.id}: ${message.slice(0, 300)}`,
      outcome: "blocked",
    });
    throw err;
  }

  let parsed: ParsedProposal;
  try {
    parsed = parseProposalResponse(gateway.response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [failedRow] = (await db
      .insert(proposalsTable)
      .values({
        sourceType: source.type,
        sourceId: source.id,
        prompt,
        provider: gateway.provider,
        model: gateway.model,
        status: "failed",
        errorMessage: message.slice(0, 1000),
      })
      .returning()) as unknown as ProposalRow[];
    await audit({
      actor: "proposal-generator",
      action: "proposal_failed",
      targetType: "proposal",
      targetId: failedRow.id,
      details: `Unusable AI response for ${source.type} #${source.id}: ${message.slice(0, 300)}`,
      outcome: "blocked",
    });
    throw new GatewayError(`AI produced an unusable proposal: ${message}`);
  }

  // Split files into writable and blocked (protected core paths / unsafe paths).
  const writable: { path: string; content: string }[] = [];
  const blocked: string[] = [];
  for (const f of parsed.files) {
    if (isUnsafeRelativePath(f.path) || isProtectedPath(f.path)) {
      blocked.push(f.path);
    } else {
      writable.push(f);
    }
  }

  const packageFile = writable.find((f) => f.path.replace(/\\/g, "/") === "package.json");
  if (!packageFile) {
    throw new GatewayError("AI proposal is missing package.json.");
  }

  let packageJson: {
    scripts?: Record<string, unknown>;
    [key: string]: unknown;
  };

  try {
    packageJson = JSON.parse(packageFile.content) as {
      scripts?: Record<string, unknown>;
      [key: string]: unknown;
    };
  } catch {
    throw new GatewayError("AI proposal package.json is not valid JSON.");
  }

  const existingEntry =
    writable.find(
      (f) =>
        /\.(?:cjs|mjs|js)$/.test(f.path) &&
        !/(?:^|[\\/])tests?(?:[\\/]|$)/i.test(f.path) &&
        !/(?:^|[\\/]).*\.test\.(?:cjs|mjs|js)$/i.test(f.path),
    )?.path ?? null;

  const testFile =
    writable.find((f) => /(?:^|[\\/]).*\.test\.(?:cjs|mjs|js)$/i.test(f.path))?.path ??
    writable.find((f) => /(?:^|[\\/])test\.(?:cjs|mjs|js)$/i.test(f.path))?.path ??
    null;

  const repairedScripts: Record<string, unknown> = {
    ...(packageJson.scripts ?? {}),
  };

  if (existingEntry) {
    repairedScripts.lint ??= `node --check ${existingEntry}`;
    repairedScripts.typecheck ??= `node --check ${existingEntry}`;
    repairedScripts.build ??= `node --check ${existingEntry}`;
  }

  if (testFile) {
    repairedScripts.test ??= `node --test ${testFile}`;
  }

  packageJson.scripts = repairedScripts;
  packageFile.content = `${JSON.stringify(packageJson, null, 2)}\n`;

  const requiredScripts = ["lint", "typecheck", "build", "test"] as const;
  const missingScripts = requiredScripts.filter(
    (name) => typeof packageJson.scripts?.[name] !== "string" || packageJson.scripts[name].trim().length === 0,
  );

  if (missingScripts.length > 0) {
    throw new GatewayError(
      `AI proposal package.json still misses required scripts after one automatic repair: ${missingScripts.join(", ")}`,
    );
  }
if (writable.length === 0) {
    const message = `AI proposal contained no writable files; all ${blocked.length} path(s) were unsafe or protected: ${blocked.slice(0, 10).join(", ")}`;
    const [failedRow] = (await db
      .insert(proposalsTable)
      .values({
        sourceType: source.type,
        sourceId: source.id,
        prompt,
        provider: gateway.provider,
        model: gateway.model,
        status: "failed",
        riskEstimate: parsed.riskEstimate,
        blockedFiles: blocked,
        errorMessage: message.slice(0, 1000),
      })
      .returning()) as unknown as ProposalRow[];
    await audit({
      actor: "proposal-generator",
      action: "proposal_failed",
      targetType: "proposal",
      targetId: failedRow.id,
      details: message.slice(0, 300),
      outcome: "blocked",
    });
    throw new GatewayError(`AI produced an unusable proposal: ${message}`);
  }

  // Create module (status: draft — never installed here) and sandbox.
  const entry =
    writable.find(
      (f) =>
        /\.(?:cjs|mjs|js|ts)$/.test(f.path) &&
        !/(?:^|[\\/])tests?(?:[\\/]|$)/i.test(f.path) &&
        !/(?:^|[\\/]).*\.test\.(?:cjs|mjs|js|ts)$/i.test(f.path),
    )?.path ?? null;

  const manifest = JSON.stringify({
    name: parsed.moduleName,
    version: "0.1.0",
    entry,
    paths: writable.map((f) => f.path),
    scope: "sandbox-only",
    actions: [],
    acceptance: ["typecheck", "build", "unit", "scope-integrity"],
  });
  const [moduleRow] = (await db
    .insert(modulesTable)
    .values({
      name: parsed.moduleName,
      type: parsed.moduleType,
      purpose: parsed.purpose || `Proposal for ${source.type} #${source.id}: ${source.title}`.slice(0, 500),
      riskLevel: parsed.riskEstimate,
      ownerAgent: "proposal-generator",
      manifest,
    })
    .returning()) as unknown as ModuleRow[];

  const [sandboxRow] = (await db
    .insert(sandboxesTable)
    .values({
      moduleId: moduleRow.id,
      name: `proposal-${parsed.moduleName}`.slice(0, 100),
      purpose: `Generated proposal for ${source.type} #${source.id}`,
    })
    .returning()) as unknown as SandboxRow[];
  const dir = ensureSandboxDir(sandboxRow.id);
  await db.update(sandboxesTable).set({ storagePath: dir }).where(eq(sandboxesTable.id, sandboxRow.id));

  // Write files: DB rows + mirror inside the sandbox directory only.
  const written: string[] = [];
  for (const f of writable) {
    const target = path.resolve(dir, f.path);
    if (!target.startsWith(dir + path.sep)) {
      blocked.push(f.path);
      continue;
    }
    await db.insert(sandboxFilesTable).values({ sandboxId: sandboxRow.id, path: f.path, content: f.content });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
    written.push(f.path);
  }

  if (blocked.length > 0) {
    await audit({
      actor: "proposal-generator",
      action: "proposal_files_blocked",
      targetType: "sandbox",
      targetId: sandboxRow.id,
      details: `Blocked ${blocked.length} unsafe/protected path(s): ${blocked.slice(0, 10).join(", ")}`,
      outcome: "blocked",
    });
  }

  const [proposalRow] = (await db
    .insert(proposalsTable)
    .values({
      sourceType: source.type,
      sourceId: source.id,
      prompt,
      provider: gateway.provider,
      model: gateway.model,
      status: "generated",
      summary: parsed.summary || null,
      riskEstimate: parsed.riskEstimate,
      moduleId: moduleRow.id,
      sandboxId: sandboxRow.id,
      filesGenerated: written,
      blockedFiles: blocked,
    })
    .returning()) as unknown as ProposalRow[];

  await audit({
    actor: "proposal-generator",
    action: "proposal_generated",
    targetType: "proposal",
    targetId: proposalRow.id,
    details: `${source.type} #${source.id} → module ${moduleRow.id} (${parsed.moduleName}), sandbox ${sandboxRow.id}, ${written.length} file(s), risk ${parsed.riskEstimate}, model ${gateway.provider}/${gateway.model}`,
  });

  logger.info(
    { proposalId: proposalRow.id, moduleId: moduleRow.id, sandboxId: sandboxRow.id, files: written.length },
    "Proposal generated into sandbox",
  );
  return proposalRow;
}
