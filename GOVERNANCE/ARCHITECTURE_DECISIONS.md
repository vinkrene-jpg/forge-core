# Forge Architecture Decisions

This is an append-only summary of durable decisions recovered and verified on 2026-07-12.

## AD-001 — Repository-based project memory

The repository, not conversational memory, is the durable project context. `AGENTS.md`, governance, current state, evidence and next mission must make every session resumable.

## AD-002 — Local-first with GitHub as source of truth

The authoritative runtime is local. GitHub provides history, branches, reviews, checks, releases and rollback. Replit is a bootstrap/history source, not an operational command channel.

## AD-003 — Separate intelligence from execution

Forge Intelligence researches, understands, reasons and proposes. Forge Productivity/Core executes, tests, evaluates, persists and enforces governance.

## AD-004 — GitHub is the control gate

Intelligence does not write directly to production. Changes pass through repository history, checks and applicable approval before controlled execution or deployment.

## AD-005 — One authoritative runtime state

Mission, governance, capability, evolution, operator and provider state must have one authoritative persisted representation. The Desktop consumes that runtime state and carries no separate demo truth.

## AD-006 — Operator Console as primary interface

Forge communicates mission choice, rationale, progress, risks, approvals, results and learning through its own interface. VS Code, terminal output and chat are supporting tools.

## AD-007 — Evidence defines implementation

A component is implemented only when source, tests and/or live runtime evidence prove it. Documents, task descriptions and mock-ups do not qualify by themselves.

## AD-008 — Governed autonomy

Forge acts autonomously within local, explicitly allowed boundaries. Human approval is required for constitutional, destructive, production, significant security/architecture, external-access and budget boundary changes.

## AD-009 — Forge develops Forge

The bootstrap must enable Forge to identify gaps, prioritize improvements, implement verified capabilities and reuse each improvement in the next development cycle.

## AD-010 — Code is an execution representation

The practical runtime continues using conventional source code. Separately, Forge Intelligence may research higher-level representations of goals, states, relationships and transformations. Research cannot bypass validation or governance.

## AD-011 — Risk-calibrated execution

Low-risk reversible work proceeds directly; medium-risk work receives one decisive preflight; destructive or irreversible work secures evidence/backups before repair and cleanup.

## AD-012 — Bounded autonomous provider cycles

An operator starts and approves an external provider-backed autonomous loop once. Forge may then schedule only the explicitly bounded number of continuation cycles. Every execution is linked to a mission and grounded composition, deterministically evaluated before acceptance, persisted as project evidence and visible through the authoritative runtime and Desktop. Provider failure stops continuation without degrading the runtime.

## AD-013 - Evidence-backed deterministic learning

The Learning Engine derives capability scores only from persisted mission, execution, evaluation, Project Memory and registry evidence. Scoring and proposal priority remain deterministic and explainable. A learning proposal is not execution authority: scheduling always enters the normal capability analysis and governance path.

## AD-014 - Rejected exercises become negative evidence

A governed learning exercise that fails deterministic evaluation is never promoted to success. If its persisted execution is secret-free and uniquely linked, Forge may record it once as negative capability evidence, close the proposal as failed and create an inert recovery proposal. Recovery may not repeat the provider call automatically.

## AD-015 - Dependency-scoped failure domains

Batch execution uses explicit dependencies. Shared source, typecheck or build failure blocks every dependent chapter. A provider, exercise or research failure blocks only its own branch; unrelated verified chapters continue and persist separate evidence. No failed branch is reported as complete.

## AD-016 - Governed host-local workspace execution

Source mutation is performed only by a dedicated host-local Workspace Executor on an explicitly approved, clean, named non-main Git branch. Every file change carries an expected SHA-256 precondition. Protected paths, traversal, arbitrary commands and raw command-output persistence are denied. Fixed verification runs before commit; failure restores exact snapshots. Git push is a separate critical action and remains approval-gated.

## ADR - Authenticated container-to-host workspace execution

Forge keeps planning in the container and authoritative Git mutation on the host. Requests and responses use versioned JSON envelopes authenticated with HMAC-SHA256, short expiry, unique identifiers and exact source preconditions. Planning and execution are separate governed missions. The provider cannot request push, protected paths or arbitrary commands. The host reruns the fixed verifier and rolls back before any commit on failure.

