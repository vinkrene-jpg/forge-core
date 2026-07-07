import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  introspectionSnapshotsTable,
  knowledgeNodesTable,
  knowledgeEdgesTable,
  capabilitiesTable,
  evolutionPlansTable,
  evolutionRunsTable,
  approvalsTable,
  proposalsTable,
  testRunsTable,
  modulesTable,
  guardianReviewsTable,
  tasksTable,
} from "@workspace/db";
import {
  RunIntrospectionResponse,
  GetSelfModelResponse,
  GetKnowledgeGraphResponse,
  ListCapabilitiesResponse,
  GetGapAnalysisResponse,
  CreateEvolutionPlanResponse,
  ListEvolutionPlansResponse,
  StartEvolutionRunResponse,
  ListEvolutionRunsResponse,
  GetEvolutionStatusResponse,
  CreateEvolutionPlanBody,
  GetEvolutionSchedulerResponse,
  ConfigureEvolutionSchedulerBody,
  ConfigureEvolutionSchedulerResponse,
} from "@workspace/api-zod";
import { executeEvolutionRun, RunInProgressError } from "../lib/evolutionLoop";
import { getSchedulerStatus, configureScheduler } from "../lib/evolutionScheduler";
import { jsonSafe } from "../lib/jsonSafe";
import { runIntrospection, refreshCapabilities, scanSelf } from "../lib/selfAwareness";
import { analyzeGaps } from "../lib/gapAnalysis";
import { createEvolutionPlan, NoGapError } from "../lib/evolutionPlanner";
import { generateProposal } from "../lib/proposalGenerator";
import { executeRealTestRun } from "../lib/realTestRunner";
import { runGuardian } from "../lib/guardian";
import { governInstall } from "../lib/governor";
import { storeLessons } from "../lib/selfLearning";
import { getProviders } from "../lib/aiGateway";
import { audit } from "../lib/audit";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/evolution/introspect", async (_req, res): Promise<void> => {
  const snapshot = await runIntrospection();
  res.status(201).json(RunIntrospectionResponse.parse(jsonSafe(snapshot)));
});

router.get("/evolution/self", async (_req, res): Promise<void> => {
  const [snapshot] = await db
    .select()
    .from(introspectionSnapshotsTable)
    .orderBy(desc(introspectionSnapshotsTable.createdAt))
    .limit(1);
  if (!snapshot) {
    res.status(404).json({ error: "No introspection has run yet. POST /evolution/introspect first." });
    return;
  }
  res.json(GetSelfModelResponse.parse(jsonSafe(snapshot)));
});

router.get("/evolution/graph", async (_req, res): Promise<void> => {
  const [snapshot] = await db
    .select()
    .from(introspectionSnapshotsTable)
    .orderBy(desc(introspectionSnapshotsTable.createdAt))
    .limit(1);
  if (!snapshot) {
    res.status(404).json({ error: "No introspection has run yet. POST /evolution/introspect first." });
    return;
  }
  const [nodes, edges] = await Promise.all([
    db.select().from(knowledgeNodesTable).where(eq(knowledgeNodesTable.snapshotId, snapshot.id)),
    db.select().from(knowledgeEdgesTable).where(eq(knowledgeEdgesTable.snapshotId, snapshot.id)),
  ]);
  res.json(
    GetKnowledgeGraphResponse.parse(
      jsonSafe({
        snapshotId: snapshot.id,
        nodes: nodes.map((n) => ({ nodeType: n.nodeType, key: n.key, label: n.label, meta: n.meta })),
        edges: edges.map((e) => ({ fromKey: e.fromKey, toKey: e.toKey, relation: e.relation })),
      }),
    ),
  );
});

router.get("/evolution/capabilities", async (_req, res): Promise<void> => {
  const rows = await db.select().from(capabilitiesTable).orderBy(capabilitiesTable.id);
  res.json(ListCapabilitiesResponse.parse(jsonSafe(rows)));
});

router.get("/evolution/gaps", async (_req, res): Promise<void> => {
  const analysis = await analyzeGaps();
  res.json(GetGapAnalysisResponse.parse(jsonSafe(analysis)));
});

router.post("/evolution/plan", async (req, res): Promise<void> => {
  const body = CreateEvolutionPlanBody.parse(req.body ?? {});
  try {
    const plan = await createEvolutionPlan({ capabilityKey: body.capabilityKey });
    res.status(201).json(CreateEvolutionPlanResponse.parse(jsonSafe(plan)));
  } catch (err) {
    if (err instanceof NoGapError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/evolution/plans", async (_req, res): Promise<void> => {
  const rows = await db.select().from(evolutionPlansTable).orderBy(desc(evolutionPlansTable.createdAt));
  res.json(ListEvolutionPlansResponse.parse(jsonSafe(rows)));
});

router.get("/evolution/runs", async (_req, res): Promise<void> => {
  const rows = await db.select().from(evolutionRunsTable).orderBy(desc(evolutionRunsTable.startedAt));
  res.json(ListEvolutionRunsResponse.parse(jsonSafe(rows)));
});

router.get("/evolution/status", async (_req, res): Promise<void> => {
  const [caps, [latestSnapshot], [latestRun], pending] = await Promise.all([
    db.select().from(capabilitiesTable),
    db.select().from(introspectionSnapshotsTable).orderBy(desc(introspectionSnapshotsTable.createdAt)).limit(1),
    db.select().from(evolutionRunsTable).orderBy(desc(evolutionRunsTable.startedAt)).limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvalsTable)
      .where(eq(approvalsTable.status, "pending")),
  ]);
  const gaps = caps.filter((c) => c.status !== "working").length;
  res.json(
    GetEvolutionStatusResponse.parse(
      jsonSafe({
        capabilities: {
          total: caps.length,
          working: caps.filter((c) => c.status === "working").length,
          partial: caps.filter((c) => c.status === "partial").length,
          missing: caps.filter((c) => c.status === "missing").length,
        },
        gaps,
        latestSnapshotId: latestSnapshot?.id ?? null,
        latestRun: latestRun ?? null,
        pendingApprovals: pending[0]?.n ?? 0,
        aiConfigured: getProviders().some((p) => p.configured),
      }),
    ),
  );
});

router.get("/evolution/scheduler", (_req, res): void => {
  res.json(GetEvolutionSchedulerResponse.parse(getSchedulerStatus()));
});

router.post("/evolution/scheduler", async (req, res): Promise<void> => {
  const body = ConfigureEvolutionSchedulerBody.parse(req.body ?? {});
  const status = await configureScheduler(body);
  res.json(ConfigureEvolutionSchedulerResponse.parse(status));
});

router.post("/evolution/run", async (req, res): Promise<void> => {
  try {
    const finished = await executeEvolutionRun("api");
    res.status(201).json(StartEvolutionRunResponse.parse(jsonSafe(finished)));
  } catch (err) {
    if (err instanceof RunInProgressError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
