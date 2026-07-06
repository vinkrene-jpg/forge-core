import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { modulesTable } from "./modules";

export const sandboxesTable = pgTable("sandboxes", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id").references(() => modulesTable.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  purpose: text("purpose"),
  status: text("status").notNull().default("active"),
  testStatus: text("test_status").notNull().default("untested"),
  storagePath: text("storage_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sandboxFilesTable = pgTable("sandbox_files", {
  id: serial("id").primaryKey(),
  sandboxId: integer("sandbox_id")
    .notNull()
    .references(() => sandboxesTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SandboxRow = typeof sandboxesTable.$inferSelect;
export type SandboxFileRow = typeof sandboxFilesTable.$inferSelect;
