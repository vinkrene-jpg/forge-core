import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  db,
  modulesTable,
  moduleSnapshotsTable,
  testRunsTable,
  guardianReviewsTable,
  governorDecisionsTable,
  approvalsTable,
} from "@workspace/db";
import {
  ListModulesResponse,
  CreateModuleBody,
  CreateModuleResponse,
  GetModuleParams,
  GetModuleResponse,
  UpdateModuleParams,
  UpdateModuleBody,
  UpdateModuleResponse,
  DeleteModuleParams,
  ActivateModuleParams,
  ActivateModuleResponse,
  DeactivateModuleParams,
  DeactivateModuleResponse,
  InstallModuleParams,
  InstallModuleResponse,
  RollbackModuleParams,
  RollbackModuleResponse,
  ListModuleSnapshotsParams,
  ListModuleSnapshotsResponse,
  RunGuardianReviewParams,
  RunGuardianReviewResponse,
  RunAiGuardianReviewParams,
  RunAiGuardianReviewResponse,
  ListGuardianReviewsQueryParams,
  ListGuardianReviewsResponse,
  ListGovernorDecisionsQueryParams,
  ListGovernorDecisionsResponse,
} from "@workspace/api-zod";
import { audit } from "../lib/audit";
import { validateManifest } from "../lib/corelock";
import { runGuardian } from "../lib/guardian";
import { runAiGuardianReview } from "../lib/aiGuardianReviewer";
import { GatewayError } from "../lib/aiGateway";
import { governInstall } from "../lib/governor";

const router: IRouter = Router();

function moduleName(id: number): Promise<string | null> {
  return db
    .select({ name: modulesTable.name })
    .from(modulesTable)
    .where(eq(modulesTable.id, id))
    .then((rows) => rows[0]?.name ?? null);
}

router.get("/modules", async (_req, res): Promise<void> => {
  const rows = await db.select().from(modulesTable).orderBy(desc(modulesTable.createdAt));
  res.json(ListModulesResponse.parse(jsonSafe(rows)));
});

router.post("/modules", async (req, res): Promise<void> => {
  const body = CreateModuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  let touchesCore = body.data.touchesCore ?? false;
  if (body.data.manifest != null && body.data.manifest.trim() !== "") {
    const check = validateManifest(body.data.manifest);
    if (!check.valid) {
      res.status(400).json({ error: `Invalid manifest: ${check.errors.join("; ")}` });
      return;
    }
    touchesCore = touchesCore || check.touchesCore;
  }
  const [row] = await db
    .insert(modulesTable)
    .values({ ...body.data, touchesCore, dependencies: body.data.dependencies ?? [] })
    .returning();
  await audit({
    actor: "module-manager",
    action: "module_created",
    targetType: "module",
    targetId: row.id,
    details: `${row.name} (${row.type}, risk: ${row.riskLevel}${touchesCore ? ", TOUCHES CORE" : ""})`,
  });
  res.status(201).json(CreateModuleResponse.parse(jsonSafe(row)));
});

router.get("/modules/:id", async (req, res): Promise<void> => {
  const params = GetModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  const [testRuns, guardianReviews, governorDecisions, approvals, snapshots] = await Promise.all([
    db.select().from(testRunsTable).where(eq(testRunsTable.moduleId, module.id)).orderBy(desc(testRunsTable.createdAt)),
    db.select().from(guardianReviewsTable).where(eq(guardianReviewsTable.moduleId, module.id)).orderBy(desc(guardianReviewsTable.createdAt)),
    db.select().from(governorDecisionsTable).where(eq(governorDecisionsTable.moduleId, module.id)).orderBy(desc(governorDecisionsTable.createdAt)),
    db.select().from(approvalsTable).where(eq(approvalsTable.moduleId, module.id)).orderBy(desc(approvalsTable.createdAt)),
    db.select().from(moduleSnapshotsTable).where(eq(moduleSnapshotsTable.moduleId, module.id)).orderBy(desc(moduleSnapshotsTable.createdAt)),
  ]);
  res.json(
    GetModuleResponse.parse(
      jsonSafe({
        module,
        testRuns,
        guardianReviews,
        governorDecisions,
        approvals: approvals.map((a) => ({ ...a, moduleName: module.name })),
        snapshots,
      }),
    ),
  );
});

