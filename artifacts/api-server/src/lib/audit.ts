import { db, auditLogsTable } from "@workspace/db";

export async function audit(entry: {
  actor: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  details?: string | null;
  outcome?: "allowed" | "blocked";
}): Promise<void> {
  await db.insert(auditLogsTable).values({
    actor: entry.actor,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId != null ? String(entry.targetId) : null,
    details: entry.details ?? null,
    outcome: entry.outcome ?? "allowed",
  });
}
