import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { tasksTable } from "./projects";
import { proposalsTable } from "./proposals";

export const introspectionSnapshotsTable = pgTable("introspection_snapshots", {
  id: serial("id").primaryKey(),
  sourceFiles: integer("source_files").notNull().default(0),
  endpoints: integer("endpoints").notNull().default(0),
  dbTables: integer("db_tables").notNull().default(0),
  docs: integer("docs").notNull().default(0),
  dependencies: integer("dependencies").notNull().default(0),
  configKeys: integer("config_keys").notNull().default(0),
  modules: integer("modules").notNull().default(0),
  testRuns: integer("test_runs").notNull().default(0),
  auditEntries: integer("audit_entries").notNull().default(0),
  model: jsonb("model").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const knowledgeNodesTable = pgTable("knowledge_nodes", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => introspectionSnapshotsTable.id, { onDelete: "cascade" }),
  nodeType: text("node_type").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
});

export const knowledgeEdgesTable = pgTable("knowledge_edges", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => introspectionSnapshotsTable.id, { onDelete: "cascade" }),
  fromKey: text("from_key").notNull(),
  toKey: text("to_key").notNull(),
  relation: text("relation").notNull(),
});

export const capabilitiesTable = pgTable("capabilities", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("missing"),
  maturity: integer("maturity").notNull().default(0),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
  limitations: text("limitations"),
  missingParts: jsonb("missing_parts").$type<string[]>().notNull().default([]),
  evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const evolutionPlansTable = pgTable("evolution_plans", {
  id: serial("id").primaryKey(),
  capabilityKey: text("capability_key").notNull(),
  gapSummary: text("gap_summary").notNull(),
  design: text("design").notNull().default(""),
  steps: jsonb("steps").$type<string[]>().notNull().default([]),
  affectedFiles: jsonb("affected_files").$type<string[]>().notNull().default([]),
  risk: text("risk").notNull().default("medium"),
  priority: text("priority").notNull().default("medium"),
  testStrategy: text("test_strategy").notNull().default(""),
  rollbackStrategy: text("rollback_strategy").notNull().default(""),
  source: text("source").notNull().default("fallback"),
  status: text("status").notNull().default("draft"),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const evolutionRunsTable = pgTable("evolution_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"),
  phase: text("phase").notNull().default("started"),
  snapshotId: integer("snapshot_id").references(() => introspectionSnapshotsTable.id, {
    onDelete: "set null",
  }),
  planId: integer("plan_id").references(() => evolutionPlansTable.id, {
    onDelete: "set null",
  }),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  proposalId: integer("proposal_id").references(() => proposalsTable.id, {
    onDelete: "set null",
  }),
  testRunId: integer("test_run_id"),
  guardianVerdict: text("guardian_verdict"),
  governorDecision: text("governor_decision"),
  lessons: jsonb("lessons").$type<string[]>().notNull().default([]),
  nextStep: text("next_step"),
  report: text("report").notNull().default(""),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export type CapabilityRow = typeof capabilitiesTable.$inferSelect;
export type EvolutionPlanRow = typeof evolutionPlansTable.$inferSelect;
export type EvolutionRunRow = typeof evolutionRunsTable.$inferSelect;
export type IntrospectionSnapshotRow = typeof introspectionSnapshotsTable.$inferSelect;
