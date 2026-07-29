import { desc, eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  governorDecisionsTable,
  guardianReviewsTable,
  modulesTable,
  proposalsTable,
  sandboxFilesTable,
  sandboxesTable,
  testRunsTable,
  type ModuleRow,
} from "@workspace/db";
import { audit } from "./audit";
import { validateManifest } from "./corelock";
import {
  REQUIRED_AUTONOMOUS_GATES,
  deriveAuthorityLevel,
  detectAbsoluteStopReasons,
  parseEvolutionManifest,
  pathAllowedForAuthority,
} from "./selfEvolutionPolicyCore";

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseResults(raw: unknown): { type: string; status: string }[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = item as Record<string, unknown>;
        return { type: String(row.type ?? ""), status: String(row.status ?? "") };
      });
  } catch {
    return [];
  }
}

export async function loadPolicyTrackRecord(): Promise<{
  successfulReleases: number;
  scopeViolations: number;
}> {
  const [decisions, reviews, tests, auditRows] = await Promise.all([
    db.select().from(governorDecisionsTable),
    db.select().from(guardianReviewsTable),
    db.select().from(testRunsTable),
    db.select().from(auditLogsTable),
  ]);

  const passedReviewModules = new Set(
    reviews.filter((row) => row.outcome === "pass").map((row) => row.moduleId),
  );
  const passedTestModules = new Set(
    tests.filter((row) => row.status === "passed" && row.moduleId != null).map((row) => row.moduleId as number),
  );

  const successfulReleases = decisions.filter(
    (row) =>
      row.decision === "install_allowed" &&
      passedReviewModules.has(row.moduleId) &&
      passedTestModules.has(row.moduleId),
  ).length;

  const scopeViolations = auditRows.filter(
    (row) => row.action === "self_evolution_policy_blocked",
  ).length;

  return { successfulReleases, scopeViolations };
}

export interface ModulePolicyResult {
  allowed: boolean;
  absoluteStop: boolean;
  authority: ReturnType<typeof deriveAuthorityLevel>;
  reasons: string[];
  successfulReleases: number;
  scopeViolations: number;
}

export async function evaluateModulePolicy(module: ModuleRow): Promise<ModulePolicyResult> {
  const reasons: string[] = [];
  const basicManifest = validateManifest(module.manifest);
  if (!basicManifest.valid) reasons.push(...basicManifest.errors);
  if (basicManifest.touchesCore || module.touchesCore) {
    reasons.push("Wijziging raakt een van de 13 vergrendelde kerncomponenten.");
  }

  const parsed = parseEvolutionManifest(module.manifest);
  reasons.push(...parsed.errors);

  const record = await loadPolicyTrackRecord();
  const authority = deriveAuthorityLevel(record);

  const [sandboxRows, proposalRows, testRows] = await Promise.all([
    db.select().from(sandboxesTable).where(eq(sandboxesTable.moduleId, module.id)),
    db.select().from(proposalsTable).where(eq(proposalsTable.moduleId, module.id)).orderBy(desc(proposalsTable.id)).limit(1),
    db.select().from(testRunsTable).where(eq(testRunsTable.moduleId, module.id)).orderBy(desc(testRunsTable.id)).limit(1),
  ]);

  const files: { path: string; content: string }[] = [];
  for (const sandbox of sandboxRows) {
    const rows = await db.select().from(sandboxFilesTable).where(eq(sandboxFilesTable.sandboxId, sandbox.id));
    for (const row of rows) files.push({ path: row.path, content: row.content });
  }

  let absoluteStopReasons: string[] = [];
  if (parsed.manifest) {
    const missingGates = REQUIRED_AUTONOMOUS_GATES.filter(
      (gate) => !parsed.manifest!.acceptance.includes(gate),
    );
    if (missingGates.length > 0) {
      reasons.push(`Objectieve acceptatiecriteria ontbreken: ${missingGates.join(", ")}`);
    }

    for (const filePath of parsed.manifest.paths) {
      if (!pathAllowedForAuthority(filePath, parsed.manifest.scope, authority)) {
        reasons.push(
          `Pad buiten bevoegdheid '${authority}' of beschermd pad: ${filePath}`,
        );
      }
    }

    absoluteStopReasons = detectAbsoluteStopReasons(parsed.manifest, files);
    reasons.push(...absoluteStopReasons);
  }

  const proposal = proposalRows[0];
  if (!proposal) {
    reasons.push("Geen voorstelrecord gevonden.");
  } else {
    const blockedFiles = toStringArray(proposal.blockedFiles);
    if (blockedFiles.length > 0) {
      reasons.push(`Voorstel bevat geblokkeerde bestanden: ${blockedFiles.join(", ")}`);
    }
  }

  const latestTest = testRows[0];
  if (!latestTest || latestTest.status !== "passed") {
    reasons.push("Volledige verificatiestraat is niet groen.");
  } else {
    const results = parseResults(latestTest.results);
    for (const required of ["typecheck", "build", "unit"]) {
      const step = results.find((result) => result.type === required);
      if (!step || step.status !== "passed") {
        reasons.push(`Verificatiestap '${required}' is niet aantoonbaar geslaagd.`);
      }
    }
  }

  if (module.riskLevel !== "low") {
    reasons.push(`Alleen laag risico mag autonoom vrijgegeven worden; gevonden: ${module.riskLevel}`);
  }

  return {
    allowed: reasons.length === 0,
    absoluteStop: absoluteStopReasons.length > 0,
    authority,
    reasons: [...new Set(reasons)],
    successfulReleases: record.successfulReleases,
    scopeViolations: record.scopeViolations,
  };
}

export async function recordPolicyViolation(module: ModuleRow, reasons: string[]): Promise<void> {
  const isControl = module.ownerAgent === "policy-control";
  await audit({
    actor: "self-evolution-policy",
    action: isControl ? "self_evolution_policy_control_blocked" : "self_evolution_policy_blocked",
    targetType: "module",
    targetId: module.id,
    details: reasons.join(" | ").slice(0, 2000),
    outcome: "blocked",
  });
}

export async function reloadModule(moduleId: number): Promise<ModuleRow | undefined> {
  const rows = await db.select().from(modulesTable).where(eq(modulesTable.id, moduleId));
  return rows[0] as ModuleRow | undefined;
}