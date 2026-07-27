# Forge Mirror / MCP - inventarisatie

Gegenereerd: 2026-07-27 21:11:44
Branch: forge-sync-primary

## Doel

Deze inventarisatie bepaalt welke bestaande Forge-onderdelen worden hergebruikt voor de Mirror/MCP-besturingslaag. Er wordt geen parallel chat-, geheugen-, dashboard- of governance-systeem gebouwd.

## Bestaande onderdelen die worden hergebruikt

### 1. Mission Control en runtime-overzicht

De bestaande dashboardpagina gebruikt al live runtime-, missie- en goedkeuringsdata. Dit wordt de visuele basis voor de Mirror-weergave.

``text
artifacts/forge-core/src/pages/dashboard.tsx:11: useApprovalsQuery,
artifacts/forge-core/src/pages/dashboard.tsx:12: useMissionsQuery,
artifacts/forge-core/src/pages/dashboard.tsx:13: useRuntimeQuery,
artifacts/forge-core/src/pages/dashboard.tsx:77: const runtime = useRuntimeQuery();
artifacts/forge-core/src/pages/dashboard.tsx:78: const missions = useMissionsQuery();
artifacts/forge-core/src/pages/dashboard.tsx:79: const approvals = useApprovalsQuery();
artifacts/forge-core/src/pages/dashboard.tsx:143: value: String(snapshot.governance.pending),
artifacts/forge-core/src/pages/dashboard.tsx:144: detail: `${snapshot.governance.approved} approved Ã‚Â· ${snapshot.governance.rejected} rejected`,
artifacts/forge-core/src/pages/dashboard.tsx:163: Forge Mission Control
artifacts/forge-core/src/pages/dashboard.tsx:204: Recent missions
artifacts/forge-core/src/pages/dashboard.tsx:247: Governance
artifacts/forge-core/src/pages/dashboard.tsx:262: Governance queue is clear.
``

Besluit:
- bestaande dashboardkaarten en query-hooks behouden;
- Mirror als afzonderlijke pagina binnen dezelfde applicatie toevoegen;
- samenvatting van de actieve Mirror-sessie later ook op Mission Control tonen.

### 2. Bestaande routering en navigatie

De huidige app-routering en layout worden uitgebreid. Er komt geen tweede frontend of los bedieningspaneel.

