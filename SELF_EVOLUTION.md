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
| Capability Map | same (`CAPABILITY_SEEDS`, `assessCapability`) | 15 capabilities with status (missing/partial/working), maturity, dependencies, limitations, evidence |
| Gap Analysis | `lib/gapAnalysis.ts` | Ranks non-working capabilities by impact (dependents unblocked, unmet dependencies, maturity) |
| Autonomous Planner | `lib/evolutionPlanner.ts` | Plan with design, steps, files, risk, priority, test + rollback strategy; AI (taskType `planning`) or deterministic fallback; creates a backlog task |
| Proposal Generator | `lib/proposalGenerator.ts` | AI code generation (taskType `codegeneration`) into a fresh sandbox; path protection; never installs |
| Self Learning | `lib/selfLearning.ts` | Derives lessons per iteration and stores them in the Memory Engine |
| Evolution loop | `routes/evolution.ts` | Orchestrates the full iteration; every phase audited |

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

## Requirements & limits

- **AI key required for code generation.** Without `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CUSTOM_AI_*`, the loop runs through OBSERVE→PLAN (deterministic fallback) and then stops with status `blocked` (phase `blocked-no-ai`). Plan and task remain ready; rerun once a key is set.
- Generated test scripts must use `node --test --test-isolation=none` (Node 24 permission-model constraint); the generation prompt enforces this.
- The owner remains the gate for anything that is not low-risk-all-green (approvals), and for production decisions. The loop never touches production, VPS, or external systems.

## Tests

`pnpm --filter @workspace/api-server run test` — unit tests for gap ranking, lesson derivation, fallback planning, capability assessment, path safety and proposal parsing.
