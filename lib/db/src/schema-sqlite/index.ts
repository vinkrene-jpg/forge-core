import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const coreComponentsTable = sqliteTable("core_components", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  locked: integer("locked", { mode: "boolean" }).notNull().default(true),
  version: text("version").notNull().default("1.0.0"),
});

export const auditLogsTable = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  details: text("details"),
  outcome: text("outcome").notNull().default("allowed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const aiCallsTable = sqliteTable("ai_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  taskType: text("task_type").notNull(),
  status: text("status").notNull().default("success"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costIndication: text("cost_indication"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectsTable = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const goalsTable = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
});

export const backlogItemsTable = sqliteTable("backlog_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
});

export const tasksTable = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  parentTaskId: integer("parent_task_id"),
  title: text("title").notNull(),
  goal: text("goal"),
  scope: text("scope"),
  risk: text("risk").notNull().default("low"),
  ownerAgent: text("owner_agent").notNull().default("planner"),
  status: text("status").notNull().default("draft"),
  acceptanceCriteria: text("acceptance_criteria"),
  blockedReason: text("blocked_reason"),
  source: text("source"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at"),
});

export const decisionsTable = sqliteTable("decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  rationale: text("rationale"),
  madeBy: text("made_by").notNull().default("owner"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const risksTable = sqliteTable("risks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  severity: text("severity").notNull().default("medium"),
  mitigation: text("mitigation"),
  status: text("status").notNull().default("open"),
});

export const modulesTable = sqliteTable("modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  purpose: text("purpose"),
  version: text("version").notNull().default("0.1.0"),
  status: text("status").notNull().default("draft"),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  dependencies: text("dependencies", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  ownerAgent: text("owner_agent").notNull().default("module-manager"),
  riskLevel: text("risk_level").notNull().default("low"),
  testStatus: text("test_status").notNull().default("untested"),
  installStatus: text("install_status").notNull().default("not_installed"),
  rollbackInfo: text("rollback_info"),
  manifest: text("manifest"),
  touchesCore: integer("touches_core", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const moduleSnapshotsTable = sqliteTable("module_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  data: text("data"),
  reason: text("reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sandboxesTable = sqliteTable("sandboxes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").references(() => modulesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  purpose: text("purpose"),
  status: text("status").notNull().default("active"),
  testStatus: text("test_status").notNull().default("untested"),
  storagePath: text("storage_path"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sandboxFilesTable = sqliteTable("sandbox_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sandboxId: integer("sandbox_id").notNull().references(() => sandboxesTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const proposalsTable = sqliteTable("proposals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  prompt: text("prompt").notNull(),
  provider: text("provider"),
  model: text("model"),
  status: text("status").notNull().default("generated"),
  summary: text("summary"),
  riskEstimate: text("risk_estimate").notNull().default("medium"),
  moduleId: integer("module_id").references(() => modulesTable.id, { onDelete: "set null" }),
  sandboxId: integer("sandbox_id").references(() => sandboxesTable.id, { onDelete: "set null" }),
  filesGenerated: text("files_generated", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  blockedFiles: text("blocked_files", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const testRunsTable = sqliteTable("test_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").references(() => modulesTable.id, { onDelete: "cascade" }),
  sandboxId: integer("sandbox_id").references(() => sandboxesTable.id, { onDelete: "cascade" }),
  types: text("types", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  status: text("status").notNull().default("pending"),
  results: text("results"),
  passed: integer("passed"),
  failed: integer("failed"),
  mode: text("mode").notNull().default("static"),
  moduleVersion: text("module_version"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const testRunStepsTable = sqliteTable("test_run_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  testRunId: integer("test_run_id").notNull().references(() => testRunsTable.id, { onDelete: "cascade" }),
  step: text("step").notNull(),
  command: text("command").notNull(),
  status: text("status").notNull(),
  exitCode: integer("exit_code"),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const approvalsTable = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("review"),
  status: text("status").notNull().default("pending"),
  reason: text("reason"),
  decidedBy: text("decided_by"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export interface GuardianFindingData {
  category: string;
  severity: string;
  message: string;
}

export const guardianReviewsTable = sqliteTable("guardian_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  outcome: text("outcome").notNull(),
  findings: text("findings", { mode: "json" }).$type<GuardianFindingData[]>().notNull().default(sql`'[]'`),
  reviewer: text("reviewer").notNull().default("rules"),
  summary: text("summary"),
  model: text("model"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const governorDecisionsTable = sqliteTable("governor_decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  rationale: text("rationale").notNull(),
  inputs: text("inputs"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const memoryItemsTable = sqliteTable("memory_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const improvementsTable = sqliteTable("improvements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  problem: text("problem").notNull(),
  cause: text("cause"),
  proposedModule: text("proposed_module"),
  expectedImprovement: text("expected_improvement"),
  risk: text("risk").notNull().default("low"),
  priority: text("priority").notNull().default("medium"),
  requiredTests: text("required_tests"),
  status: text("status").notNull().default("open"),
  source: text("source"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dailyLoopRunsTable = sqliteTable("daily_loop_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull().default("running"),
  report: text("report"),
  tasksCreated: integer("tasks_created"),
  approvalsRequested: integer("approvals_requested"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
});

export type CoreComponentRow = typeof coreComponentsTable.$inferSelect;
export type AuditLogRow = typeof auditLogsTable.$inferSelect;
export type AiCallRow = typeof aiCallsTable.$inferSelect;
export type ProjectRow = typeof projectsTable.$inferSelect;
export type GoalRow = typeof goalsTable.$inferSelect;
export type BacklogItemRow = typeof backlogItemsTable.$inferSelect;
export type TaskRow = typeof tasksTable.$inferSelect;
export type DecisionRow = typeof decisionsTable.$inferSelect;
export type RiskRow = typeof risksTable.$inferSelect;
export type ModuleRow = typeof modulesTable.$inferSelect;
export type ModuleSnapshotRow = typeof moduleSnapshotsTable.$inferSelect;
export type SandboxRow = typeof sandboxesTable.$inferSelect;
export type SandboxFileRow = typeof sandboxFilesTable.$inferSelect;
export type ProposalRow = typeof proposalsTable.$inferSelect;
export type TestRunRow = typeof testRunsTable.$inferSelect;
export type TestRunStepRow = typeof testRunStepsTable.$inferSelect;
export type ApprovalRow = typeof approvalsTable.$inferSelect;
export type GuardianReviewRow = typeof guardianReviewsTable.$inferSelect;
export type GovernorDecisionRow = typeof governorDecisionsTable.$inferSelect;
export type MemoryItemRow = typeof memoryItemsTable.$inferSelect;
export type ImprovementRow = typeof improvementsTable.$inferSelect;
export type DailyLoopRunRow = typeof dailyLoopRunsTable.$inferSelect;
