import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";

export const coreComponentsTable = pgTable("core_components", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  locked: boolean("locked").notNull().default(true),
  version: text("version").notNull().default("1.0.0"),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  details: text("details"),
  outcome: text("outcome").notNull().default("allowed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CoreComponentRow = typeof coreComponentsTable.$inferSelect;
export type AuditLogRow = typeof auditLogsTable.$inferSelect;