## AD-017 - Terminal missions always persist classified results

A terminal mission outcome must always include a structured `missionResult` payload in persisted mission output, including explicit status (`completed`, `failed`, `blocked`, `rejected`) and cause metadata. Evaluation rejection and governed blocking are classified outcomes, not null-output states. Downstream learning and memory capture must consume this structured result instead of inferring from missing output.

## AD-018 - Local model route is explicit opt-in

Provider route selection may not treat local-model execution as implicitly available. The local model route is enabled only when `FORGE_LOCAL_MODEL_ENABLED=true` is set explicitly. This prevents deterministic misrouting to unreachable local endpoints that produces null-output executions and systematic evaluator rejection unrelated to evaluator correctness.

## AD-019 - Persisted mission intent is authoritative

Canonical `objectiveExecutionMode` and `objectiveProfile` values survive mission persistence, approval and runtime hydration unchanged. An explicit create target may never hydrate as analysis-only. A generic build may reach successful terminal state only after the existing workspace planner has created a linked workspace execution mission and persisted its pending second approval; provider analysis output alone is not completion evidence.

## AD-020 - Runtime binding is execution evidence

The production API bundle embeds its source Git SHA and reports the concrete loaded module path at startup and in each autonomous pre-execution snapshot. Mission Details exposes that snapshot with intake and effective execution intent. A live result is not valid evidence for a source revision unless the reported build SHA and module path identify the deployed bundle under test.

When `FORGE_CANONICAL_REPO_ROOT` is configured, runtime startup fails before listening unless both the loaded module and configured workspace root are inside that repository. Runtime binding reports the derived runtime repository root, configured workspace root and configured canonical root. A persisted `forge-core` project root is rebound to the configured workspace root at startup so old state cannot redirect execution to another checkout. Workspace planning composes from the current mission objective, current approved target manifest and current target file contents only; persistent project memory is excluded from this provider request.

## AD-021 - Workspace provider plans are single JSON objects

Workspace planning requests an Ollama-compatible JSON Schema response in addition to separate system and user prompt instructions. The provider schema constrains the output shape using supported structural keywords; the runtime remains authoritative for strict field, length, target, precondition, verification and no-push validation. The brace-aware fallback accepts exactly one syntactically valid JSON object from wrapper text. Missing, malformed, multiple or schema-invalid objects fail with concrete diagnostics and never create execution authority.

Workspace verification is represented only by the fixed identifiers `typecheck`, `test` and `build`. The two exact historical Forge runtime `pnpm` test/typecheck phrases normalize to those identifiers for compatibility; all other commands or free text remain invalid.

The provider supplies only mutable plan facts: changes, verification identifiers and commit intent. Forge deterministically builds the operator-facing summary, assumptions and verification guidance from the current objective and approved targets. Provider changes must match the complete approved target set exactly; missing, additional or stale targets never create execution authority.

Rejected provider output is persisted only as a bounded, secret-scrubbed excerpt with its total length, first and last 500 characters, SHA-256, truncation state and concrete parse or schema error. Mission Details exposes that evidence so operators can distinguish provider-contract failures from stale runtime deployments without granting execution authority.

## AD-022 - Workspace completion uses durable evidence checkpoints

A successful WorkspaceExecutor mutation is followed by an atomic persisted mission checkpoint containing final workspace status, execution evidence, proof path/content/SHA-256 and verification receipts before the mission is finalized. Startup never replays a stale running workspace mutation. It may reconcile that mission to succeeded only after read-only validation of its approved source linkage, actual target content and hash, persisted receipts and accepted evaluation where applicable; otherwise it persists a concrete restart-recovery failure.

Pre-checkpoint legacy `running` workspace missions with `output: null` are migrated idempotently from the existing mission, governance, provider and workspace state. Recovery requires the exact approved source plan and project, an approved second decision, exact target content and SHA-256, canonical path containment and successful allowlisted verification. Targets are checked before and after verification, including mtime, and WorkspaceExecutor is never called. Requested pushes fail closed; recovery never creates a missing commit.
