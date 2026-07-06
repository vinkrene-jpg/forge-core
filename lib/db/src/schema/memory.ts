import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { tasksTable } from "./projects";

export const memoryItemsTable = pgTable("memory_items", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  taskId: integer("task_id").references(() => tasksTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const improvementsTable = pgTable("improvements", {
  id: serial("id").primaryKey(),
  problem: text("problem").notNull(),
  cause: text("cause"),
  proposedModule: text("proposed_module"),
  expectedImprovement: text("expected_improvement"),
  risk: text("risk").notNull().default("low"),
  priority: text("priority").notNull().default("medium"),
  requiredTests: text("required_tests"),
  status: text("status").notNull().default("open"),
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dailyLoopRunsTable = pgTable("daily_loop_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"),
  report: text("report"),
  tasksCreated: integer("tasks_created"),
  approvalsRequested: integer("approvals_requested"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export type MemoryItemRow = typeof memoryItemsTable.$inferSelect;
export type ImprovementRow = typeof improvementsTable.$inferSelect;
export type DailyLoopRunRow = typeof dailyLoopRunsTable.$inferSelect;
