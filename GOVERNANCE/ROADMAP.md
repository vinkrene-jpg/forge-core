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
- Acquire third-party exercise collections with their own tests and work them from low to high difficulty; Forge does not generate its own learning exercises or acceptance tests.
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

## Multi-target mission intake - 2026-08-14

Status: implemented with deterministic runtime, API and Desktop verification.

- Intake preserves every explicitly named `sandbox/` target instead of selecting or requiring one.
- Single-target missions keep `proofTargetPath`; multi-target missions persist `proofTargetPaths` and the full target manifest.
- Repository-relative mutation paths outside `sandbox/` fail closed.
- Goal mandates must exactly equal the complete graph target set; provider plan exact-match validation is unchanged.

## Structured generic-build assumptions - 2026-08-14

Status: implemented with contract, parser, evaluator and end-to-end provider-loop verification.

- Workspace-plan JSON Schema and system instruction require `assumptions`; an empty array is permitted.
- Validated assumptions persist in `WorkspaceChangePlan` and flow into execution evaluation.
- `assumptions-explicit` no longer depends on free-text recognition for generic builds and still fails when structured plan context is absent.
- No target, verification, evidence, approval or no-push gate was weakened.

## Governed Forge self-mutation - 2026-08-15

Status: implemented and live verified on real Forge TypeScript through the host-local WorkspaceExecutor.

- Mission intake, GoalSpec mandates and WorkspaceExecutor accept only `sandbox/`, `lib/` and `artifacts/` mutation targets.
- The existing eleven immutable Forge files are defined once and consumed by both mandate and executor enforcement; `GOVERNANCE/` and secret/protected paths remain denied.
- Every `lib/` or `artifacts/` mutation requires repository-wide typecheck, tests and build before commit.
- Live dogfood commit `3aa4e2a` created `artifacts/self-mutation-live-proof.txt` through WorkspaceExecutor after all three gates passed.
- Controlled rollback execution `269eb0ee-3a54-422b-88fe-b8aac8fb241a` rejected a broken test receipt, created no commit and restored content, HEAD and clean worktree exactly.
- Real source mission `4a4e4941-9caa-44de-9eb6-be21f08660d8` added a function and test under `lib/forge-runtime`, passed typecheck, 146/146 tests and build, received accepted evaluation score 100, and committed locally as `9f6a125df3207c9e55c866c627d7b0eb7abc353d` without push.
- Breaking execution `c9059e83-967d-4113-bcc1-3497c451a960` failed the complete test gate and persisted exact automatic rollback with no commit, unchanged HEAD, restored source SHA and clean worktree.
- Evidence: `reconstruction/SELF_MUTATION_VERIFICATION.json`.
- Source evidence: `reconstruction/SELF_MUTATION_SOURCE_VERIFICATION.json`.

## Capability-linked gap feedback - 2026-08-15

Status: implemented and live verified from historical authoritative mission evidence.

- Failed missions, rejected evaluations and mandate boundaries register idempotent analyses in the existing Capability Registry.
- Candidate goals are frequency-ranked projections over capability analyses and missionstore records; no second persistence store was added.
- Existing missions `590a73c5`, `455dd01a` and `ed87826a` prove evaluation and workspace-plan validation gap linkage.
- Operator release creates only an idempotent, `not_started` `operator.goal-build` mission. It grants no approval, execution or push authority.
- Forge Desktop shows the missing capability, occurrence count, cause, proposed goal and released state.
- Evidence: `reconstruction/CAPABILITY_GAP_FEEDBACK_VERIFICATION.json`.

## Bounded autonomous capability-goal run - 2026-08-15

Status: implemented and runtime verified.

