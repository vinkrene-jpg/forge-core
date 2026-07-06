import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const aiCallsTable = pgTable("ai_calls", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  taskType: text("task_type").notNull(),
  status: text("status").notNull().default("success"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costIndication: text("cost_indication"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiCallRow = typeof aiCallsTable.$inferSelect;
