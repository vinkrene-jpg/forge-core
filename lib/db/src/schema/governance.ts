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

export const testRunsTable = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id").references(() => modulesTable.id, {
    onDelete: "cascade",
  }),
  sandboxId: integer("sandbox_id").references(() => sandboxesTable.id, {
    onDelete: "cascade",
  }),
  types: jsonb("types").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("pending"),
  results: text("results"),
  passed: integer("passed"),
  failed: integer("failed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modulesTable.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("review"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export interface GuardianFindingData {
  category: string;
  severity: string;
  message: string;
}

export const guardianReviewsTable = pgTable("guardian_reviews", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modulesTable.id, { onDelete: "cascade" }),
  outcome: text("outcome").notNull(),
  findings: jsonb("findings").$type<GuardianFindingData[]>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const governorDecisionsTable = pgTable("governor_decisions", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modulesTable.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  rationale: text("rationale").notNull(),
  inputs: text("inputs"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TestRunRow = typeof testRunsTable.$inferSelect;
export type ApprovalRow = typeof approvalsTable.$inferSelect;
export type GuardianReviewRow = typeof guardianReviewsTable.$inferSelect;
export type GovernorDecisionRow = typeof governorDecisionsTable.$inferSelect;