- One explicitly approved `operator.goal-run` mandate authorizes Forge to process its deterministic capability-gap ranking without per-goal operator intervention.
- Immutable limits cover allowed directories, maximum goals, duration and estimated provider cost; existing hard-protected paths and no-push rules remain unchanged.
- Every materialized GoalSpec still traverses capability analysis, governance assessment, fixed typecheck/test/build verification, deterministic evaluation and rollback.
- The Mission Engine executes queued work sequentially. A mandate boundary cancels pending children, and three failures for one capability stop the run before a fourth plan.
- Runtime integration proved two ranked gaps completed and disappeared under one approval with no child approvals. Focused boundary tests proved the failure limit and out-of-directory blocking.
- Evidence: `reconstruction/CAPABILITY_GOAL_RUN_VERIFICATION.json`.

## Recursive capability repair and automatic resume - 2026-08-15

Status: implemented, deterministically verified and live dogfooded through the isolated WorkspaceExecutor.

- Goal-run planning detects unavailable or non-operational BuildGraph capabilities before graph authority is created.
- Forge materializes deepest repair first and keeps dependent repair/original GoalSpecs inert until accepted workspace evidence activates them.
- Capability promotion requires successful fixed typecheck, complete tests, build and accepted component evaluation. Failure leaves the registry unchanged and persists a complete chain report.
- The run mandate now bounds repair count and depth; depth is at most two and original goals plus repairs remain capped at twenty.
- Existing mutation roots, immutable paths, governance gates, rollback and no-push policy are unchanged. Standalone BuildGraph parsing still rejects unavailable capabilities.
- Deterministic coverage proves repair then resume, failed repair reporting, depth blocking and repair-count blocking.
- Live run `4e7cd7ed-147b-4667-94b4-8a62b05cea71` repaired `tool.live-proof.render` first, promoted it from `unavailable` to `operational` only after accepted isolated verification, then resumed and accepted the original goal.
- Repair mission `74ceda4c-d528-4b10-827a-4470d9b87289` committed `772b9ec4be8ede0f4474b6e0cf53b6f5242867d2`; original mission `83406b7a-961a-4b71-a06a-3a969d248910` committed `28b48e629b17a21e3db7339f31379402e1957079`. The governed run requested no push.
- Evidence: `reconstruction/CAPABILITY_REPAIR_LIVE_VERIFICATION.json`.

## Spend and execution isolation hardening - 2026-08-16

Status: implemented with deterministic runtime, API and lifecycle verification.

- Paid provider calls reserve persisted run and daily authority before connector execution; concurrent calls share the same serialized budget view.
- Operator mission intake carries explicit `$5` run and UTC-day limits into the governance preview and approved mission. Continuations inherit those limits.
- Host package execution and verification fail closed until a network-isolated, package-install-disabled backend is available.
- The Forge launcher forwards only explicitly allowlisted provider credentials and removes unrelated secrets from the child environment.
- Every execution-slice test owns and stops its runtime before environment and temporary-storage cleanup. The complete file passes 6/6 and exits in 4.573 seconds; each real proof test also passes alone.
- Real capability-repair dogfood is blocked until the isolated execution backend exists; deterministic verification remains authoritative meanwhile.

## Network-isolated workspace verification - 2026-08-16

Status: implemented and live verified; capability-repair dogfood is the next clean-worktree action.

- Production workspace verification runs in a no-network Docker container with read-only candidate input, disposable work trees, dropped capabilities, process and memory limits and no package installation or lifecycle scripts.
- The configured image tag is resolved to an immutable local SHA-256 image ID before execution and that ID is persisted in bounded verification evidence.
- Candidate TypeScript is force-checked, including the Forge Runtime package omitted by the root project-reference graph.
- Live proof accepted a valid sandbox change, rejected a broken existing runtime source file during typecheck in 8.4 seconds, restored exact content and clean Git state, blocked outbound network access and confirmed host execution refusal.
- The image includes trusted Git plus only the three read-only governance/reconstruction context files required by deterministic runtime tests. Disposable runtime storage prevents writes to the source image.
- Runtime shutdown now drains the existing Memory Bridge mutation queue, and autonomy state writes use collision-free temporary names; container-discovered cleanup races no longer outlive their stores.
- API production builds receive a validated host source SHA through the verifier env allowlist; repository metadata remains outside the container.
- Host runtime tests passed 109/109. The final no-network container street passed runtime 109/109 and API 53/53; explicit runtime and root typechecks and the root build passed.
- Evidence: `reconstruction/WORKSPACE_VERIFICATION_ISOLATION_PROOF.json`.

