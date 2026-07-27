// Governor: final decision layer. Combines test results, guardian review,
// risk level, rollback readiness and approvals into one install decision.

import {
  db,
  modulesTable,
  moduleSnapshotsTable,
  testRunsTable,
  guardianReviewsTable,
  governorDecisionsTable,
  approvalsTable,
  type ModuleRow,
  type GovernorDecisionRow,
} from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { audit } from "./audit";
import { evaluateModulePolicy } from "./selfEvolutionPolicy";

export type GovernorVerdict =
  | "install_allowed"
  | "install_blocked"
  | "review_required"
  | "rollback_required";

async function record(
  module: ModuleRow,
  decision: GovernorVerdict,
  rationale: string,
  inputs: Record<string, unknown>,
): Promise<GovernorDecisionRow> {
  const insertedDecisionRows = await db
    .insert(governorDecisionsTable)
    .values({
      moduleId: module.id,
      decision,
      rationale,
      inputs: JSON.stringify(inputs),
    })
    .returning();
  const row = (insertedDecisionRows as unknown as GovernorDecisionRow[])[0];
  if (!row) throw new Error("Governor decision insert returned no row");
  await audit({
    actor: "governor",
    action: "install_decision",
    targetType: "module",
    targetId: module.id,
    details: `${decision}: ${rationale}`,
    outcome: decision === "install_blocked" ? "blocked" : "allowed",
  });
  return row;
}

async function performInstall(module: ModuleRow, reason: string): Promise<void> {
  // Snapshot before install — rollback must always be possible.
  await db.insert(moduleSnapshotsTable).values({
    moduleId: module.id,
    version: module.version,
    data: JSON.stringify({
      name: module.name,
      type: module.type,
      version: module.version,
      manifest: module.manifest,
      dependencies: module.dependencies,
      active: module.active,
      installStatus: module.installStatus,
    }),
    reason,
  });
  await db
    .update(modulesTable)
    .set({
      installStatus: "installed",
      status: "installed",
      active: true,
      rollbackInfo: `Snapshot of v${module.version} taken before install`,
    })
    .where(eq(modulesTable.id, module.id));
  await audit({
    actor: "governor",
    action: "module_installed",
    targetType: "module",
    targetId: module.id,
    details: `Module '${module.name}' v${module.version} installed (snapshot created)`,
  });
}

export async function governInstall(module: ModuleRow): Promise<GovernorDecisionRow> {
  const [latestTest] = await db
    .select()
    .from(testRunsTable)
    .where(eq(testRunsTable.moduleId, module.id))
    .orderBy(desc(testRunsTable.createdAt))
    .limit(1);
  const [latestReview] = await db
    .select()
    .from(guardianReviewsTable)
    .where(eq(guardianReviewsTable.moduleId, module.id))
    .orderBy(desc(guardianReviewsTable.createdAt))
    .limit(1);

  const inputs = {
    testStatus: latestTest?.status ?? "none",
    guardianOutcome: latestReview?.outcome ?? "none",
    riskLevel: module.riskLevel,
    touchesCore: module.touchesCore,
    hasManifest: Boolean(module.manifest),
  };

  const isSelfEvolution =
    module.ownerAgent === "proposal-generator" || module.ownerAgent === "policy-control";

  if (isSelfEvolution) {
    const policy = await evaluateModulePolicy(module);
    if (!policy.allowed) {
      const prefix = policy.absoluteStop
        ? "Absolute stopconditie: menselijke bevestiging verplicht."
        : `Bevoegdheid '${policy.authority}' staat deze vrijgave niet toe.`;

      return record(
        module,
        "install_blocked",
        `${prefix} ${policy.reasons.join(" | ")}`,
        {
          ...inputs,
          authority: policy.authority,
          successfulReleases: policy.successfulReleases,
          scopeViolations: policy.scopeViolations,
        },
      );
    }
  }
  // Hard blocks
  if (module.touchesCore) {
    return record(module, "install_blocked", "Module touches the Locked Core. Core modifications are forbidden.", inputs);
  }
  if (!module.manifest) {
    return record(module, "install_blocked", "Module has no manifest, so no rollback snapshot can be created. Modules without rollback information are never installed.", inputs);
  }
  if (!latestTest) {
    return record(module, "install_blocked", "No test run exists. Tests are mandatory before installation.", inputs);
  }
  if (latestTest.status === "failed") {
    return record(module, "install_blocked", "Latest test run failed. Failed tests always block installation.", inputs);
  }
  if (!latestReview) {
    return record(module, "review_required", "No Guardian review found. Run a Guardian review before installation.", inputs);
  }
  if (latestReview.outcome === "fail") {
    return record(module, "install_blocked", "Guardian review failed. Resolve the findings before requesting installation again.", inputs);
  }

  // Approval requirements
  const needsOwnerApproval = module.riskLevel !== "low" || latestReview.outcome === "warning";
  if (needsOwnerApproval) {
    const [existing] = await db
      .select()
      .from(approvalsTable)
      .where(and(eq(approvalsTable.moduleId, module.id), eq(approvalsTable.status, "approved")))
      .orderBy(desc(approvalsTable.createdAt))
      .limit(1);
    if (existing) {
      const decision = await record(
        module,
        "install_allowed",
        `Owner approval granted${existing.decidedBy ? ` by ${existing.decidedBy}` : ""}. Installing with pre-install snapshot.`,
        inputs,
      );
      await performInstall(module, "pre-install snapshot (owner-approved)");
      return decision;
    }
    const [pending] = await db
      .select()
      .from(approvalsTable)
      .where(and(eq(approvalsTable.moduleId, module.id), eq(approvalsTable.status, "pending")))
      .limit(1);
    if (!pending) {
      await db.insert(approvalsTable).values({
        moduleId: module.id,
        level: module.riskLevel === "high" ? "owner" : "review",
        status: "pending",
      });
      await audit({
        actor: "governor",
        action: "approval_requested",
        targetType: "module",
        targetId: module.id,
        details: `Approval requested (risk: ${module.riskLevel}, guardian: ${latestReview.outcome})`,
      });
    }
    return record(
      module,
      "review_required",
      `Owner approval required (risk level: ${module.riskLevel}, guardian outcome: ${latestReview.outcome}). An approval request is waiting in the queue.`,
      inputs,
    );
  }

  // Low risk + clean pass → auto install
  const decision = await record(
    module,
    "install_allowed",
    "All gates passed: tests green, Guardian pass, low risk, rollback snapshot available. Auto-install permitted.",
    inputs,
  );
  await performInstall(module, "pre-install snapshot (auto-approved)");
  return decision;
}
