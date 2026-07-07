// Self Awareness: read-only introspection of Forge's own codebase, database
// and runtime state. Produces a persisted snapshot, rebuilds the knowledge
// graph and refreshes the capability map with fresh evidence.

import fs from "fs";
import path from "path";
import {
  db,
  introspectionSnapshotsTable,
  knowledgeNodesTable,
  knowledgeEdgesTable,
  capabilitiesTable,
  modulesTable,
  testRunsTable,
  auditLogsTable,
  proposalsTable,
  sandboxesTable,
  guardianReviewsTable,
  governorDecisionsTable,
  approvalsTable,
  moduleSnapshotsTable,
  memoryItemsTable,
  evolutionPlansTable,
  evolutionRunsTable,
  type IntrospectionSnapshotRow,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { audit } from "./audit";

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

export interface EndpointInfo {
  method: string;
  path: string;
  file: string;
}

export interface SelfModel {
  scannedAt: string;
  sourceFiles: string[];
  endpoints: EndpointInfo[];
  dbTables: { table: string; file: string }[];
  docs: string[];
  dependencies: string[];
  configKeys: string[];
  version: string;
  architecture: string[];
}

function listFilesRecursive(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(path.relative(workspaceRoot, full));
  }
  return out;
}

function safeRead(rel: string): string {
  try {
    return fs.readFileSync(path.join(workspaceRoot, rel), "utf8");
  } catch {
    return "";
  }
}

export function scanSelf(): SelfModel {
  const sourceDirs = [
    "artifacts/api-server/src",
    "artifacts/forge-core/src",
    "lib/db/src",
    "lib/api-spec",
    "lib/api-zod/src",
    "scripts/src",
  ];
  const sourceFiles = sourceDirs.flatMap((d) =>
    listFilesRecursive(path.join(workspaceRoot, d), [".ts", ".tsx", ".yaml", ".sh"]),
  );

  // Endpoints: parse Express route registrations in the API server routes.
  const endpoints: EndpointInfo[] = [];
  const routeFiles = sourceFiles.filter((f) => f.startsWith("artifacts/api-server/src/routes/"));
  const routeRe = /router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
  for (const f of routeFiles) {
    const content = safeRead(f);
    for (const m of content.matchAll(routeRe)) {
      endpoints.push({ method: m[1].toUpperCase(), path: `/api${m[2]}`, file: f });
    }
  }

  // Database tables: parse Drizzle pgTable declarations.
  const dbTables: { table: string; file: string }[] = [];
  const schemaFiles = sourceFiles.filter((f) => f.startsWith("lib/db/src/schema/"));
  const tableRe = /pgTable\(\s*"([^"]+)"/g;
  for (const f of schemaFiles) {
    const content = safeRead(f);
    for (const m of content.matchAll(tableRe)) {
      dbTables.push({ table: m[1], file: f });
    }
  }

  // Documentation: markdown files at the workspace root.
  const docs = fs
    .readdirSync(workspaceRoot)
    .filter((f) => f.endsWith(".md"))
    .sort();

  // Dependencies: API server + dashboard runtime deps.
  const dependencies: string[] = [];
  for (const pkg of ["artifacts/api-server/package.json", "artifacts/forge-core/package.json", "lib/db/package.json"]) {
    try {
      const parsed = JSON.parse(safeRead(pkg)) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(parsed.dependencies ?? {})) {
        if (!dependencies.includes(dep)) dependencies.push(dep);
      }
    } catch {
      /* ignore unparsable package.json */
    }
  }
  dependencies.sort();

  // Configuration keys from .env.example.
  const configKeys = safeRead(".env.example")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => l.split("=")[0])
    .sort();

  let version = "0.0.0";
  try {
    version = (JSON.parse(safeRead("package.json")) as { version?: string }).version ?? "0.0.0";
  } catch {
    /* keep default */
  }

  const architecture = [
    "pnpm monorepo: artifacts/api-server (Express 5 API), artifacts/forge-core (React dashboard), lib/db (Drizzle schema), lib/api-spec (OpenAPI contract), lib/api-zod (generated validation)",
    "Contract-first: OpenAPI spec drives codegen; server validates requests and responses with generated Zod schemas",
    "Governance pipeline: sandbox -> real test runner -> Guardian review -> Governor decision -> owner approval -> install with snapshot/rollback",
    "Locked Core Registry: protected components can never be modified autonomously",
    "AI Gateway: all AI calls via one gateway, providers configured via env",
  ];

  return {
    scannedAt: new Date().toISOString(),
    sourceFiles,
    endpoints,
    dbTables,
    docs,
    dependencies,
    configKeys,
    version,
    architecture,
  };
}

