# Forge Core

A self-governing autonomous AI development platform: AI agent modules are built in sandboxes, tested, reviewed by a Guardian, gated by a Governor, and installed only when all governance checks pass — while 13 locked core components can never be modified autonomously.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/forge-core run dev` — run the dashboard (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CUSTOM_AI_*` (AI Gateway), `AI_DEFAULT_PROVIDER`, `AI_FALLBACK_PROVIDER`, `AI_ROUTE_<TASKTYPE>`, `STORAGE_DIR`, `CORE_ADMIN_OVERRIDE`
- Portability: `docker-compose.yml`, `.env.example`, `scripts/src/{install,backup,restore,migrate}.sh`; docs: `INSTALL.md`, `MIGRATION.md`, `BACKUP_RESTORE.md`, `UPDATE_PROCEDURE.md`, `VERIFICATION_CHECKLIST.md`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite, Wouter routing, shadcn/ui, TanStack Query (generated hooks)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for the API contract (codegen from here)
- `lib/db/src/schema/` — Drizzle schema split by domain: core, ai, projects, modules, sandboxes, governance, memory
- `artifacts/api-server/src/routes/` — one router per domain, registered in `routes/index.ts`
- `artifacts/api-server/src/lib/` — corelock, aiGateway, guardian, governor, testRunner, storage, audit, seed, jsonSafe
- `artifacts/forge-core/src/pages/` — one page per dashboard section (13 routes)
- `storage/` — sandboxes, snapshots, backups (created at startup, configurable via `STORAGE_DIR`)

## Architecture decisions

- **Locked Core Registry**: 13 components seeded at startup; any modification attempt returns 403 and is audit-logged. `CORE_ADMIN_OVERRIDE=true` is the only bypass (owner maintenance only).
- **Governance pipeline**: module → test run (failed/missing tests block install) → Guardian review (pass/warning/fail) → Governor decision (install_allowed / install_blocked / review_required / rollback_required). Low-risk + all-green auto-installs; anything else creates an approval requiring owner decision. Rejection requires a reason (400 without one). Snapshot is taken before every install for rollback.
- **AI Gateway**: all AI calls go through one gateway; providers configured purely via env (openai/anthropic/custom), with per-taskType routing (`AI_ROUTE_<TASKTYPE>`) and fallback provider. Gateway errors surface as 400s, never crash.
- **Contract-first**: OpenAPI spec drives codegen; server validates request bodies AND response payloads with generated Zod schemas.
- **jsonSafe**: Drizzle returns `Date` objects but response Zod schemas expect ISO strings — every response `.parse()` wraps data in `jsonSafe()` (JSON round-trip). Skipping it causes 500 ZodErrors on any row with timestamps.

- **Proposal Generator**: `POST /proposals/generate` turns an existing task/improvement into AI-generated code (AI Gateway, taskType `codegeneration`) written exclusively into a new sandbox + draft module; unsafe/protected paths are blocked and audited; no install happens — the normal test→Guardian→Governor→approval chain remains mandatory.
- **Self-Evolution loop** (see `SELF_EVOLUTION.md`): `POST /evolution/run` executes observe→gap analysis→plan→proposal→test→Guardian→Governor→learn→next-step. Services: selfAwareness (introspection + knowledge graph + capability map), gapAnalysis, evolutionPlanner (AI planning with deterministic fallback), selfLearning (lessons → Memory Engine). When no capability gaps remain, the loop picks up planned backlog tasks without a proposal (backlog-driven evolution). Without an AI key the run stops after planning with status `blocked` (phase `blocked-no-ai`). Unit tests: `pnpm --filter @workspace/api-server run test`.

## Product

- Dashboard (mission control summary), Projects/Goals/Backlog, Tasks (9 statuses) with decisions & risks, Modules (11 types, manifests, risk levels) with install/rollback, Sandboxes with file editing, Test Runs (7 types), Approvals, AI Gateway console, Memory Engine (9 categories), Self-Improvement backlog (convertible to tasks), Daily Loop runs & reports, Locked Core registry, Audit Logs.
- UI language: English. Dark mission-control theme.

## User preferences

- Spec was provided in Dutch (15 sprints); UI must be in English.
- Portability is a hard requirement: no platform lock-in for core functionality, everything configurable via `.env`.

## Gotchas

- Always wrap response `.parse()` args in `jsonSafe()` (see Architecture decisions).
- `manifest` fields are JSON **strings** in the API, not objects.
- Test runs require a `types` array; the Governor treats "no tests" the same as "failed tests" (blocked).
- Workflow names are prefixed: `artifacts/api-server: API Server`, `artifacts/forge-core: web`.
- Smoke-test through the proxy (`localhost:80/api/...`), never service ports directly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `INSTALL.md` — install & operations (Docker Compose, Linux, Windows+WSL, versions, start/stop, healthchecks)
- `MIGRATION.md` — Replit → local migration (DB/storage export & import, post-migration checks)
- `BACKUP_RESTORE.md` — backup/restore/rollback and disaster recovery
- `UPDATE_PROCEDURE.md` — safe update flow with mandatory pre-backup and rollback
- `VERIFICATION_CHECKLIST.md` — 14-section local verification checklist
