import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const goalsTable = pgTable("goals", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
});

export const backlogItemsTable = pgTable("backlog_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
});

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const decisionsTable = pgTable("decisions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  taskId: integer("task_id").references(() => tasksTable.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  rationale: text("rationale"),
  madeBy: text("made_by").notNull().default("owner"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const risksTable = pgTable("risks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  severity: text("severity").notNull().default("medium"),
  mitigation: text("mitigation"),
  status: text("status").notNull().default("open"),
});

export type ProjectRow = typeof projectsTable.$inferSelect;
export type GoalRow = typeof goalsTable.$inferSelect;
export type BacklogItemRow = typeof backlogItemsTable.$inferSelect;
export type TaskRow = typeof tasksTable.$inferSelect;
export type DecisionRow = typeof decisionsTable.$inferSelect;
export type RiskRow = typeof risksTable.$inferSelect;