async function countRows(table: Parameters<typeof db.select>[0] extends never ? never : any): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
  return row?.n ?? 0;
}

async function buildKnowledgeGraph(snapshotId: number, model: SelfModel): Promise<{ nodes: number; edges: number }> {
  type NodeInput = { snapshotId: number; nodeType: string; key: string; label: string; meta: Record<string, unknown> };
  type EdgeInput = { snapshotId: number; fromKey: string; toKey: string; relation: string };
  const nodes: NodeInput[] = [];
  const edges: EdgeInput[] = [];
  const seen = new Set<string>();
  const addNode = (nodeType: string, key: string, label: string, meta: Record<string, unknown> = {}) => {
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push({ snapshotId, nodeType, key, label, meta });
  };

  addNode("service", "service:api-server", "API Server (Express 5)");
  addNode("service", "service:dashboard", "Forge Core Dashboard (React)");
  addNode("service", "service:database", "PostgreSQL database");
  addNode("doc", "spec:openapi", "OpenAPI contract (lib/api-spec/openapi.yaml)");
  edges.push({ snapshotId, fromKey: "service:api-server", toKey: "spec:openapi", relation: "implements" });
  edges.push({ snapshotId, fromKey: "service:dashboard", toKey: "spec:openapi", relation: "consumes" });

  for (const f of model.sourceFiles) {
    if (f.startsWith("artifacts/api-server/src/")) {
      addNode("file", `file:${f}`, f);
      edges.push({ snapshotId, fromKey: "service:api-server", toKey: `file:${f}`, relation: "contains" });
    }
  }
  for (const e of model.endpoints) {
    const key = `endpoint:${e.method} ${e.path}`;
    addNode("endpoint", key, `${e.method} ${e.path}`, { file: e.file });
    edges.push({ snapshotId, fromKey: `file:${e.file}`, toKey: key, relation: "defines" });
  }
  for (const t of model.dbTables) {
    addNode("table", `table:${t.table}`, t.table, { file: t.file });
    edges.push({ snapshotId, fromKey: "service:database", toKey: `table:${t.table}`, relation: "stores" });
    addNode("file", `file:${t.file}`, t.file);
    edges.push({ snapshotId, fromKey: `file:${t.file}`, toKey: `table:${t.table}`, relation: "defines" });
  }
  for (const d of model.docs) {
    addNode("doc", `doc:${d}`, d);
    edges.push({ snapshotId, fromKey: `doc:${d}`, toKey: "service:api-server", relation: "documents" });
  }
  for (const dep of model.dependencies) {
    addNode("dependency", `dep:${dep}`, dep);
    edges.push({ snapshotId, fromKey: "service:api-server", toKey: `dep:${dep}`, relation: "depends_on" });
  }

  const chunk = 500;
  for (let i = 0; i < nodes.length; i += chunk) await db.insert(knowledgeNodesTable).values(nodes.slice(i, i + chunk));
  for (let i = 0; i < edges.length; i += chunk) await db.insert(knowledgeEdgesTable).values(edges.slice(i, i + chunk));
  return { nodes: nodes.length, edges: edges.length };
}

export interface CapabilitySeed {
  key: string;
  name: string;
  description: string;
  dependencies: string[];
}