router.patch("/modules/:id", async (req, res): Promise<void> => {
  const params = UpdateModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateModuleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [existing] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  let touchesCore = body.data.touchesCore ?? existing.touchesCore;
  if (body.data.manifest != null && body.data.manifest.trim() !== "") {
    const check = validateManifest(body.data.manifest);
    if (!check.valid) {
      res.status(400).json({ error: `Invalid manifest: ${check.errors.join("; ")}` });
      return;
    }
    if (check.touchesCore) {
      await audit({
        actor: "module-manager",
        action: "module_core_manifest_blocked",
        targetType: "module",
        targetId: existing.id,
        details: "Blocked manifest update that declares protected core paths",
        outcome: "blocked",
      });
      res.status(403).json({
        error: "Manifest declares paths inside the Locked Core. This change is blocked and has been recorded in the audit log.",
      });
      return;
    }
    touchesCore = body.data.touchesCore ?? false;
  }
  // Material changes invalidate prior governance state: old approvals and
  // test results must not be reusable for a modified module.
  const materialChange =
    (body.data.manifest != null && body.data.manifest !== existing.manifest) ||
    (body.data.version != null && body.data.version !== existing.version) ||
    (body.data.dependencies != null &&
      JSON.stringify(body.data.dependencies) !== JSON.stringify(existing.dependencies));

  const [row] = await db
    .update(modulesTable)
    .set({
      ...body.data,
      touchesCore,
      ...(materialChange ? { testStatus: "untested" as const } : {}),
    })
    .where(eq(modulesTable.id, existing.id))
    .returning();

  if (materialChange) {
    await db
      .update(approvalsTable)
      .set({ status: "expired", reason: "Module changed after approval; re-run the governance pipeline." })
      .where(
        and(
          eq(approvalsTable.moduleId, existing.id),
          inArray(approvalsTable.status, ["pending", "approved"]),
        ),
      );
    await audit({
      actor: "module-manager",
      action: "approvals_expired",
      targetType: "module",
      targetId: existing.id,
      details: "Module was modified; prior approvals expired and tests reset",
    });
  }

  res.json(UpdateModuleResponse.parse(jsonSafe(row)));
});

