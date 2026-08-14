# Forge Roadmap

Status date: 2026-07-12

## Phase R1 â€” Recovery and canonical governance

Status: substantially complete.

- Canonical Constitution and end architecture restored.
- Repository, branch, baseline and reconstruction evidence established.
- Runtime persistence and restart recovery verified.

## Phase R2 â€” Operational runtime engines

Status: verified for the reconstructed scope.

- Mission Engine and MissionLoop.
- Governance Engine and persistent approvals.
- Capability Registry and capability-gap analysis.
- Evolution planning and governed verified execution.
- Live Forge Desktop binding.
- Operator Core with Project Memory, workspace evidence, Prompt Composer and Model Router.
- Provider-independent AI Gateway.
- Real OpenAI provider execution verified on 2026-07-12.

## Phase R3 â€” Closed autonomous provider loop

Status: complete and live verified.

- Connect an Operator/Mission execution path to the AI Gateway without duplicating existing code.
- Evaluate provider output before mission acceptance.
- Persist execution, evaluation, governance and learning evidence.
- Automatically schedule the next evidence-backed mission.
- Prove multiple consecutive cycles through live Desktop state.

Implementation includes a governed `operator.autonomous-cycle` mission, mission-linked provider executions, deterministic output evaluation, persistent evidence memory, a maximum of five explicitly bounded cycles and controlled failure containment.

## Phase R4 â€” Learning and adaptive capability development

Status: in progress; canonical Learning Engine foundation live verified.

- Implement the canonical Learning Engine.
- Maintain capability scores and learning history.
- Generate adaptive development exercises from a capability matrix instead of following a fixed list.
- Begin with Human Intent Understanding before advanced software-engineering levels.

## Phase R5 â€” Complete end architecture

Status: future, prioritized by verified gaps rather than a fixed build order.

Candidate gaps currently not proven as canonical implementations:

- dedicated Kernel package/host in the recovered tree;
- canonical Evaluator;
- canonical Context Engine;
- Learning Engine;
- Blueprint and Element Libraries;
- extended Tool Connectors and Workspace Manager;
- release/deployment automation under governance.

Forge must inspect current source before creating any of these. Existing partial capability is extended rather than rebuilt.

## Phase R6 â€” Forge Intelligence research

Status: parallel research only; may not block or destabilize production work.

- Human Intent Understanding and stable Goal representation.
- Alternative internal representations above traditional source code.
- Model and tool evaluation.
- Architecture and capability research under experimental isolation.

### Verified negative learning feedback

FG-004.100 proves that rejected provider output becomes bounded negative learning evidence rather than false success or an automatic retry. The successful feedback path remains deterministically covered; live success awaits an exercise with real execution tools.

### Accelerated independent learning chapters

The read-only evidence-tool path and the adaptive Human Intent capability matrix share a build gate but have separate live outcomes. Provider or exercise failure blocks only its dependent branch; deterministic matrix work continues and retains separate evidence.

## Workspace Executor milestone - 2026-07-13

Status: verified host-local foundation.

- Governed operator.workspace-change missions are implemented.
- SHA-256 preconditions, protected-path denial, fixed verification and exact rollback are tested.
- Forge completed one live host-local mission and created its own verified Git commit.
- Provider-to-change-plan translation and the persistent host execution bridge remain next.

## FG-005.100 Provider planner and host bridge

Status: implemented with deterministic verification. Live provider dogfood is recorded separately in reconstruction/PROVIDER_BRIDGE_VERIFICATION.json because provider availability is an isolated runtime condition.

## FG-005.110 Mission output pipeline live verification

Status: completed on 2026-07-15 with governed live mission evidence.

- One explicitly approved autonomous mission was executed and reached a terminal `failed` state with structured non-null output.
- Mission output persisted `missionResult` classification (`rejected`, cause `evaluation`) instead of null output fallback behavior.
- Evidence: reconstruction/MISSION_OUTPUT_PIPELINE_VERIFICATION.json.

## GoalSpec mandate vertical slice

Status: implemented with deterministic verification; live API execution proof remains the next bounded milestone.

- One high-risk `operator.goal-build` approval authorizes at most two prevalidated sequential workspace components within exact path, mission-count, duration and cost limits.
- Child missions retain capability analysis, governance assessment, fixed verification, evaluation and rollback without per-child approvals.
- Core and guardian paths remain immutable, push remains forbidden and predecessor acceptance is checked at execution time.
- The existing API exposes governed creation and a final report derived from mission evidence; Desktop pending approvals show mandate limits and never display loading or query failure as an empty queue.

## FG-005.120 Provider-backed execution stabilization

Status: completed on 2026-07-15 with accepted governed mission evidence.

- Live diagnostics confirmed unavailable configured external providers and unreachable local model endpoint in the active environment.
- One governed autonomous mission was executed on an isolated runtime with controlled fallback routing and reached accepted evaluation (`score 100`).
- Terminal mission output persisted `missionResult.status=completed` with explicit execution cause, preserving classified result guarantees.
- Evidence: reconstruction/PROVIDER_STABILIZATION_VERIFICATION.json.

## FG-005.140 Unblock autonomous evaluation

Status: completed on 2026-07-15 with root-cause fix and live accepted mission evidence.

- Repeated score-33 rejections were traced to provider route selection preferring a non-opted-in local model route.
- Failed local-model executions produced null output, so evaluator checks deterministically yielded 33 (`mission-linked` + `secret-free` only).
- Runtime provider selection was corrected to explicit local-model opt-in; evaluator logic remained unchanged.
- Regression coverage added and runtime tests passed.
- Live governed mission after patch was accepted with score 100 and persisted learning/evidence linkage.
- Evidence: reconstruction/AUTONOMOUS_EVALUATION_UNBLOCK_VERIFICATION.json.

## FG-005.150 Runtime truth verification

Status: completed on 2026-07-15 as a truth check against the live 5000 runtime.

- The live runtime still produced `score=33` with `providerId=local-model` and `fetch failed` on recent autonomous execution.
- The source fix exists, but the live runtime process has not yet loaded it.
- Evidence: reconstruction/RUNTIME_TRUTH_VERIFICATION.json.

## Goal-to-Software Build Graph vertical slice - 2026-08-14

Status: implemented with focused deterministic and runtime coverage.

- GoalSpec records desired behavior, constraints and evidence-backed acceptance criteria.
- A validated graph is limited to two components, one dependency and repository `forge-core`.
- Every node references an existing workspace mission; mission state remains authoritative.
- Dependency approval is blocked until the predecessor has succeeded with accepted evaluation.
- Integration learning evidence is ineligible until all component missions are accepted.
- Parallel execution, deployment, automatic push and pattern libraries remain out of scope.