export const CAPABILITY_SEEDS: CapabilitySeed[] = [
  { key: "self_awareness", name: "Self Awareness", description: "Read and understand own source, architecture, endpoints, tables, config, docs, dependencies, tests and history.", dependencies: [] },
  { key: "knowledge_graph", name: "Knowledge Graph", description: "Relations between modules, files, services, APIs, database, docs, tests and dependencies, usable for analysis and planning.", dependencies: ["self_awareness"] },
  { key: "capability_map", name: "Capability Map", description: "Own capabilities with status, maturity, dependencies, limitations and evidence.", dependencies: ["self_awareness"] },
  { key: "gap_analysis", name: "Gap Analysis", description: "Determine which capability is missing, why, what blocks evolution and what yields the most progress.", dependencies: ["capability_map"] },
  { key: "autonomous_planning", name: "Autonomous Planning", description: "Decide the next development step: modules, files, risk, priority, order, test strategy, rollback strategy.", dependencies: ["gap_analysis"] },
  { key: "proposal_generation", name: "Proposal Generation", description: "Generate design, implementation plan, code, docs and tests — sandbox only.", dependencies: ["autonomous_planning"] },
  { key: "sandbox_development", name: "Sandbox Development", description: "All generated files land in an assigned sandbox; no writes outside it, no direct installs.", dependencies: [] },
  { key: "real_testing", name: "Real Test Execution", description: "Actually execute lint/typecheck/unit tests against sandbox code.", dependencies: ["sandbox_development"] },
  { key: "ai_review", name: "Guardian Review", description: "Independent AI/rule-based review of modules before installation.", dependencies: [] },
  { key: "governance", name: "Governor Decisions", description: "Automated install decisions based on tests, review and risk; blocked installs stay blocked.", dependencies: ["real_testing", "ai_review"] },
  { key: "owner_approval", name: "Owner Approval", description: "Human approval gate for anything that is not low-risk-all-green.", dependencies: ["governance"] },
  { key: "rollback", name: "Rollback", description: "Snapshot before install; restore on demand.", dependencies: ["governance"] },
  { key: "audit_logging", name: "Audit Logging", description: "Every relevant action leaves an audit trail.", dependencies: [] },
  { key: "self_learning", name: "Self Learning", description: "Store lessons after each iteration and feed them back into future planning and proposals.", dependencies: [] },
  { key: "evolution_loop", name: "Recursive Evolution Loop", description: "Repeatable observe→plan→generate→test→review→govern→learn cycle without external development orders.", dependencies: ["self_awareness", "gap_analysis", "autonomous_planning", "proposal_generation", "self_learning"] },
];

interface EvidenceCounts {
  snapshots: number;
  nodes: number;
  capabilities: number;
  plans: number;
  proposals: number;
  sandboxes: number;
  testRuns: number;
  guardianReviews: number;
  governorDecisions: number;
  approvals: number;
  moduleSnapshots: number;
  auditEntries: number;
  memoryItems: number;
  evolutionRuns: number;
}

function hasEndpoint(model: SelfModel, method: string, p: string): boolean {
  return model.endpoints.some((e) => e.method === method && e.path === p);
}

