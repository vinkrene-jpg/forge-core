# Forge Core — Self-Evolution Flow

Forge Core can evolve itself through a repeatable loop. This document describes the flow, the services behind it, the API, and its limits.

## The loop

`POST /api/evolution/run` executes one full iteration:

```
OBSERVE    introspect own code, DB and runtime state (snapshot + knowledge graph + capability map)
EVALUATE   gap analysis over the capability map; if no gaps: pick the oldest planned backlog task without a proposal
PLAN       autonomous plan for the top gap (AI-assisted, deterministic fallback without AI key) → backlog task
GENERATE   Proposal Generator writes AI-generated code + tests exclusively into a new sandbox
TEST       Real Test Runner executes lint / typecheck / unit tests against the sandbox
REVIEW     Guardian reviews the draft module
GOVERN     Governor decides (install_allowed / blocked / review_required); owner approval when not low-risk-all-green
LEARN      lessons stored in the Memory Engine (fed back into future AI prompts)
NEXT       next-step recommendation based on a fresh gap analysis
```

Nothing is ever installed by the loop itself outside the existing governance pipeline. The 13 Locked Core components remain untouchable; unsafe or protected file paths in proposals are blocked and audit-logged.

## Services

| Service | Where | What |
|---|---|---|
| Self Awareness | `artifacts/api-server/src/lib/selfAwareness.ts` | Read-only scan of source files, endpoints, DB tables, docs, dependencies, config keys; persists snapshots |
| Knowledge Graph | same (built per snapshot) | Nodes (services, files, endpoints, tables, docs, dependencies) + typed edges |
| Capability Map | same (`CAPABILITY_SEEDS`, `assessCapability`) | 24 capabilities with status (missing/partial/working), maturity, dependencies, limitations, evidence |
| Gap Analysis | `lib/gapAnalysis.ts` | Ranks non-working capabilities by impact (dependents unblocked, unmet dependencies, maturity) |
| Autonomous Planner | `lib/evolutionPlanner.ts` | Plan with design, steps, files, risk, priority, test + rollback strategy; AI (taskType `planning`) or deterministic fallback; creates a backlog task |
| Proposal Generator | `lib/proposalGenerator.ts` | AI code generation (taskType `codegeneration`) into a fresh sandbox; path protection; never installs |
| Self Learning | `lib/selfLearning.ts` | Derives lessons per iteration and stores them in the Memory Engine |
| Evolution loop | `lib/evolutionLoop.ts` (routes in `routes/evolution.ts`) | Orchestrates the full iteration; every phase audited; single-run guard |
| Evolution Scheduler | `lib/evolutionScheduler.ts` | In-memory interval timer that triggers the loop autonomously; disabled by default (`EVOLUTION_SCHEDULER_ENABLED=true`, `EVOLUTION_SCHEDULER_INTERVAL_MINUTES`); every tick audited |
| Quality Analyzer | `lib/qualityAnalyzer.ts` | Static quality scan of own source (oversized files, weak typing, logging discipline) with score |
| Technical Debt Analyzer | `lib/techDebtAnalyzer.ts` | TODO/FIXME markers, skipped tests, deprecated code, oversized modules, duplicate routes |
| Dependency Analyzer | `lib/dependencyAnalyzer.ts` | Maps workspace dependencies to their users; flags version mismatches |
| Architecture Validator | `lib/architectureValidator.ts` | Validates architecture rules against the live self-model (router registration, jsonSafe, logging, locked core, governance chain) |
| Refactoring Engine | `lib/refactoringEngine.ts` | Turns quality/debt findings into improvements that flow through the normal improvement→task→proposal→governance pipeline; never edits code directly |
| Roadmap Generator | `lib/roadmapGenerator.ts` | Ranked roadmap from gaps, planned backlog tasks, open improvements and critical debt |
| Internal Knowledge Base | `lib/knowledgeBase.ts` | Unified search over knowledge graph, memory, capabilities, docs and audit trail |
| Documentation Generator | `lib/docsGenerator.ts` | Regenerates `SELF_MODEL.md` from the live self-model, capability map and installed modules |

## API

- `POST /api/evolution/introspect` — take a snapshot, rebuild graph, refresh capabilities
- `GET /api/evolution/self` — latest self-model snapshot
- `GET /api/evolution/graph` — knowledge graph (nodes + edges)
- `GET /api/evolution/capabilities` — capability map
- `GET /api/evolution/gaps` — ranked gap analysis
- `POST /api/evolution/plan` — plan the next step (optional `{"capabilityKey": "..."}`)
- `GET /api/evolution/plans` — all plans
- `POST /api/evolution/run` — execute one full iteration
- `GET /api/evolution/runs` — run history with reports
- `GET /api/evolution/status` — overview: capability counts, gaps, latest run, pending approvals, AI configured
- `GET /api/evolution/scheduler` / `POST /api/evolution/scheduler` — scheduler status / configure (`{"enabled": true, "intervalMinutes": 60}`)
- `GET /api/analysis/quality` · `GET /api/analysis/debt` · `GET /api/analysis/dependencies` · `GET /api/analysis/architecture` — self-analysis reports
- `POST /api/analysis/refactor-plan` — convert current quality/debt findings into improvements (backlog)
- `GET /api/roadmap` — generated evolution roadmap
- `GET /api/knowledge-base/search?q=...` — internal knowledge base search
- `POST /api/docs/generate` — regenerate `SELF_MODEL.md`

## Backlog-driven evolution

When no capability gaps remain, the loop picks the oldest planned backlog task without a proposal. The Refactoring Engine feeds this backlog: `POST /api/analysis/refactor-plan` creates improvements from findings, an owner (or the loop's roadmap) converts them to tasks via `POST /api/improvements/{id}/convert`, and the next evolution run builds them through the full generate→test→Guardian→Governor chain. Failed tests or a Guardian fail always block installation.

## Self-Upgrade Loop (local, read-only)

A local workflow that analyzes the codebase against a machine-readable upgrade backlog and only *proposes* changes:

- **Start:** `pnpm forge:self-review` (from the repo root; validation tests: `pnpm forge:self-review:test`)
- **Upgrade goals:** `config/forge-upgrades.json` — each goal has id, title, description, priority, risk, status, acceptance criteria, test requirements, owner-approval flag and evidence checks. The runner fails if mandatory fields are missing.
- **Report:** `reports/forge-self-review.md` — per goal: current status (implemented/partial/missing), missing parts, proposed change, risk, required tests, and whether owner approval is required.
- **Owner gate:** the runner is strictly read-only analysis. It never modifies code, never commits, never deploys, and never touches `.env`, secrets, VPS or production settings — a test enforces that the runner contains no process-execution or network primitives. Any actual change goes through the normal proposal → test → Guardian → Governor → owner-approval pipeline.

## Requirements & limits

- **AI key required for code generation.** Without `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CUSTOM_AI_*`, the loop runs through OBSERVE→PLAN (deterministic fallback) and then stops with status `blocked` (phase `blocked-no-ai`). Plan and task remain ready; rerun once a key is set.
- Generated test scripts must use `node --test --test-isolation=none` (Node 24 permission-model constraint); the generation prompt enforces this.
- The owner remains the gate for anything that is not low-risk-all-green (approvals), and for production decisions. The loop never touches production, VPS, or external systems.

## Tests

`pnpm --filter @workspace/api-server run test` — unit tests for gap ranking, lesson derivation, fallback planning, capability assessment, path safety, proposal parsing, and the analyzers (quality, debt, dependencies, architecture, refactoring mapping).
