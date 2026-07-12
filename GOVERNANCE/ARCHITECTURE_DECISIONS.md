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