export function assessCapability(
  seed: CapabilitySeed,
  model: SelfModel,
  counts: EvidenceCounts,
): { status: "missing" | "partial" | "working"; maturity: number; missingParts: string[]; evidence: string[]; limitations: string | null } {
  const evidence: string[] = [];
  const missingParts: string[] = [];
  let implemented = false;
  let used = false;
  let limitations: string | null = null;

  const need = (cond: boolean, ev: string, missing: string) => {
    if (cond) evidence.push(ev);
    else missingParts.push(missing);
    return cond;
  };

  switch (seed.key) {
    case "self_awareness":
      implemented = need(hasEndpoint(model, "POST", "/api/evolution/introspect"), "endpoint POST /api/evolution/introspect", "introspection endpoint");
      used = need(counts.snapshots > 0, `${counts.snapshots} introspection snapshot(s) in DB`, "no snapshot ever taken");
      break;
    case "knowledge_graph":
      implemented = need(hasEndpoint(model, "GET", "/api/evolution/graph"), "endpoint GET /api/evolution/graph", "graph endpoint");
      used = need(counts.nodes > 0, `${counts.nodes} knowledge node(s) stored`, "graph never built");
      break;
    case "capability_map":
      implemented = need(hasEndpoint(model, "GET", "/api/evolution/capabilities"), "endpoint GET /api/evolution/capabilities", "capability endpoint");
      used = need(counts.capabilities > 0, `${counts.capabilities} capability record(s)`, "capability map never refreshed");
      break;
    case "gap_analysis":
      implemented = need(hasEndpoint(model, "GET", "/api/evolution/gaps"), "endpoint GET /api/evolution/gaps", "gap analysis endpoint");
      used = counts.capabilities > 0;
      if (used) evidence.push("computed live from the capability map");
      break;
    case "autonomous_planning":
      implemented = need(hasEndpoint(model, "POST", "/api/evolution/plan"), "endpoint POST /api/evolution/plan", "planner endpoint");
      used = need(counts.plans > 0, `${counts.plans} evolution plan(s) created`, "no plan ever generated");
      break;
    case "proposal_generation":
      implemented = need(hasEndpoint(model, "POST", "/api/proposals/generate"), "endpoint POST /api/proposals/generate", "proposal generator endpoint");
      used = need(counts.proposals > 0, `${counts.proposals} proposal(s) recorded`, "no proposal ever generated");
      limitations = "Requires a configured AI provider (OPENAI_API_KEY / ANTHROPIC_API_KEY / CUSTOM_AI_*).";
      break;
    case "sandbox_development":
      implemented = need(model.endpoints.some((e) => e.path.startsWith("/api/sandboxes")), "sandbox endpoints present", "sandbox endpoints");
      used = need(counts.sandboxes > 0, `${counts.sandboxes} sandbox(es) in DB`, "no sandbox ever created");
      break;
    case "real_testing":
      implemented = need(model.sourceFiles.includes("artifacts/api-server/src/lib/realTestRunner.ts"), "realTestRunner.ts present", "real test runner");
      used = need(counts.testRuns > 0, `${counts.testRuns} test run(s) recorded`, "no test run ever executed");
      break;
    case "ai_review":
      implemented = need(model.sourceFiles.includes("artifacts/api-server/src/lib/guardian.ts"), "guardian.ts present", "guardian reviewer");
      used = need(counts.guardianReviews > 0, `${counts.guardianReviews} Guardian review(s)`, "no review ever run");
      break;
    case "governance":
      implemented = need(model.sourceFiles.includes("artifacts/api-server/src/lib/governor.ts"), "governor.ts present", "governor");
      used = need(counts.governorDecisions > 0, `${counts.governorDecisions} Governor decision(s)`, "no decision ever taken");
      break;
    case "owner_approval":
      implemented = need(model.endpoints.some((e) => e.path.startsWith("/api/approvals")), "approval endpoints present", "approval endpoints");
      used = need(counts.approvals > 0, `${counts.approvals} approval record(s)`, "no approval ever created");
      break;
    case "rollback":
      implemented = need(model.endpoints.some((e) => e.path.includes("rollback")), "rollback endpoint present", "rollback endpoint");
      used = need(counts.moduleSnapshots > 0, `${counts.moduleSnapshots} module snapshot(s)`, "no snapshot ever taken");
      break;
    case "audit_logging":
      implemented = need(model.endpoints.some((e) => e.path.startsWith("/api/audit-logs")), "audit log endpoint present", "audit endpoint");
      used = need(counts.auditEntries > 0, `${counts.auditEntries} audit entries`, "audit trail empty");
      break;
    case "self_learning":
      implemented = need(model.endpoints.some((e) => e.path.startsWith("/api/memory")), "memory endpoints present", "memory engine");
      used = need(counts.memoryItems > 0, `${counts.memoryItems} memory item(s) stored`, "no lessons stored");
      break;
    case "evolution_loop":
      implemented = need(hasEndpoint(model, "POST", "/api/evolution/run"), "endpoint POST /api/evolution/run", "evolution run endpoint");
      used = need(counts.evolutionRuns > 0, `${counts.evolutionRuns} evolution run(s) executed`, "loop never executed");
      limitations = "Full loop through proposal generation requires a configured AI provider.";
      break;
  }

  const status: "missing" | "partial" | "working" = implemented && used ? "working" : implemented ? "partial" : "missing";
  const maturity = implemented ? (used ? 80 + Math.min(20, evidence.length * 5) : 40) : 0;
  return { status, maturity: Math.min(100, maturity), missingParts, evidence, limitations };
}

