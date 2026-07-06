import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq } from "drizzle-orm";
import { db, coreComponentsTable } from "@workspace/db";
import {
  ListCoreComponentsResponse,
  UpdateCoreComponentBody,
  UpdateCoreComponentParams,
  UpdateCoreComponentResponse,
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
} from "@workspace/api-zod";
import { desc, eq as eqOp } from "drizzle-orm";
import { auditLogsTable } from "@workspace/db";
import { audit } from "../lib/audit";
import { coreAdminOverrideEnabled } from "../lib/corelock";

const router: IRouter = Router();

router.get("/core-components", async (_req, res): Promise<void> => {
  const rows = await db.select().from(coreComponentsTable).orderBy(coreComponentsTable.id);
  res.json(ListCoreComponentsResponse.parse(jsonSafe(rows)));
});

router.patch("/core-components/:id", async (req, res): Promise<void> => {
  const params = UpdateCoreComponentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateCoreComponentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [component] = await db
    .select()
    .from(coreComponentsTable)
    .where(eq(coreComponentsTable.id, params.data.id));
  if (!component) {
    res.status(404).json({ error: "Core component not found" });
    return;
  }
  if (component.locked && !coreAdminOverrideEnabled()) {
    await audit({
      actor: "owner",
      action: "core_modify_attempt",
      targetType: "core-component",
      targetId: component.id,
      details: `Blocked modification of locked core component '${component.name}'`,
      outcome: "blocked",
    });
    req.log.warn({ component: component.key }, "Blocked locked core modification");
    res.status(403).json({
      error: `'${component.name}' is part of the Locked Core and cannot be modified. This attempt has been recorded in the audit log.`,
    });
    return;
  }
  const [updated] = await db
    .update(coreComponentsTable)
    .set(body.data)
    .where(eq(coreComponentsTable.id, component.id))
    .returning();
  await audit({
    actor: "owner",
    action: "core_modified",
    targetType: "core-component",
    targetId: component.id,
    details: "Core component updated with admin override",
  });
  res.json(UpdateCoreComponentResponse.parse(jsonSafe(updated)));
});

router.get("/audit-logs", async (req, res): Promise<void> => {
  const query = ListAuditLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const limit = query.data.limit ?? 200;
  const rows = query.data.targetType
    ? await db
        .select()
        .from(auditLogsTable)
        .where(eqOp(auditLogsTable.targetType, query.data.targetType))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(auditLogsTable)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit);
  res.json(ListAuditLogsResponse.parse(jsonSafe(rows)));
});

export default router;
