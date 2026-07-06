import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const modulesTable = pgTable("modules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  purpose: text("purpose"),
  version: text("version").notNull().default("0.1.0"),
  status: text("status").notNull().default("draft"),
  active: boolean("active").notNull().default(false),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
  ownerAgent: text("owner_agent").notNull().default("module-manager"),
  riskLevel: text("risk_level").notNull().default("low"),
  testStatus: text("test_status").notNull().default("untested"),
  installStatus: text("install_status").notNull().default("not_installed"),
  rollbackInfo: text("rollback_info"),
  manifest: text("manifest"),
  touchesCore: boolean("touches_core").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const moduleSnapshotsTable = pgTable("module_snapshots", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modulesTable.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  data: text("data"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ModuleRow = typeof modulesTable.$inferSelect;
export type ModuleSnapshotRow = typeof moduleSnapshotsTable.$inferSelect;