``text
artifacts/forge-core/src/App.tsx:6: Route,
artifacts/forge-core/src/App.tsx:7: Router as WouterRouter,
artifacts/forge-core/src/App.tsx:13: import Dashboard from "@/pages/dashboard";
artifacts/forge-core/src/App.tsx:15: import Missions from "@/pages/missions-live";
artifacts/forge-core/src/App.tsx:16: import Approvals from "@/pages/approvals";
artifacts/forge-core/src/App.tsx:45: function Router() {
artifacts/forge-core/src/App.tsx:49: <Route path="/" component={MissionConsolePage} />
artifacts/forge-core/src/App.tsx:50: <Route path="/runtime" component={Dashboard} />
artifacts/forge-core/src/App.tsx:51: <Route path="/missions" component={Missions} />
artifacts/forge-core/src/App.tsx:52: <Route path="/approvals" component={Approvals} />
artifacts/forge-core/src/App.tsx:53: <Route path="/capabilities" component={Capabilities} />
artifacts/forge-core/src/App.tsx:54: <Route path="/evolution" component={Evolution} />
artifacts/forge-core/src/App.tsx:55: <Route path="/learning" component={Learning} />
artifacts/forge-core/src/App.tsx:56: <Route path="/autonomy" component={AutonomyLive} />
artifacts/forge-core/src/App.tsx:57: <Route path="/events" component={Events} />
artifacts/forge-core/src/App.tsx:58: <Route path="/operator" component={OperatorCorePage} />
artifacts/forge-core/src/App.tsx:60: <Route path="/projects" component={Projects} />
artifacts/forge-core/src/App.tsx:61: <Route path="/tasks" component={Tasks} />
artifacts/forge-core/src/App.tsx:62: <Route path="/modules" component={Modules} />
artifacts/forge-core/src/App.tsx:63: <Route path="/sandboxes" component={Sandboxes} />
artifacts/forge-core/src/App.tsx:64: <Route path="/tests" component={Tests} />
artifacts/forge-core/src/App.tsx:65: <Route path="/ai-gateway" component={AiGateway} />
artifacts/forge-core/src/App.tsx:66: <Route path="/memory" component={Memory} />
artifacts/forge-core/src/App.tsx:67: <Route path="/improvements" component={Evolution} />
artifacts/forge-core/src/App.tsx:68: <Route path="/daily-loop" component={DailyLoop} />
artifacts/forge-core/src/App.tsx:69: <Route path="/core" component={CoreComponents} />
artifacts/forge-core/src/App.tsx:70: <Route path="/audit" component={AuditLogs} />
artifacts/forge-core/src/App.tsx:71: <Route component={NotFound} />
artifacts/forge-core/src/App.tsx:81: <WouterRouter
artifacts/forge-core/src/App.tsx:84: <Router />
artifacts/forge-core/src/App.tsx:85: </WouterRouter>
artifacts/forge-core/src/components/layout.tsx:13: LayoutDashboard,
artifacts/forge-core/src/components/layout.tsx:27: { href: "/runtime", label: "Runtime", icon: LayoutDashboard },
artifacts/forge-core/src/components/layout.tsx:29: { href: "/missions", label: "Missions", icon: ListChecks },
artifacts/forge-core/src/components/layout.tsx:30: { href: "/approvals", label: "Approvals", icon: ShieldCheck },
artifacts/forge-core/src/components/layout.tsx:51: function NavigationGroup({
artifacts/forge-core/src/components/layout.tsx:114: <aside className="flex w-72 flex-shrink-0 flex-col border-r border-border bg-sidebar">
artifacts/forge-core/src/components/layout.tsx:130: <NavigationGroup
artifacts/forge-core/src/components/layout.tsx:135: <NavigationGroup
``

Besluit:
- route /mirror toevoegen aan de bestaande app;
- navigatie-item toevoegen aan de bestaande layout;
- bestaande UI-componenten en stijlafspraken gebruiken.

### 3. API-server en route-registratie

De Mirror-API wordt geregistreerd via de bestaande API-server en route-index.

``text
artifacts/api-server/src/routes/index.ts:1: import { Router, type IRouter } from "express";
artifacts/api-server/src/routes/index.ts:2: import healthRouter from "./health";
artifacts/api-server/src/routes/index.ts:3: import runtimeRouter from "./runtime";
artifacts/api-server/src/routes/index.ts:4: import missionsRouter from "./missions";
artifacts/api-server/src/routes/index.ts:5: import runtimeGovernanceRouter from "./runtimeGovernance";
artifacts/api-server/src/routes/index.ts:6: import capabilitiesRouter from "./capabilities";
artifacts/api-server/src/routes/index.ts:7: import operatorRouter from "./operator";
artifacts/api-server/src/routes/index.ts:8: import aiGatewayLiveRouter from "./aiGatewayLive";
artifacts/api-server/src/routes/index.ts:9: import learningRouter from "./learning";
artifacts/api-server/src/routes/index.ts:10: import dashboardRouter from "./dashboard";
artifacts/api-server/src/routes/index.ts:11: import coreRouter from "./core";
artifacts/api-server/src/routes/index.ts:12: import aiRouter from "./ai";
artifacts/api-server/src/routes/index.ts:13: import projectsRouter from "./projects";
artifacts/api-server/src/routes/index.ts:14: import tasksRouter from "./tasks";
artifacts/api-server/src/routes/index.ts:15: import modulesRouter from "./modules";
artifacts/api-server/src/routes/index.ts:16: import sandboxesRouter from "./sandboxes";
artifacts/api-server/src/routes/index.ts:17: import governanceRouter from "./governance";
artifacts/api-server/src/routes/index.ts:18: import memoryRouter from "./memory";
artifacts/api-server/src/routes/index.ts:19: import dailyLoopRouter from "./dailyLoop";
artifacts/api-server/src/routes/index.ts:20: import proposalsRouter from "./proposals";
artifacts/api-server/src/routes/index.ts:21: import evolutionRouter from "./evolution";
artifacts/api-server/src/routes/index.ts:22: import analysisRouter from "./analysis";
artifacts/api-server/src/routes/index.ts:23: import autonomyRouter from "./autonomy";
artifacts/api-server/src/routes/index.ts:24: import memoryBridgeRouter from "./memoryBridge";
artifacts/api-server/src/routes/index.ts:26: const router: IRouter = Router();
artifacts/api-server/src/routes/index.ts:28: router.use(healthRouter);
artifacts/api-server/src/routes/index.ts:29: router.use(runtimeRouter);
artifacts/api-server/src/routes/index.ts:30: router.use(missionsRouter);
artifacts/api-server/src/routes/index.ts:31: router.use(runtimeGovernanceRouter);
artifacts/api-server/src/routes/index.ts:32: router.use(capabilitiesRouter);
artifacts/api-server/src/routes/index.ts:33: router.use(operatorRouter);
artifacts/api-server/src/routes/index.ts:34: router.use(aiGatewayLiveRouter);
artifacts/api-server/src/routes/index.ts:35: router.use(learningRouter);
artifacts/api-server/src/routes/index.ts:36: router.use(dashboardRouter);
artifacts/api-server/src/routes/index.ts:37: router.use(coreRouter);
artifacts/api-server/src/routes/index.ts:38: router.use(aiRouter);
artifacts/api-server/src/routes/index.ts:39: router.use(projectsRouter);
artifacts/api-server/src/routes/index.ts:40: router.use(tasksRouter);
artifacts/api-server/src/routes/index.ts:41: router.use(modulesRouter);
artifacts/api-server/src/routes/index.ts:42: router.use(sandboxesRouter);
artifacts/api-server/src/routes/index.ts:43: router.use(governanceRouter);
artifacts/api-server/src/routes/index.ts:44: router.use(memoryRouter);
artifacts/api-server/src/routes/index.ts:45: router.use(dailyLoopRouter);
artifacts/api-server/src/routes/index.ts:46: router.use(proposalsRouter);
artifacts/api-server/src/routes/index.ts:47: router.use(evolutionRouter);
artifacts/api-server/src/routes/index.ts:48: router.use(analysisRouter);
artifacts/api-server/src/routes/index.ts:49: router.use(autonomyRouter);
artifacts/api-server/src/routes/index.ts:50: router.use(memoryBridgeRouter);
artifacts/api-server/src/routes/index.ts:52: export default router;
``

Besluit:
- nieuwe routegroep binnen rtifacts/api-server/src/routes;
- geen aparte server, poort of runtime;
- bestaande foutafhandeling, audit en databaseverbinding hergebruiken.

### 4. Zelfmodel en self-awareness

Forge bevat al een zelfmodel en self-awareness-logica. Mirror moet deze informatie zichtbaar maken in plaats van opnieuw te berekenen in een parallel systeem.

``text
artifacts/api-server/src/lib/selfAwareness.ts:1: // Self Awareness: read-only introspection of Forge's own codebase, database
artifacts/api-server/src/lib/selfAwareness.ts:3: // graph and refreshes the capability map with fresh evidence.
artifacts/api-server/src/lib/selfAwareness.ts:12: capabilitiesTable,
artifacts/api-server/src/lib/selfAwareness.ts:34: export interface EndpointInfo {
artifacts/api-server/src/lib/selfAwareness.ts:40: export interface SelfModel {
artifacts/api-server/src/lib/selfAwareness.ts:71: export function scanSelf(): SelfModel {
artifacts/api-server/src/lib/selfAwareness.ts:167: async function buildKnowledgeGraph(snapshotId: number, model: SelfModel): Promise<{ nodes: number; edges: number }> {
artifacts/api-server/src/lib/selfAwareness.ts:218: export interface CapabilitySeed {
artifacts/api-server/src/lib/selfAwareness.ts:225: export const CAPABILITY_SEEDS: CapabilitySeed[] = [
artifacts/api-server/src/lib/selfAwareness.ts:226: { key: "self_awareness", name: "Self Awareness", description: "Read and understand own source, architecture, endpoints, tables, config, docs, dependencies, tests and history.", dependencies: [] },
artifacts/api-server/src/lib/selfAwareness.ts:227: { key: "knowledge_graph", name: "Knowledge Graph", description: "Relations between modules, files, services, APIs, database, docs, tests and dependencies, usable for analysis and planning.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:228: { key: "capability_map", name: "Capability Map", description: "Own capabilities with status, maturity, dependencies, limitations and evidence.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:229: { key: "gap_analysis", name: "Gap Analysis", description: "Determine which capability is missing, why, what blocks evolution and what yields the most progress.", dependencies: ["capability_map"] },
artifacts/api-server/src/lib/selfAwareness.ts:230: { key: "autonomous_planning", name: "Autonomous Planning", description: "Decide the next development step: modules, files, risk, priority, order, test strategy, rollback strategy.", dependencies: ["gap_analysis"] },
artifacts/api-server/src/lib/selfAwareness.ts:235: { key: "governance", name: "Governor Decisions", description: "Automated install decisions based on tests, review and risk; blocked installs stay blocked.", dependencies: ["real_testing", "ai_review"] },
artifacts/api-server/src/lib/selfAwareness.ts:236: { key: "owner_approval", name: "Owner Approval", description: "Human approval gate for anything that is not low-risk-all-green.", dependencies: ["governance"] },
artifacts/api-server/src/lib/selfAwareness.ts:239: { key: "self_learning", name: "Self Learning", description: "Store lessons after each iteration and feed them back into future planning and proposals.", dependencies: [] },
artifacts/api-server/src/lib/selfAwareness.ts:240: { key: "evolution_loop", name: "Recursive Evolution Loop", description: "Repeatable observeâ†’planâ†’generateâ†’testâ†’reviewâ†’governâ†’learn cycle without external development orders.", dependencies: ["self_awareness", "gap_analysis", "autonomous_planning", "proposal_generation", "self_learning"] },
artifacts/api-server/src/lib/selfAwareness.ts:243: { key: "quality_analysis", name: "Quality Analyzer", description: "Static quality metrics over own source: oversized files, weak typing, logging discipline; produces a scored report.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:244: { key: "technical_debt_analysis", name: "Technical Debt Analyzer", description: "Detects debt signals: TODO/FIXME markers, skipped tests, deprecated code, oversized modules, duplicate routes.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:245: { key: "dependency_analysis", name: "Dependency Analyzer", description: "Maps every workspace dependency to its users and flags version mismatches across packages.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:246: { key: "architecture_validation", name: "Architecture Validator", description: "Validates architecture rules against the live self-model: router registration, jsonSafe usage, logging discipline, locked-core and governance chain presence.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:248: { key: "roadmap_generation", name: "Roadmap Generator", description: "Composes a ranked evolution roadmap from capability gaps, planned backlog tasks, open improvements and critical debt.", dependencies: ["gap_analysis"] },
artifacts/api-server/src/lib/selfAwareness.ts:249: { key: "knowledge_base", name: "Internal Knowledge Base", description: "Unified search over knowledge graph, memory engine, capability map, documentation and audit trail.", dependencies: ["knowledge_graph", "self_learning"] },
artifacts/api-server/src/lib/selfAwareness.ts:250: { key: "documentation_generation", name: "Documentation Generator", description: "Generates SELF_MODEL.md from the live self-model, capability map and installed modules.", dependencies: ["self_awareness"] },
artifacts/api-server/src/lib/selfAwareness.ts:256: capabilities: number;
artifacts/api-server/src/lib/selfAwareness.ts:269: /** Audit-log entry count per action, used as usage evidence for tooling capabilities. */
artifacts/api-server/src/lib/selfAwareness.ts:273: function hasEndpoint(model: SelfModel, method: string, p: string): boolean {
artifacts/api-server/src/lib/selfAwareness.ts:277: export function assessCapability(
artifacts/api-server/src/lib/selfAwareness.ts:278: seed: CapabilitySeed,
artifacts/api-server/src/lib/selfAwareness.ts:279: model: SelfModel,
artifacts/api-server/src/lib/selfAwareness.ts:281: ): { status: "missing" | "partial" | "working"; maturity: number; missingParts: string[]; evidence: string[]; limitations: string | null } {
artifacts/api-server/src/lib/selfAwareness.ts:286: let limitations: string | null = null;
artifacts/api-server/src/lib/selfAwareness.ts:295: case "self_awareness":
artifacts/api-server/src/lib/selfAwareness.ts:303: case "capability_map":
artifacts/api-server/src/lib/selfAwareness.ts:304: implemented = need(hasEndpoint(model, "GET", "/api/evolution/capabilities"), "endpoint GET /api/evolution/capabilities", "capability endpoint");
artifacts/api-server/src/lib/selfAwareness.ts:305: used = need(counts.capabilities > 0, `${counts.capabilities} capability record(s)`, "capability map never refreshed");
artifacts/api-server/src/lib/selfAwareness.ts:309: used = counts.capabilities > 0;
artifacts/api-server/src/lib/selfAwareness.ts:310: if (used) evidence.push("computed live from the capability map");
artifacts/api-server/src/lib/selfAwareness.ts:319: limitations = "Requires a configured AI provider (OPENAI_API_KEY / ANTHROPIC_API_KEY / CUSTOM_AI_*).";
artifacts/api-server/src/lib/selfAwareness.ts:349: case "self_learning":
artifacts/api-server/src/lib/selfAwareness.ts:356: limitations = "Full loop through proposal generation requires a configured AI provider.";
artifacts/api-server/src/lib/selfAwareness.ts:361: limitations = "Local operation only: never performs production or VPS actions and never prints secrets.";
artifacts/api-server/src/lib/selfAwareness.ts:366: limitations = "Disabled by default; scheduled runs still require an AI provider to pass the generate phase.";
artifacts/api-server/src/lib/selfAwareness.ts:387: limitations = "Never changes code directly: findings become improvements that pass the normal governance pipeline.";
artifacts/api-server/src/lib/selfAwareness.ts:405: return { status, maturity: Math.min(100, maturity), missingParts, evidence, limitations };
artifacts/api-server/src/lib/selfAwareness.ts:408: export async function refreshCapabilities(model: SelfModel): Promise<void> {
artifacts/api-server/src/lib/selfAwareness.ts:413: // seed, so the capability map exists by the end of this call even on the
artifacts/api-server/src/lib/selfAwareness.ts:415: capabilities: Math.max(await countRows(capabilitiesTable), CAPABILITY_SEEDS.length),
artifacts/api-server/src/lib/selfAwareness.ts:443: for (const seed of CAPABILITY_SEEDS) {
artifacts/api-server/src/lib/selfAwareness.ts:444: const a = assessCapability(seed, model, counts);
artifacts/api-server/src/lib/selfAwareness.ts:454: limitations: a.limitations,
artifacts/api-server/src/lib/selfAwareness.ts:457: const existing = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.key, seed.key));
artifacts/api-server/src/lib/selfAwareness.ts:459: await db.update(capabilitiesTable).set(values).where(eq(capabilitiesTable.key, seed.key));
artifacts/api-server/src/lib/selfAwareness.ts:461: await db.insert(capabilitiesTable).values(values);
artifacts/api-server/src/lib/selfAwareness.ts:466: export async function runIntrospection(): Promise<IntrospectionSnapshotRow> {
artifacts/api-server/src/lib/selfAwareness.ts:467: const model = scanSelf();
artifacts/api-server/src/lib/selfAwareness.ts:492: await refreshCapabilities(model);
artifacts/api-server/src/lib/selfAwareness.ts:495: actor: "self-awareness",
artifacts/api-server/src/lib/selfAwareness.ts:499: details: `Scanned ${model.sourceFiles.length} files, ${model.endpoints.length} endpoints, ${model.dbTables.length} tables; graph: ${graph.nodes} nodes / ${graph.edges} edges; capability map refreshed (${CAPABILITY_SEEDS.length} capabilities)`,
``

Besluit:
- bestaande capability-, limitation-, confidence- en risicobronnen hergebruiken;
- Mirror slaat vast welke zelfmodelinformatie bij een besluit is gebruikt;
- Mirror mag geen verborgen, niet-herleidbare zelfbeoordeling tonen.

### 5. OpenAPI en gegenereerde clients

De bestaande contract-first route blijft leidend.

``text
lib/api-spec/openapi.yaml:12: - name: dashboard
lib/api-spec/openapi.yaml:21: - name: approvals
lib/api-spec/openapi.yaml:47: /dashboard/summary:
lib/api-spec/openapi.yaml:49: operationId: getDashboardSummary
lib/api-spec/openapi.yaml:50: tags: [dashboard]
lib/api-spec/openapi.yaml:51: summary: Full dashboard overview
lib/api-spec/openapi.yaml:58: $ref: "#/components/schemas/DashboardSummary"
lib/api-spec/openapi.yaml:1040: /approvals:
lib/api-spec/openapi.yaml:1042: operationId: listApprovals
lib/api-spec/openapi.yaml:1043: tags: [approvals]
lib/api-spec/openapi.yaml:1044: summary: List approval requests
lib/api-spec/openapi.yaml:1052: description: Approvals
lib/api-spec/openapi.yaml:1058: $ref: "#/components/schemas/Approval"
lib/api-spec/openapi.yaml:1059: /approvals/{id}/decide:
lib/api-spec/openapi.yaml:1061: operationId: decideApproval
lib/api-spec/openapi.yaml:1062: tags: [approvals]
lib/api-spec/openapi.yaml:1063: summary: Approve or reject an approval request
lib/api-spec/openapi.yaml:1074: $ref: "#/components/schemas/ApprovalDecision"
lib/api-spec/openapi.yaml:1081: $ref: "#/components/schemas/Approval"
lib/api-spec/openapi.yaml:1285: owner approval) remains mandatory.
lib/api-spec/openapi.yaml:1315: summary: Analyze Forge's own codebase, database and runtime state
lib/api-spec/openapi.yaml:1633: DashboardSummary:
lib/api-spec/openapi.yaml:1642: - pendingApprovals
lib/api-spec/openapi.yaml:1656: pendingApprovals: { type: integer }
lib/api-spec/openapi.yaml:1954: required: [module, testRuns, guardianReviews, governorDecisions, approvals, snapshots]
lib/api-spec/openapi.yaml:1970: approvals:
lib/api-spec/openapi.yaml:1973: $ref: "#/components/schemas/Approval"
lib/api-spec/openapi.yaml:2138: Approval:
lib/api-spec/openapi.yaml:2153: ApprovalDecision:
lib/api-spec/openapi.yaml:2372: required: [capabilities, gaps, latestSnapshotId, latestRun, pendingApprovals, aiConfigured]
lib/api-spec/openapi.yaml:2388: pendingApprovals: { type: integer }
lib/api-spec/openapi.yaml:2458: approvalsRequested: { type: ["integer", "null"] }
``

Besluit:
- Mirror-endpoints eerst in lib/api-spec/openapi.yaml;
- daarna bestaande generatieketen gebruiken;
- frontend gebruikt de gegenereerde client en React-querylaag;
- geen handgeschreven parallel API-contract.

## Ontbrekende bouwdelen

De volgende onderdelen bestaan nog niet als Ã©Ã©n samenhangende Mirror-laag:

1. Mirror-sessie met eigenaar, doel, status en tijdlijn.
2. Vastlegging van oorspronkelijke gebruikersinvoer.
3. Forge-interpretatie van die invoer.
4. Gebruikte context- en geheugenreferenties.
5. Aannames, onzekerheden en open vragen.
6. Gekozen aanpak en verwachte acceptatiecriteria.
7. Werkelijke acties, testbewijs en governance-uitkomsten.
8. Zelfbeoordeling achteraf.
9. Voorgestelde volgende stap.
10. Expliciete eigenaarreactie: goedkeuren, corrigeren, pauzeren of afwijzen.

## Voorgesteld minimaal datamodel

### mirror_sessions
- id
- title
- owner_input
- interpreted_goal
- status
- confidence
- created_at
- updated_at
- completed_at

### mirror_entries
- id
- session_id
- entry_type
- content
- evidence
- source_refs
- created_at

Toegestane entry_type-waarden:
- owner_input
- interpretation
- context
- assumption
- uncertainty
- plan
- action
- evidence
- self_assessment
- next_step
- owner_decision

### mirror_decisions
- id
- session_id
- decision
- correction
- decided_at

Toegestane beslissingen:
- approved
- corrected
- paused
- rejected

## Eerste functionele versie

De eerste werkende versie moet precies deze route ondersteunen:

``text
eigenaar voert doel in
-> Forge legt interpretatie vast
-> Forge toont context, aannames en onzekerheden
-> Forge toont gekozen aanpak
-> uitvoering en testbewijs verschijnen in dezelfde tijdlijn
-> Forge geeft zelfbeoordeling en volgende stap
-> eigenaar keurt goed, corrigeert, pauzeert of wijst af
``

## Grenzen

- Geen onzichtbare automatische goedkeuring namens de eigenaar.
- Geen opslag van interne chain-of-thought; alleen korte, controleerbare redenen, aannames en bewijs.
- Geen duplicatie van Mission Control, approvals, missions, audit of self-awareness.
- Geen directe installatie- of productieactie vanuit Mirror zonder bestaande Governor-goedkeuring.
- Geen leeropdrachten starten voordat de eerste Mirror-cyclus end-to-end is getest.

## Bouwvolgorde

1. Datamodel en migratie.
2. OpenAPI-contract.
3. API-routes en auditregistratie.
4. Gegenereerde clients.
5. Mirror-pagina in bestaande frontend.
6. Koppeling met missie-, test-, Guardian- en Governor-resultaten.
7. End-to-end test met Ã©Ã©n echte Mirror-sessie.
8. Daarna gecontroleerde invoer van de eerste leeropdrachten.

## Acceptatie van deze inventarisatie

- Alle relevante bestaande lagen zijn benoemd.
- Hergebruik en ontbrekende delen zijn expliciet gescheiden.
- Er is geen parallel systeem voorgesteld.
- De eerstvolgende bouwstap is het Mirror-datamodel, niet de UI.