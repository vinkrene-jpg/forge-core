// Guardian: independent review agent that inspects a module before installation.

import {
  db,
  guardianReviewsTable,
  testRunsTable,
  modulesTable,
  type ModuleRow,
  type GuardianFindingData,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { validateManifest, isProtectedPath } from "./corelock";
import { audit } from "./audit";
import { evaluateModulePolicy, recordPolicyViolation } from "./selfEvolutionPolicy";

export interface GuardianResult {
  id: number;
  moduleId: number;
  outcome: "pass" | "warning" | "fail";
  findings: GuardianFindingData[];
  reviewer: string;
  summary: string | null;
  model: string | null;
  createdAt: Date;
}

export async function runGuardian(module: ModuleRow): Promise<GuardianResult> {
  const findings: GuardianFindingData[] = [];

  const policy = await evaluateModulePolicy(module);
  if (!policy.allowed) {
    for (const reason of policy.reasons) {
      findings.push({
        category: "self-evolution-policy",
        severity: "critical",
        message: reason,
      });
    }
    await recordPolicyViolation(module, policy.reasons);
  }

  // 1. Core protection
  if (module.touchesCore) {
    findings.push({
      category: "core-protection",
      severity: "critical",
      message: "Module declares core impact (touchesCore). Locked Core may never be modified.",
    });
  }

  // 2. Manifest completeness
  const manifest = validateManifest(module.manifest);
  if (!manifest.valid) {
    for (const err of manifest.errors) {
      findings.push({ category: "manifest", severity: "high", message: err });
    }
  } else if (manifest.touchesCore) {
    findings.push({
      category: "core-protection",
      severity: "critical",
      message: "Manifest declares paths inside the protected core.",
    });
  }

  // 3. Dependencies sanity
  const deps = module.dependencies ?? [];
  const dupes = deps.filter((d, i) => deps.indexOf(d) !== i);
  if (dupes.length > 0) {
    findings.push({
      category: "dependencies",
      severity: "medium",
      message: `Duplicate dependencies declared: ${[...new Set(dupes)].join(", ")}`,
    });
  }
  if (deps.some((d) => isProtectedPath(d))) {
    findings.push({
      category: "dependencies",
      severity: "critical",
      message: "Module depends on protected core paths.",
    });
  }

  // 4. Test coverage
  const [latestTest] = await db
    .select()
    .from(testRunsTable)
    .where(eq(testRunsTable.moduleId, module.id))
    .orderBy(desc(testRunsTable.createdAt))
    .limit(1);
  if (!latestTest) {
    findings.push({
      category: "testing",
      severity: "high",
      message: "No test run exists for this module. Tests are mandatory before installation.",
    });
  } else if (latestTest.status === "failed") {
    findings.push({
      category: "testing",
      severity: "critical",
      message: "Latest test run failed. Failed tests always block installation.",
    });
  }

  // 5. Risk level
  if (module.riskLevel === "high") {
    findings.push({
      category: "risk",
      severity: "high",
      message: "Module is classified as high risk and requires owner approval.",
    });
  } else if (module.riskLevel === "medium") {
    findings.push({
      category: "risk",
      severity: "medium",
      message: "Module is classified as medium risk; extra review recommended.",
    });
  }

  // 6. Rollback readiness
  if (!module.manifest) {
    findings.push({
      category: "rollback",
      severity: "high",
      message: "Module has no manifest to snapshot; rollback would be impossible.",
    });
  }

  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasWarn = findings.length > 0;
  const outcome: "pass" | "warning" | "fail" = hasCritical ? "fail" : hasWarn ? "warning" : "pass";

  const [row] = await db
    .insert(guardianReviewsTable)
    .values({ moduleId: module.id, outcome, findings })
    .returning();

  await db
    .update(modulesTable)
    .set({ status: outcome === "fail" ? "guardian_failed" : module.status })
    .where(eq(modulesTable.id, module.id));

  await audit({
    actor: "guardian",
    action: "guardian_review",
    targetType: "module",
    targetId: module.id,
    details: `Outcome: ${outcome} (${findings.length} findings)`,
    outcome: "allowed",
  });

  return {
    id: row.id,
    moduleId: row.moduleId,
    outcome,
    findings,
    reviewer: row.reviewer,
    summary: row.summary,
    model: row.model,
    createdAt: row.createdAt,
  };
}
