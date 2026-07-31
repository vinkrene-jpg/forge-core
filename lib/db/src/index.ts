import fs from "node:fs";
import path from "node:path";
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

function resolveRepositorySqlitePath(repositoryRoot: string): string {
  const repositoryPath = path.resolve(repositoryRoot, "storage", "forge.sqlite");
  if (fs.existsSync(repositoryPath)) {
    return repositoryPath;
  }

  const sharedDataPath = path.resolve(repositoryRoot, "..", "storage", "forge.sqlite");
  return fs.existsSync(sharedDataPath) ? sharedDataPath : repositoryPath;
}

function findWorkspaceRoot(startDirectory: string): string {
  let current = path.resolve(startDirectory);

  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDirectory);
    current = parent;
  }
}

export function resolveSqlitePath(): string {
  const configured = process.env.FORGE_SQLITE_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const configuredStorage = process.env.STORAGE_DIR?.trim();
  if (configuredStorage) {
    return path.resolve(configuredStorage, "forge.sqlite");
  }

  const canonicalRoot = process.env.FORGE_CANONICAL_REPO_ROOT?.trim();
  if (canonicalRoot) {
    return resolveRepositorySqlitePath(path.resolve(canonicalRoot));
  }

  return resolveRepositorySqlitePath(findWorkspaceRoot(process.cwd()));
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
}

const sqliteClient = sqlitePath ? new Database(sqlitePath) : null;

export type DbClient = NodePgDatabase<typeof schema>;

export const db: DbClient = (isPostgres
  ? drizzlePg(pool!, { schema })
  : drizzleSqlite(sqliteClient!, {
      schema: sqliteSchema,
    })) as unknown as DbClient;

const tables: any = isPostgres ? schema : sqliteSchema;

export const coreComponentsTable = tables.coreComponentsTable as typeof schema.coreComponentsTable;
export const auditLogsTable = tables.auditLogsTable as typeof schema.auditLogsTable;
export const aiCallsTable = tables.aiCallsTable as typeof schema.aiCallsTable;
export const projectsTable = tables.projectsTable as typeof schema.projectsTable;
export const goalsTable = tables.goalsTable as typeof schema.goalsTable;
export const backlogItemsTable = tables.backlogItemsTable as typeof schema.backlogItemsTable;
export const tasksTable = tables.tasksTable as typeof schema.tasksTable;
export const decisionsTable = tables.decisionsTable as typeof schema.decisionsTable;
export const risksTable = tables.risksTable as typeof schema.risksTable;
export const modulesTable = tables.modulesTable as typeof schema.modulesTable;
export const moduleSnapshotsTable = tables.moduleSnapshotsTable as typeof schema.moduleSnapshotsTable;
export const sandboxesTable = tables.sandboxesTable as typeof schema.sandboxesTable;
export const sandboxFilesTable = tables.sandboxFilesTable as typeof schema.sandboxFilesTable;
export const proposalsTable = tables.proposalsTable as typeof schema.proposalsTable;
export const testRunsTable = tables.testRunsTable as typeof schema.testRunsTable;
export const testRunStepsTable = tables.testRunStepsTable as typeof schema.testRunStepsTable;
export const approvalsTable = tables.approvalsTable as typeof schema.approvalsTable;
export const guardianReviewsTable = tables.guardianReviewsTable as typeof schema.guardianReviewsTable;
export const governorDecisionsTable = tables.governorDecisionsTable as typeof schema.governorDecisionsTable;
export const memoryItemsTable = tables.memoryItemsTable as typeof schema.memoryItemsTable;
export const improvementsTable = tables.improvementsTable as typeof schema.improvementsTable;
export const dailyLoopRunsTable = tables.dailyLoopRunsTable as typeof schema.dailyLoopRunsTable;

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