## Turborepo verification acceleration - 2026-08-16

Status: implemented and measured.

- Turborepo 2.10.10 schedules workspace typecheck, build and test tasks through the existing pnpm dependency graph with explicit inputs and outputs.
- A runtime change includes API and Desktop dependents through Turbo filtering; an unfiltered complete gate remains mandatory before push.
- Runtime test files run with bounded Node concurrency two; API test bundles run in one Node test process with concurrency two. Lifecycle races now wait for terminal runtime, mission, registry and summary state before temporary storage cleanup.
- Legacy complete verification measured 54.799 seconds. The complete Turbo graph measured 29.788 seconds; after one source-only scripts change it completed 18/18 tasks with 17 cache hits in 1.975 seconds.
- The verification image copies manifests plus the frozen lockfile before installation and source afterward. After a source-only change, the image rebuilt in 6.445 seconds and the install step was explicitly cached in 0.0 seconds.
- All thirteen config-driven command checks now enter the Turbo graph instead of invoking package scripts directly. Autonomy shutdown drains its active tick and every started persistence write, preventing a late storage write from turning an otherwise passing runtime suite into process exit code 1.
- Evidence: `reconstruction/VERIFICATION_LOOP_ACCELERATION.json`.

## Forge product register and Control overview - 2026-08-16

Status: implemented and live verified in an isolated runtime.

- OperatorCore project persistence now stores one authoritative record per built or maintained product with root, start/verification commands, origin and goal.
- Startup idempotently seeds Forge Core, Assumption Engine at the discovered `Forge/assumption-engine` workspace and the Forge CAD Engine final-assignment product. On this machine the external products resolve under `D:\Forge` without a hardcoded drive letter.
- Successful missions carrying Forge's product-registration contract create or update the product record automatically; no manual registration HTTP route exists.
- Forge Control derives running state, latest Git/filesystem change, latest verification evidence and active mission work, and exposes bounded start/stop controls for Forge-owned child processes. Forge Core lifecycle remains launcher-owned.
- Live isolated API and browser proof showed exactly three seeds, correct origins and paths, Forge Core running with passed verification, Assumption Engine startable and the not-yet-created CAD workspace not startable. Desktop 1440x900 and mobile 390x844 had no horizontal overflow.
- Futur remains separate: no imports, endpoints or shared state were added.
- Evidence: `reconstruction/PRODUCT_REGISTER_VERIFICATION.json`.

## Stream 1 upstream exercise ladder - 2026-08-16

Status: implemented, deterministic coverage green and live Exercism acquisition/test execution verified.

- A bounded `operator.learning-run` obtains one approval for track, count, duration and cost. Internal exercise children then continue without operator requests or child approvals.
- The Exercise Registry atomically imports instructions, declared solution paths, all declared upstream test bytes, difficulty, concepts, provenance, commit and SHA-256 values from Exercism track repositories.
- Selection is ascending by difficulty. Attempts persist pass/fail, ordinal and elapsed milliseconds; historical durations provide median estimates for later same-language work.
- Success requires exit zero from every explicitly declared upstream test file and identical test hashes before and after a read-only, no-network container run. Forge has no self-authored exercise test path.
- Passed concepts enter the Capability Registry with exercise and attempt IDs as their evidence source.
- An empty approved ladder schedules one idempotent mission from the literal final assignment in `GOVERNANCE/EINDOPDRACHT.md`.
- Live acquisition imported 140 Python exercises and 141 test files from Exercism revision `1f6aab8667bf653b10cc3799f94352fcdb749db6`. Live `hello-world` ran exact command `python3 -B -m unittest hello_world_test.py` with exit 0 and unchanged test hash in immutable image `sha256:bbd5a5e45ecc1fcdb0e07401b42f6acd690a3a35b96c1628f78909ee9895987d`.
- Evidence: `reconstruction/EXERCISE_LADDER_VERIFICATION.json`.