export async function refreshCapabilities(model: SelfModel): Promise<void> {
  const counts: EvidenceCounts = {
    snapshots: await countRows(introspectionSnapshotsTable),
    nodes: await countRows(knowledgeNodesTable),
    // Count the seeds themselves: this refresh pass is about to upsert every
    // seed, so the capability map exists by the end of this call even on the
    // very first bootstrap run.
    capabilities: Math.max(await countRows(capabilitiesTable), CAPABILITY_SEEDS.length),
    plans: await countRows(evolutionPlansTable),
    proposals: await countRows(proposalsTable),
    sandboxes: await countRows(sandboxesTable),
    testRuns: await countRows(testRunsTable),
    guardianReviews: await countRows(guardianReviewsTable),
    governorDecisions: await countRows(governorDecisionsTable),
    approvals: await countRows(approvalsTable),
    moduleSnapshots: await countRows(moduleSnapshotsTable),
    auditEntries: await countRows(auditLogsTable),
    memoryItems: await countRows(memoryItemsTable),
    evolutionRuns: await countRows(evolutionRunsTable),
  };

  for (const seed of CAPABILITY_SEEDS) {
    const a = assessCapability(seed, model, counts);
    const values = {
      key: seed.key,
      name: seed.name,
      description: seed.description,
      dependencies: seed.dependencies,
      status: a.status,
      maturity: a.maturity,
      missingParts: a.missingParts,
      evidence: a.evidence,
      limitations: a.limitations,
      updatedAt: new Date(),
    };
    const existing = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.key, seed.key));
    if (existing.length > 0) {
      await db.update(capabilitiesTable).set(values).where(eq(capabilitiesTable.key, seed.key));
    } else {
      await db.insert(capabilitiesTable).values(values);
    }
  }
}

export async function runIntrospection(): Promise<IntrospectionSnapshotRow> {
  const model = scanSelf();

  const dbCounts = {
    modules: await countRows(modulesTable),
    testRuns: await countRows(testRunsTable),
    auditEntries: await countRows(auditLogsTable),
  };

  const [snapshot] = await db
    .insert(introspectionSnapshotsTable)
    .values({
      sourceFiles: model.sourceFiles.length,
      endpoints: model.endpoints.length,
      dbTables: model.dbTables.length,
      docs: model.docs.length,
      dependencies: model.dependencies.length,
      configKeys: model.configKeys.length,
      modules: dbCounts.modules,
      testRuns: dbCounts.testRuns,
      auditEntries: dbCounts.auditEntries,
      model: model as unknown as Record<string, unknown>,
    })
    .returning();

  const graph = await buildKnowledgeGraph(snapshot.id, model);
  await refreshCapabilities(model);

  await audit({
    actor: "self-awareness",
    action: "introspection_completed",
    targetType: "introspection-snapshot",
    targetId: snapshot.id,
    details: `Scanned ${model.sourceFiles.length} files, ${model.endpoints.length} endpoints, ${model.dbTables.length} tables; graph: ${graph.nodes} nodes / ${graph.edges} edges; capability map refreshed (${CAPABILITY_SEEDS.length} capabilities)`,
  });

  return snapshot;
}
