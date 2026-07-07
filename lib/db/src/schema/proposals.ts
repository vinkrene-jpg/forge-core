import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { modulesTable } from "./modules";
import { sandboxesTable } from "./sandboxes";

export const proposalsTable = pgTable("proposals", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  prompt: text("prompt").notNull(),
  provider: text("provider"),
  model: text("model"),
  status: text("status").notNull().default("generated"),
  summary: text("summary"),
  riskEstimate: text("risk_estimate").notNull().default("medium"),
  moduleId: integer("module_id").references(() => modulesTable.id, {
    onDelete: "set null",
  }),
  sandboxId: integer("sandbox_id").references(() => sandboxesTable.id, {
    onDelete: "set null",
  }),
  filesGenerated: jsonb("files_generated").$type<string[]>().notNull().default([]),
  blockedFiles: jsonb("blocked_files").$type<string[]>().notNull().default([]),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProposalRow = typeof proposalsTable.$inferSelect;
