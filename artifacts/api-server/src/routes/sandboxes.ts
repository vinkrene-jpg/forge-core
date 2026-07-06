import { Router, type IRouter } from "express";
import { jsonSafe } from "../lib/jsonSafe";
import { eq, desc, and } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db, sandboxesTable, sandboxFilesTable } from "@workspace/db";
import {
  ListSandboxesResponse,
  CreateSandboxBody,
  CreateSandboxResponse,
  GetSandboxParams,
  GetSandboxResponse,
  DeleteSandboxParams,
  UpsertSandboxFileParams,
  UpsertSandboxFileBody,
  UpsertSandboxFileResponse,
  DeleteSandboxFileParams,
} from "@workspace/api-zod";
import { audit } from "../lib/audit";
import { isProtectedPath } from "../lib/corelock";
import { ensureSandboxDir, removeSandboxDir, sandboxDir } from "../lib/storage";

const router: IRouter = Router();

router.get("/sandboxes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(sandboxesTable).orderBy(desc(sandboxesTable.createdAt));
  res.json(ListSandboxesResponse.parse(jsonSafe(rows)));
});

router.post("/sandboxes", async (req, res): Promise<void> => {
  const body = CreateSandboxBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(sandboxesTable).values(body.data).returning();
  const dir = ensureSandboxDir(row.id);
  const [updated] = await db
    .update(sandboxesTable)
    .set({ storagePath: dir })
    .where(eq(sandboxesTable.id, row.id))
    .returning();
  await audit({
    actor: "sandbox-manager",
    action: "sandbox_created",
    targetType: "sandbox",
    targetId: row.id,
    details: `${row.name} → ${dir}`,
  });
  res.status(201).json(CreateSandboxResponse.parse(jsonSafe(updated)));
});

router.get("/sandboxes/:id", async (req, res): Promise<void> => {
  const params = GetSandboxParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [sandbox] = await db.select().from(sandboxesTable).where(eq(sandboxesTable.id, params.data.id));
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }
  const files = await db
    .select()
    .from(sandboxFilesTable)
    .where(eq(sandboxFilesTable.sandboxId, sandbox.id))
    .orderBy(sandboxFilesTable.path);
  res.json(GetSandboxResponse.parse(jsonSafe({ sandbox, files })));
});

router.delete("/sandboxes/:id", async (req, res): Promise<void> => {
  const params = DeleteSandboxParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(sandboxesTable).where(eq(sandboxesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }
  removeSandboxDir(row.id);
  await audit({
    actor: "sandbox-manager",
    action: "sandbox_deleted",
    targetType: "sandbox",
    targetId: row.id,
    details: `${row.name} removed including storage directory`,
  });
  res.sendStatus(204);
});

router.post("/sandboxes/:id/files", async (req, res): Promise<void> => {
  const params = UpsertSandboxFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpsertSandboxFileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [sandbox] = await db.select().from(sandboxesTable).where(eq(sandboxesTable.id, params.data.id));
  if (!sandbox) {
    res.status(404).json({ error: "Sandbox not found" });
    return;
  }
  if (isProtectedPath(body.data.path)) {
    await audit({
      actor: "sandbox-manager",
      action: "sandbox_core_write_blocked",
      targetType: "sandbox",
      targetId: sandbox.id,
      details: `Blocked write to protected path '${body.data.path}'`,
      outcome: "blocked",
    });
    req.log.warn({ sandboxId: sandbox.id, path: body.data.path }, "Blocked protected path write");
    res.status(403).json({
      error: `Path '${body.data.path}' is protected (Locked Core or outside the sandbox). The attempt has been recorded in the audit log.`,
    });
    return;
  }
  const [existing] = await db
    .select()
    .from(sandboxFilesTable)
    .where(and(eq(sandboxFilesTable.sandboxId, sandbox.id), eq(sandboxFilesTable.path, body.data.path)));
  const row = existing
    ? (
        await db
          .update(sandboxFilesTable)
          .set({ content: body.data.content, updatedAt: new Date() })
          .where(eq(sandboxFilesTable.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(sandboxFilesTable)
          .values({ sandboxId: sandbox.id, path: body.data.path, content: body.data.content })
          .returning()
      )[0];
  // Mirror to the sandbox storage directory
  try {
    const dir = ensureSandboxDir(sandbox.id);
    const target = path.resolve(dir, body.data.path);
    if (target.startsWith(dir)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body.data.content);
    }
  } catch (err) {
    req.log.warn({ err, sandboxId: sandbox.id }, "Could not mirror sandbox file to storage");
  }
  res.json(UpsertSandboxFileResponse.parse(jsonSafe(row)));
});

router.delete("/sandboxes/:id/files/:fileId", async (req, res): Promise<void> => {
  const params = DeleteSandboxFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(sandboxFilesTable)
    .where(and(eq(sandboxFilesTable.id, params.data.fileId), eq(sandboxFilesTable.sandboxId, params.data.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  try {
    const target = path.resolve(sandboxDir(params.data.id), row.path);
    if (target.startsWith(sandboxDir(params.data.id)) && fs.existsSync(target)) fs.unlinkSync(target);
  } catch {
    // storage mirror cleanup is best-effort
  }
  res.sendStatus(204);
});

export default router;
