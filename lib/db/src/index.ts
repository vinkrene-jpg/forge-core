import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import Database from "better-sqlite3";
import pg from "pg";
import * as schema from "./schema";
import * as sqliteSchema from "./schema-sqlite";
import { bootstrapSqliteSchema } from "./sqlite-bootstrap";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const isPostgres = Boolean(DATABASE_URL);

export const pool = isPostgres
  ? new Pool({ connectionString: DATABASE_URL })
  : null;

function resolveSqlitePath(): string {
  const configured = process.env.FORGE_SQLITE_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../../../../storage/forge.sqlite");
}

function ensureSqliteDatabaseFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.closeSync(fs.openSync(filePath, "w"));
  }
}

const sqlitePath = !isPostgres ? resolveSqlitePath() : null;

if (sqlitePath) {
  ensureSqliteDatabaseFile(sqlitePath);
  bootstrapSqliteSchema(sqlitePath);
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = `sqlite:${sqlitePath}`;
  }
}

const sqliteClient = sqlitePath ? new Database(sqlitePath) : null;

export type DbClient = NodePgDatabase<typeof schema>;

export const db: DbClient = (isPostgres
  ? drizzlePg(pool!, { schema })
  : drizzleSqlite(sqliteClient!, {
      schema: sqliteSchema,
    })) as unknown as DbClient;

const tables: any = isPostgres ? schema : sqliteSchema;

export const coreComponentsTable = tables.coreComponentsTable;
export const auditLogsTable = tables.auditLogsTable;
export const aiCallsTable = tables.aiCallsTable;
export const projectsTable = tables.projectsTable;
export const goalsTable = tables.goalsTable;
export const backlogItemsTable = tables.backlogItemsTable;
export const tasksTable = tables.tasksTable;
export const decisionsTable = tables.decisionsTable;
export const risksTable = tables.risksTable;
export const modulesTable = tables.modulesTable;
export const moduleSnapshotsTable = tables.moduleSnapshotsTable;
export const sandboxesTable = tables.sandboxesTable;
export const sandboxFilesTable = tables.sandboxFilesTable;
export const proposalsTable = tables.proposalsTable;
export const testRunsTable = tables.testRunsTable;
export const testRunStepsTable = tables.testRunStepsTable;
export const approvalsTable = tables.approvalsTable;
export const guardianReviewsTable = tables.guardianReviewsTable;
export const governorDecisionsTable = tables.governorDecisionsTable;
export const memoryItemsTable = tables.memoryItemsTable;
export const improvementsTable = tables.improvementsTable;
export const dailyLoopRunsTable = tables.dailyLoopRunsTable;

export type DbEngine = "postgres" | "sqlite";
export const dbEngine: DbEngine = isPostgres ? "postgres" : "sqlite";
export const resolvedSqlitePath = sqlitePath;

export type {
  CoreComponentRow,
  AuditLogRow,
  AiCallRow,
  ProjectRow,
  GoalRow,
  BacklogItemRow,
  TaskRow,
  DecisionRow,
  RiskRow,
  ModuleRow,
  ModuleSnapshotRow,
  SandboxRow,
  SandboxFileRow,
  TestRunRow,
  TestRunStepRow,
  ApprovalRow,
  GuardianReviewRow,
  GovernorDecisionRow,
  MemoryItemRow,
  ImprovementRow,
  DailyLoopRunRow,
  GuardianFindingData,
} from "./schema";

export * from "./schema";