router.delete("/modules/:id", async (req, res): Promise<void> => {
  const params = DeleteModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(modulesTable).where(eq(modulesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  await audit({ actor: "module-manager", action: "module_deleted", targetType: "module", targetId: row.id, details: row.name });
  res.sendStatus(204);
});

router.post("/modules/:id/activate", async (req, res): Promise<void> => {
  const params = ActivateModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(modulesTable)
    .set({ active: true, status: "active" })
    .where(eq(modulesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  await audit({ actor: "module-manager", action: "module_activated", targetType: "module", targetId: row.id, details: row.name });
  res.json(ActivateModuleResponse.parse(jsonSafe(row)));
});

router.post("/modules/:id/deactivate", async (req, res): Promise<void> => {
  const params = DeactivateModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(modulesTable)
    .set({ active: false, status: "inactive" })
    .where(eq(modulesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  await audit({ actor: "module-manager", action: "module_deactivated", targetType: "module", targetId: row.id, details: row.name });
  res.json(DeactivateModuleResponse.parse(jsonSafe(row)));
});

router.post("/modules/:id/install", async (req, res): Promise<void> => {
  const params = InstallModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  const decision = await governInstall(module);
  res.json(InstallModuleResponse.parse(jsonSafe({ ...decision, moduleName: module.name })));
});

router.post("/modules/:id/rollback", async (req, res): Promise<void> => {
  const params = RollbackModuleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  const [snapshot] = await db
    .select()
    .from(moduleSnapshotsTable)
    .where(eq(moduleSnapshotsTable.moduleId, module.id))
    .orderBy(desc(moduleSnapshotsTable.createdAt))
    .limit(1);
  if (!snapshot) {
    res.status(400).json({ error: "No snapshot available for rollback" });
    return;
  }
  let restored: Partial<typeof modulesTable.$inferInsert> = {};
  if (snapshot.data) {
    try {
      const data = JSON.parse(snapshot.data) as Record<string, unknown>;
      restored = {
        version: typeof data.version === "string" ? data.version : module.version,
        manifest: typeof data.manifest === "string" ? data.manifest : module.manifest,
        dependencies: Array.isArray(data.dependencies) ? (data.dependencies as string[]) : module.dependencies,
      };
    } catch {
      // snapshot data unreadable — restore status only
    }
  }
  const [row] = await db
    .update(modulesTable)
    .set({
      ...restored,
      active: false,
      status: "rolled_back",
      installStatus: "rolled_back",
      rollbackInfo: `Rolled back to snapshot #${snapshot.id} (v${snapshot.version})`,
    })
    .where(eq(modulesTable.id, module.id))
    .returning();
  await audit({
    actor: "rollback-engine",
    action: "module_rolled_back",
    targetType: "module",
    targetId: module.id,
    details: `Restored snapshot #${snapshot.id} (v${snapshot.version})`,
  });
  res.json(RollbackModuleResponse.parse(jsonSafe(row)));
});

router.get("/modules/:id/snapshots", async (req, res): Promise<void> => {
  const params = ListModuleSnapshotsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(moduleSnapshotsTable)
    .where(eq(moduleSnapshotsTable.moduleId, params.data.id))
    .orderBy(desc(moduleSnapshotsTable.createdAt));
  res.json(ListModuleSnapshotsResponse.parse(jsonSafe(rows)));
});

router.post("/modules/:id/guardian-review", async (req, res): Promise<void> => {
  const params = RunGuardianReviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  const review = await runGuardian(module);
  res.json(RunGuardianReviewResponse.parse(jsonSafe({ ...review, moduleName: module.name })));
});

router.post("/modules/:id/ai-guardian-review", async (req, res): Promise<void> => {
  const params = RunAiGuardianReviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, params.data.id));
  if (!module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  try {
    const review = await runAiGuardianReview(module);
    res.json(RunAiGuardianReviewResponse.parse(jsonSafe({ ...review, moduleName: module.name })));
  } catch (err) {
    if (err instanceof GatewayError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/guardian-reviews", async (req, res): Promise<void> => {
  const query = ListGuardianReviewsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = query.data.moduleId != null
    ? await db.select().from(guardianReviewsTable).where(eq(guardianReviewsTable.moduleId, query.data.moduleId)).orderBy(desc(guardianReviewsTable.createdAt))
    : await db.select().from(guardianReviewsTable).orderBy(desc(guardianReviewsTable.createdAt));
  const withNames = await Promise.all(
    rows.map(async (r) => ({ ...r, moduleName: await moduleName(r.moduleId) })),
  );
  res.json(ListGuardianReviewsResponse.parse(jsonSafe(withNames)));
});

router.get("/governor-decisions", async (req, res): Promise<void> => {
  const query = ListGovernorDecisionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = query.data.moduleId != null
    ? await db.select().from(governorDecisionsTable).where(eq(governorDecisionsTable.moduleId, query.data.moduleId)).orderBy(desc(governorDecisionsTable.createdAt))
    : await db.select().from(governorDecisionsTable).orderBy(desc(governorDecisionsTable.createdAt));
  const withNames = await Promise.all(
    rows.map(async (r) => ({ ...r, moduleName: await moduleName(r.moduleId) })),
  );
  res.json(ListGovernorDecisionsResponse.parse(jsonSafe(withNames)));
});

export default router;
