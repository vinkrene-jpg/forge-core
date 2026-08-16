# Forge Current State

Verified through: 2026-08-16

## Product register and Forge Control

- The persisted OperatorCore project collection is now the authoritative product register. Records contain name, code root, structured start and verification commands, origin, product goal and optional creating mission ID.
- Startup migrates legacy records and idempotently seeds `forge-core`, `assumption-engine` and `forge-cad-engine`. External product roots are discovered through `FORGE_PRODUCTS_ROOT`, the workspace parent and existing Windows `Forge` roots; live proof resolved `D:\Forge\assumption-engine` and `D:\Forge\forge-cad-engine`.
- A succeeded mission with a valid `productRegistration` contract is registered automatically with `forge-built` origin. Invalid or failed work writes no product; persistence failure emits `operator.product.registration.failed`. There is no manual registration route.
- `GET /api/operator/products` derives live state from kernel/process ownership, Git/filesystem timestamps, mission or validation evidence and active missions. POST start/stop routes operate only on registered products; Forge Core remains owned by the launcher.
- Forge Control Products shows running state, last change, last verification, current work, origin, goal and accessible start/stop controls. Assumption Engine is startable; the absent CAD workspace is visibly not startable.
- Product process shutdown owns and terminates its child tree, including Windows descendants, and runtime shutdown drains all owned product processes.
- The product register has no Futur imports, endpoints or shared data.
- Focused runtime register/process tests passed 3/3; the product UI test passed 1/1; the forced affected Turbo graph passed 15/15 tasks. Browser checks at 1440x900 and 390x844 found zero horizontal overflow.
- Evidence: `reconstruction/PRODUCT_REGISTER_VERIFICATION.json`.

## Turborepo verification acceleration

- Turborepo 2.10.10 is the scheduler and local cache for workspace `typecheck`, `build` and `test`; root scripts delegate to its dependency graph.
- Task hashes include the frozen lockfile, workspace definition, shared TypeScript configuration and the three runtime-context files used by deterministic tests. Build identity is a build-only environment input.
- Runtime source participates in a concrete build task, so API and Desktop consumer hashes invalidate when runtime source changes.
- Scoped isolated verification passes the changed package to Turbo and expands the dependency graph through Turbo filters. A push request reruns every requested gate unfiltered before Git push.
- Runtime tests run with Node file concurrency two and completed 111/111 with exit code 0. API tests completed 53/53 with concurrency two.
- A graph-runtime test now drains all child missions and stops its runtime before deleting storage; capability and autonomy tests wait for their persisted asynchronous terminal state.
- Legacy full verification: 54.799 seconds. Complete Turbo graph: 29.788 seconds. Source-only follow-up: 1.975 seconds with 17/18 cache hits.
- Docker source-only rebuild: 6.445 seconds; the `pnpm install --frozen-lockfile` layer was `CACHED` in 0.0 seconds.
- All thirteen `config/forge-validation.json` command steps invoke `pnpm exec turbo run` with an exact workspace filter. Specialized Mirror, Session, Resume, Intake and validation-framework tasks are declared in `turbo.json` and participate in local caching.
- `AutonomousEngine.stop()` now awaits the active autonomy tick and all already-started persistence writes before its final stopped-state persist. This restores the lifecycle guarantee from `05b9e63` under bounded parallel runtime tests and prevents a late write from producing exit code 1 after passing TAP assertions.
- A deterministic shutdown regression test and the forced uncached runtime graph pass; runtime coverage is now 112/112.
- Evidence: `reconstruction/VERIFICATION_LOOP_ACCELERATION.json`.

## Capability repair and automatic resume - live verification

- Approved goal-run `4e7cd7ed-147b-4667-94b4-8a62b05cea71` detected missing capability `tool.live-proof.render` and created repair mission `74ceda4c-d528-4b10-827a-4470d9b87289` before the original goal.
- The repair traversed isolated typecheck, complete tests and build, received accepted evaluation, committed `772b9ec4be8ede0f4474b6e0cf53b6f5242867d2` and promoted the capability from `unavailable` to `operational` with confidence 1.
- Original goal `83406b7a-961a-4b71-a06a-3a969d248910` resumed automatically, received accepted evaluation and committed `28b48e629b17a21e3db7339f31379402e1957079`.
- Both targets exist, the worktree was clean after the run and the governed execution requested no push. Evidence: `reconstruction/CAPABILITY_REPAIR_LIVE_VERIFICATION.json`.

## Network-isolated WorkspaceExecutor verification

- Production ForgeRuntime now selects Docker-backed workspace verification; test runtimes remain fail-closed unless a bounded verifier is explicitly injected.
- The backend resolves `FORGE_VERIFICATION_IMAGE` to an immutable local SHA-256 image ID, creates a no-network/read-only/capability-dropped container with memory and PID limits and always removes it after completion, failure, cancellation or timeout.
- Only sanitized `sandbox/`, `lib/` and `artifacts/` candidate bytes enter the container. Dependencies and trusted manifests are baked into the image; pnpm runs offline with lifecycle scripts and dependency repair disabled.
- Verification receipts retain image/container identity, bounded output lengths and SHA-256 hashes without raw output persistence.
- The typecheck gate forces the root project graph and explicitly checks `@workspace/forge-runtime`, which is absent from the root TypeScript references.
- Live evidence accepted a sandbox mutation and rejected a syntactically broken existing runtime source file with exit code 2 in 8.362 seconds, then proved exact rollback, clean Git state, blocked network and host-runner refusal.
- Trusted Git and exactly three read-only runtime context fixtures are baked into the image. Runtime state uses disposable storage; candidate and trusted tool execution is confined to disposable workspace tmpfs mounts.
- Memory Bridge now follows explicit `STORAGE_DIR`, runtime stop drains its serialized mutation queue and autonomy atomic writes use collision-free temporary names. This closes cleanup races exposed by read-only container execution.
- The verifier resolves host HEAD before container creation and passes only the validated 40-hex `FORGE_RUNTIME_BUILD_SHA` needed by the API bundle. `.git` remains excluded.
- Explicit runtime and root typechecks, host runtime 109/109, final no-network container runtime 109/109 plus API 53/53 and root build passed.
- Evidence: `reconstruction/WORKSPACE_VERIFICATION_ISOLATION_PROOF.json`.

## Spend, sandbox and runtime lifecycle hardening

- Every OpenAI provider call now requires explicit persisted run and UTC-day spend authority. The gateway serializes conservative reservation with the boundary check before connector execution and reports mandate-linked actual cost.
- Operator autonomous mission intake includes fixed `$5` run and daily boundaries before governance assessment; bounded continuation missions inherit them.
- Host package installation, lifecycle scripts and package-script verification are denied without a network-isolated executor that disables package installation. Workspace and API execution paths fail closed rather than running Forge-written code directly on Windows.
- Forge child-process environment construction strips unrelated secret-like values and permits only the explicitly allowlisted OpenAI credential.
- `execution-slice.test.ts` registers every `ForgeRuntime` with exception-safe cleanup, stops runtimes before restoring global environment or deleting storage, and uses a bounded proof verifier compatible with the production host-execution denial.
- Timed evidence: complete execution-slice file 6/6 in 4.573 seconds; real WorkspaceExecutor proof alone 1/1 in 1.811 seconds; restart evidence alone 1/1 in 1.955 seconds. No pending-promise warning or post-suite handle delay remained.
- Complete API suite passed 53/53 after mission intake was aligned with mandatory spend authority.

## Recursive capability repair and automatic resume - deterministic verification

- Before a goal-run BuildGraph receives authority, Forge detects every required capability that is absent or below `operational`.
- The same approved run mandate bounds repair directories, total original/repair missions, maximum repairs, maximum depth two, duration and provider cost. Push remains false and protected paths remain denied.
- Repair GoalSpecs and the original GoalSpec use the authoritative Mission Engine. Only the deepest repair is queued; accepted evidence activates its dependent mission without another approval.
- Registry promotion occurs only after all repair workspace children succeeded with accepted deterministic evaluation. Failed verification leaves the capability unchanged and fails the waiting original with capability, repair mission, failed child and reason.
- Runtime tests prove one unavailable capability is built first and the original resumes; the negative path proves no promotion or original execution after repair failure. Separate tests prove depth and repair-count boundaries before materialization.
- API test bundles execute in one Node test process with `--test-concurrency=2`; runtime test files use the same bounded concurrency.
- Real WorkspaceExecutor dogfood script: `lib/forge-runtime/src/capability-repair-live.ts`. It must run only after this implementation is committed and the worktree is clean.

## Bounded autonomous capability-goal run - runtime verification

- `operator.goal-run` is the single approval-bearing parent for one bounded pass over the deterministic capability-gap ranking.
- The immutable run mandate limits directories, goal count, duration and estimated provider cost. It cannot widen the existing mutation roots, hard-protected paths or push authority.
- The approved parent plans single-component GoalSpecs and queues their `operator.goal-build` missions through the existing Mission Engine. Children retain capability analysis, fixed verification, deterministic evaluation, evidence and rollback without separate approvals.
- Runtime integration started one real `ForgeRuntime`, approved one run, completed two ranked goals sequentially through GoalBuildGraph and WorkspaceExecutor, received accepted evaluations, removed both gap candidates and created zero child approvals.
- Focused negative coverage stops before a fourth planning attempt after three failures on one capability and blocks a target outside the approved directories.
- Forge Control exposes run creation and reports derived from authoritative mission evidence.
- Evidence: `reconstruction/CAPABILITY_GOAL_RUN_VERIFICATION.json`.

## Capability-linked mission outcome feedback - live verification

- Terminal failed missions, rejected evaluations and mandate boundaries register idempotent capability-linked analyses in the existing Capability Registry; there is no gap store.
- Candidate goals are deterministic, frequency-ranked projections over those analyses and authoritative missionstore records.
- Operator release creates one idempotent `operator.goal-build` mission in `not_started` state with zero attempts and no approval. Forge does not execute the candidate automatically.
- Live runtime commit `350aa9c5f766fd3206c80c527487b116e1f9ccf8` ranked 14 candidates. The top `evaluation.output.assess` / `evaluation-rejected` cause had 1,845 occurrences.
- Existing missions `590a73c5` and `455dd01a` linked to evaluation gaps; `ed87826a` linked to `workspace.plan.validate` / `workspace-plan-validation-failed`.
- Released GoalSpec mission `d1fe7a03-07ba-4e4a-bf27-39e32e62e438` remained inert and repeated release returned the same mission.
- Runtime 98/98, API 53/53 and frontend 25/25 tests passed; root typecheck and build passed.
- Evidence: `reconstruction/CAPABILITY_GAP_FEEDBACK_VERIFICATION.json`.

## GoalSpec-level authorization - deterministic verification

- `operator.goal-build` is the single approval-bearing parent for one bounded GoalSpec and its validated BuildGraph proposal.
- Approval materializes existing `operator.workspace-change` children idempotently. Each child retains capability analysis and a high-risk governance assessment but receives no child approval record while the parent mandate matches.
- Runtime execution rechecks persisted parent approval, exact allowed paths, total child count, deadline, estimated cost delta, hard-protected core/guardian paths and predecessor acceptance.
- Provider-generated push is forbidden. WorkspaceExecutor rollback remains active when deadline aborts execution.
- Final reporting is derived from linked mission evidence and includes accepted components, verification receipts, rejected reasons, cost and mandate boundary failures.
- `POST /api/goal-builds` and `GET /api/goal-builds/:missionId/report` expose the canonical runtime path without another state store.
- Forge Desktop distinguishes approval loading/error/empty states, preserves orphan pending approvals and shows GoalSpec path, mission, duration and cost limits.
- Deterministic evidence: complete runtime suite 82/82 passed; GoalSpec authorization focus 4/4 passed; approval visibility 2/2 passed; API and Desktop typechecks passed.

## Multi-target mission intake - deterministic verification

- Mission intake now extracts all unique explicitly named `sandbox/` paths in stable order across API preview, Desktop submission and direct runtime inference.
- One target preserves `proofTargetPath`; multiple targets persist `proofTargetPaths` and omit the singular field.
- Mutation paths outside `sandbox/`, traversal and incomplete target manifests fail closed.
- Goal mandate `allowedPaths` must exactly equal the complete BuildGraph target set. Provider plan validation still requires an exact approved target manifest and no push authority was added.
- Evidence: runtime 86/86, API 53/53 and Desktop 23/23 tests passed; root typecheck and build passed.

## Structured generic-build assumptions - deterministic verification

- Root cause of score-90 generic-build rejection was a contract mismatch: evaluator required assumptions in free provider text while the strict workspace-plan schema and system instruction did not require a structured assumptions value.
- Workspace plans now require a bounded `assumptions` array; empty is valid, missing is rejected by the parser.
- Generic-build execution evaluates the assumptions field from the exact persisted, provider-hash-linked source plan. Free-text wording cannot satisfy the gate.
- Focused contract/parser/evaluator coverage passed 9/9, the complete autonomous provider-loop file passed 10/10 and the full runtime suite passed 87/87, including plan, separate approval, execution, accepted evaluation and restart recovery.

## Repository

- Local path at recovery time: `C:\Forge\forge-core` (informational only; code must use repository-relative paths).
- Remote: `https://github.com/vinkrene-jpg/forge-core.git`.
- Reconstruction branch: `reconstruct/forge-core-v1`.
- Protected baseline tag: `pre-reconstruction-2026-07-12`.
- Baseline commit: `d7f5768`.
- Latest provider execution used source commit: `826bf273eb908218ff50c1478ce7ed0757ebcc21`.
- Current HEAD must be read from Git at session start; it is not inferred here.

## Live-verified components

| Component | Verified result | Evidence |
|---|---|---|
| Runtime persistence | Identity, counters and unclean-stop recovery persist | `RUNTIME_PERSISTENCE_VERIFICATION.json` |
| Mission Engine / MissionLoop | Persistent single-mission execution and restart recovery | `MISSION_ENGINE_VERIFICATION.json` |
| Governance Engine | Risk policy, blocking, approval, rejection and restart persistence | `GOVERNANCE_ENGINE_VERIFICATION.json` |
| Capability system | Registry, precheck, gap analysis and evolution planning | `CAPABILITY_EVOLUTION_VERIFICATION.json` |
| Evolution execution | Approval, automated verification, evidence and safe promotion | `EVOLUTION_ENGINE_VERIFICATION.json` |
| Forge Desktop | Live authoritative APIs, actions and SPA serving without demo state | `DESKTOP_BINDING_VERIFICATION.json` |
| Operator Core | Project Memory, protected workspace reading, grounded prompts and routing | `OPERATOR_CORE_VERIFICATION.json` |
| AI Gateway | Persistent, provider-independent controlled execution and secret isolation | `AI_GATEWAY_VERIFICATION.json` |
| Real provider execution | OpenAI Responses call succeeded; 886 input, 955 output, 1,841 total tokens; secret not persisted | `AI_PROVIDER_EXECUTION_VERIFICATION.json` |

## Provider verification correction

Older reconstruction text states that provider execution was unavailable until credentials were configured. That statement became stale after the successful execution at `2026-07-12T19:16:54+02:00` using provider `openai-responses` and model `gpt-5.6`.

## Not yet proven

- The complete autonomous loop from mission selection through real provider execution, evaluation, learning and automatic next-mission scheduling.
- Multiple consecutive autonomous provider-backed iterations visible in Forge Desktop.
- A canonical Learning Engine.
- A canonical Evaluator integrated into the live mission acceptance path.
- A recovered dedicated Kernel implementation matching the original historical design.
- Canonical Blueprint and Element Libraries.

## Current constraint

Do not add unrelated engines merely because they appear in the end architecture. The current priority is to integrate and prove the existing components as one closed loop. Inspect the repository first to determine whether any part of that integration already exists.

## Autonomous provider loop implementation

Implementation status: complete with deterministic integration coverage.

- `operator.autonomous-cycle` connects MissionLoop, capability analysis, governance, Operator Core, Prompt Composer, Model Router and AI Gateway.
- The first external-provider loop requires explicit approval; continuations remain bounded to the approved maximum (five or fewer).
- Every provider execution records its mission ID and composition ID.
- Deterministic evaluation checks provider success, mission linkage, substantive output, explicit assumptions, verification guidance and secret safety.
- Accepted results persist as Project Memory evidence and may schedule the next bounded mission.
- Rejected or failed provider output stops continuation while the runtime remains operational.
- Forge Desktop can start the loop and shows mission-linked provider executions and persisted evaluation state.
- Automated tests prove two consecutive cycles, restart persistence and contained provider/quota failure.

Live provider loop verification: VERIFIED at 2026-07-12T20:26:06.7455656+02:00. Evidence: `reconstruction/AUTONOMOUS_PROVIDER_LOOP_VERIFICATION.json`.

## Learning Engine foundation

FG-004.000 is live verified at 2026-07-12T20:59:33.0567566+02:00. The canonical Learning Engine imports persisted mission, provider execution, deterministic evaluation, Project Memory and capability evidence without repeating provider calls. It maintains transparent deterministic capability profiles and proposes adaptive one-cycle learning missions. Proposals remain inert until submitted through the existing capability analysis and governance path. Restart persistence is verified in reconstruction/LEARNING_ENGINE_VERIFICATION.json.

## Governed learning failure feedback

FG-004.100 verified the negative path at 2026-07-12T21:43:37.7087171+02:00. One approved provider execution returned safe but incomplete and explicitly unverified output. Deterministic evaluation rejected it at 83 because assumptions-explicit failed. Forge preserved the failed mission and execution, converted them exactly once into negative capability evidence, closed the proposal as failed, created an inert recovery proposal and survived restart without another provider call. Evidence: reconstruction/LEARNING_FAILURE_FEEDBACK_VERIFICATION.json.

## Learning accelerator bundle

FG-004.110 and FG-004.200 were processed as independent chapters at 2026-07-12T22:01:04.5317427+02:00. Shared tests, typecheck and build passed. The dependency-aware Human Intent matrix contains three experimental capabilities with no operational authority. The read-only evidence-tool chapter ended as succeeded and used 1 provider execution(s); its result did not invalidate the independent matrix chapter. Evidence: reconstruction/LEARNING_ACCELERATOR_VERIFICATION.json.

## Governed Workspace Executor - verified 2026-07-13

- operator.workspace-change requires explicit approval before mutation.
- Existing files require exact SHA-256 preconditions; protected paths and arbitrary commands are denied.
- Fixed verification runs before commit and failure restores exact snapshots.
- Verification evidence stores hashes and counts, never raw command output.
- Live dogfood mission: 95570db1-11b5-4106-a162-c46d28a21650.
- Live dogfood commit: 0d53bb35137b87583edf70ef4c77bbd62b98d0f9.
- Evidence:
econstruction/WORKSPACE_EXECUTOR_VERIFICATION.json.
- Operational mode: host-local runtime; the persistent Docker-to-host execution bridge remains next.

## FG-005.100 - Provider change planner and host execution bridge

- Provider-backed workspace planning is a non-mutating mission with its own explicit approval.
- Provider output is accepted only as strict JSON bound to approved paths and exact SHA-256 source preconditions.
- A validated plan becomes a separate high-risk workspace-change mission and requires a second explicit approval.
- The container sends authenticated, expiring requests through an HMAC file bridge; a Windows host agent performs the governed Git mutation.
- Typecheck, test, build, rollback and local commit remain mandatory. Provider-generated push is forbidden.
- Provider failure is contained to the provider branch and is never automatically retried.

## FG-005.100 live dogfood outcome

- Outcome: failed
- Planning mission: dc3ce7ed-4a11-4c91-ac62-1a6c0ffa7718
- Execution mission:
- Execution commit:
- Automatic retry: false
- Evidence: reconstruction/PROVIDER_BRIDGE_VERIFICATION.json

## Mission output pipeline restoration - 2026-07-15

Status: implemented and validated in source and tests.

- Root cause was confirmed in persisted runtime evidence: repeated `operator.autonomous-cycle` missions failed with `output: null` after evaluator rejection (`score 33`), causing downstream generic memory text.
- Mission finalization now always persists a structured `missionResult` payload, including explicit statuses (`completed`, `failed`, `blocked`, `rejected`) and cause/message metadata.
- Autonomous evaluator rejection now throws a structured failure payload that includes mission output context, so failed missions keep evaluable output instead of `null`.
- Mission Console now renders `missionResult` fields directly for terminal outcomes.
- Regression coverage added for provider failure and evaluator rejection to enforce non-null mission output with classified mission result.

Validation executed after changes:

- `pnpm run typecheck`
- `pnpm run build`
- `pnpm --filter @workspace/forge-runtime test`

## FG-005.110 live verification - 2026-07-15

Status: completed with live governed mission evidence.

- One explicit governed autonomous mission was created and required approval before execution.
- Verified mission: `7ca0e69b-7e14-4570-8b0e-34c2b52c3749`.
- Verified approval: `f82a9dda-3572-4362-83b4-d0f2a06f9199`.
- Verified evaluation: `c8bc3e60-1774-4003-b4f2-7c15e048bad3` (decision `rejected`, score `33`).
- Terminal mission output was non-null and persisted `missionResult.status=rejected` with `missionResult.cause=evaluation`.
- Operator evidence memory was persisted for this mission (`3dd17224-8d07-42b9-acd7-d598ebbe688b`).
- Evidence file: `reconstruction/MISSION_OUTPUT_PIPELINE_VERIFICATION.json`.

## FG-005.120 provider-backed execution stabilization - 2026-07-15

Status: completed with accepted governed mission evidence on an isolated runtime route.

- Live diagnosis confirmed external API providers were unconfigured on the active runtime (`/api/ai/providers` showed `openai`, `anthropic`, `custom` as `configured=false`).
- Local model endpoint preflight (`http://127.0.0.1:11434/v1/models`) returned `000`, confirming no reachable local model service.
- A dedicated runtime instance was started on port `5001` with controlled provider routing (`FORGE_AI_PROVIDER=manual-fallback`, `FORGE_LOCAL_MODEL_ENABLED=false`) to stabilize execution without secrets.
- Verified governed mission: `c22ef824-0f35-4f87-ac44-ccd9620e9ebd`.
- Verified approval: `22a6b516-a72a-45d5-bb27-d80d38848d7c`.
- Verified execution: `12aab1a3-3001-4e4c-862a-70c04fc66943` (`providerId=manual-fallback`).
- Verified evaluation: `d1e6c73b-2dae-44ea-bd09-5f5d4c36275a` (`decision=accepted`, `score=100`).
- Verified evidence memory: `f52c0819-f66a-4556-b855-0b86fe6efc23`.
- Terminal mission output persisted `missionResult.status=completed` and `missionResult.cause=execution`.
- Evidence file: `reconstruction/PROVIDER_STABILIZATION_VERIFICATION.json`.

## FG-005.140 unblock autonomous evaluation - 2026-07-15

Status: completed with root-cause fix and accepted governed mission evidence.

- Root cause was in provider route selection, not in evaluator math: `local-model` was treated as enabled by default and preferred for medium-budget autonomous cycles.
- In environments without a reachable local model endpoint, executions failed with `error: fetch failed` and `outputText: null`.
- Evaluator then deterministically scored these missions at `33` because only `mission-linked` and `secret-free` passed while `provider-succeeded`, `output-substantive`, `assumptions-explicit`, and `verification-explicit` failed.
- Minimal fix: local model routing is now explicit opt-in (`FORGE_LOCAL_MODEL_ENABLED=true`) instead of implicit default-enabled.
- No evaluator bypass, no hardcoded acceptance, no temporary workaround was introduced.
- Regression test added to ensure autonomous cycles succeed via manual fallback when local model is not explicitly enabled.
- Live verification mission accepted after patch: mission `ce073e66-8054-4598-ad3f-d57a273604fa`, evaluation `48a99c9f-67af-4af7-8306-9081b7894efb` (`accepted`, score `100`), evidence memory `bd3ae575-c4fd-4197-b84b-9bb1ef33e31b`.
- Evidence file: `reconstruction/AUTONOMOUS_EVALUATION_UNBLOCK_VERIFICATION.json`.

## FG-005.150 runtime truth verification - 2026-07-15

Status: live-runtime discrepancy confirmed.

- Live 5000 runtime still emits `providerId=local-model`, `error=fetch failed`, and deterministic evaluation score `33` for recent autonomous missions.
- The patched source now requires explicit `FORGE_LOCAL_MODEL_ENABLED=true` before local-model can be selected, which should route unconfigured environments to `manual-fallback` instead.
- The active 5000 process is therefore still running an older build or was not restarted after the provider-selection fix.
- Live evidence file: `reconstruction/RUNTIME_TRUTH_VERIFICATION.json`.

## Issue #4 - Mission Console workspace execution linkage - 2026-07-30

Status: implemented with focused runtime and API integration evidence.

- `operator.autonomous-cycle` output persists and exposes `workspaceExecutionMissionId` and `workspaceExecutionApprovalId`.
- The governance state validator now accepts the existing `operator.workspace-change` and `operator.workspace-plan` mission kinds, so workspace approvals survive restart.
- Mission Console follows the linked execution mission and shows `plan voltooid — uitvoering wacht op approval` before the second approval.
- The existing Approvals view identifies the workspace execution approval and its planning mission; the existing Missions view exposes inspectable mission details.
- Execution evidence remains null before the second approval. After governed WorkspaceExecutor execution, receipts, file effects, verification runs, artifacts and evaluation are exposed from persisted mission output.
- Focused evidence: `artifacts/api-server/src/tests/missionConsoleWorkspaceExecution.test.ts` restarts the runtime between approvals and verifies the existing mission and governance APIs before and after execution.
- Live feedback correction: Mission Console now posts the server-generated intake preview request directly to the existing `/api/missions` endpoint. Explicit repository-relative target paths become `input.targets` with `allowCreate=true`; the runtime treats that explicit mutation authority as `generic-build` / `build-or-mutate` even when objective wording alone is ambiguous.
- The focused integration test uses the real Mission Console request sequence (`/api/operator/mission-intake/preview` followed by `/api/missions`) for `sandbox/mirror-generic-build-proof-2.txt`, verifies both persisted linkage IDs and null evidence before the second approval, restarts the runtime, then verifies the real file and complete execution evidence after approval.
- Mission Details exposes persisted intake request diagnostics (`targets`, intake execution mode/profile) alongside the runtime-produced execution mode/profile, so a live Desktop request can be compared directly with its terminal mission output.
- Exact live target extraction now accepts both `Pad: sandbox/...txt` and a standalone repository-relative path line. Intake creates exactly one `allowCreate=true` target, rejects multiple unique candidates, and the integration test uses the persisted live objective `sandbox/mirror-generic-build-proof-4.txt`.
- The actual Desktop submit chain is verified as intake preview followed by mission creation. Intake now preserves the exact pre-normalization `rawObjective` in mission diagnostics, parses the complete multiline proof-5 objective into exactly one `sandbox/mirror-generic-build-proof-5.txt` target with `allowCreate=true`, and fails closed when a mutation references a repository path without producing exactly one target manifest.
- Focused proof-5 evidence covers the full two-approval flow with runtime restart and verifies `generic-build` / `build-or-mutate`, absent pre-approval execution evidence, and persisted receipts, file effects, verification runs, artifacts and accepted evaluation after execution.
- Workspace execution scheduling now treats the existing `operator.workspace-change` mission and its persisted pending governance approval as one required result. The planning mission cannot succeed with a null or unpublished `workspaceExecutionApprovalId`; focused runtime and API tests verify both linkage IDs, immediate visibility through `/api/governance/approvals`, and null execution evidence after the first approval.
- The rendered `Start missie` handler no longer submits cached preview data. It sends the current textarea value to the existing `/api/operator/mission-intake/preview` route at click time and posts that exact response request to `/api/missions`. The proof-7 handler test asserts the two real client calls and final body (`rawObjective`, one `allowCreate` target, `build-or-mutate`, `generic-build`); the API integration test verifies the resulting workspace mission and approval linkage.
- The production render chain is explicitly verified as `main.tsx -> App.tsx -> Route "/" -> pages/mission-console.tsx`. The duplicate mission input in `operator-core.tsx` was removed, leaving one visible `Start missie` implementation. The mounted route shows build marker `mission-console-mounted-submit-2026-07-30.1` and renders the exact endpoint and JSON body synchronously before each fetch.
- A JSDOM route test mounts the real `App` at `/`, enters the complete proof-8 text in the rendered textarea, clicks the rendered button, and verifies that `/api/missions` receives the preview-produced `rawObjective`, one `sandbox/mirror-generic-build-proof-8.txt` target with `allowCreate=true`, `build-or-mutate`, and `generic-build`. The API integration test verifies the linked workspace mission and pending second approval.
- The canonical intake request builder now derives compatibility `proofTargetPath` from the already validated single target instead of a basename-only proof regex. Proof-9 therefore persists the full `sandbox/mirror-generic-build-proof-9.txt` path in both fields, sends `rawObjective`, `targets`, `objectiveExecutionMode=build-or-mutate`, and `objectiveProfile=generic-build`, and fails closed if a referenced directory component is absent from the canonical target.
- Mounted client build `mission-console-mounted-submit-2026-07-30.2` now canonicalizes the final create request even when a legacy preview response contains only a basename `proofTargetPath`. The concrete proof-10 button test starts from that broken live response and verifies the final `/api/missions` body contains the full raw objective, full-path target manifest, canonical mode/profile, and full compatibility path.
- Live mission `bb9ee93c-e017-4a35-b1a2-0a46eb0f5ffc` proved that the authoritative runtime had persisted the legacy request shape and therefore resumed as `generic-analysis` after first approval. Mission creation now applies the same fail-closed target extractor used by intake before persistence, canonicalizes the exact proof-10 objective to `generic-build` / `build-or-mutate`, and preserves the full target path. The live-equivalent runtime integration verifies the linked workspace mission, pending second approval, original-mission linkage, and absence of mutation/evidence before that approval.
- Live mission `222c0585-6140-48da-9d1a-b1bb9fb6b878` persisted the complete proof-12 canonical input but was executed by the active stale API bundle as `analysis-only` / `generic-analysis`. The source runtime now treats persisted canonical intent as authoritative, rejects conflicting analysis hydration, feeds `rawObjective` into workspace composition, and prevents MissionEngine from completing a generic build without both workspace linkage IDs. The API integration restarts between POST and first approval, asserts identical input after hydration and approval and inside the provider callback, and rejects analysis output as a valid planning result.
- Deployment evidence: the live listener on port 5000 was serving `artifacts/api-server/dist/index.mjs` from a separate checkout and was started 2026-07-29 22:03:39, so a rebuild and restart of that authoritative runtime is mandatory before the next live retest.
- Proof-13 runtime-binding correction: the API production build now embeds its Git SHA, logs `runtimeBuildSha` and the concrete loaded `runtimeModulePath` at startup, and persists both in `preExecutionSnapshot` with intake and effective mode/profile. Mission Details renders that snapshot. The production-bundle integration runs the same build and `node --enable-source-maps ./dist/index.mjs` start command as Desktop, routes an exact generic-build mission through a deterministic local provider, and verifies `dist/index.mjs`, a 40-character build SHA, canonical effective intent, null planning evaluation, and both workspace linkage IDs.
- Source/bundle inspection found one authoritative `runtime.ts`, one `mission-engine.ts`, and one `autonomous-cycle.ts`; no second executor source exists. The stale behavior is isolated to an old deployed `dist/index.mjs`. The loaded executor still fails closed independently: canonical generic-build output cannot complete as analysis or receive a successful terminal result without its linked workspace mission and approval.
- Root `pnpm.cmd run forge:start` is restored after typing the production runtime-binding poll through its existing generic JSON helper and minimally narrowing SQLite/Postgres returning-query unions in the task routes without `any`. All workspace typechecks and builds completed, and Forge started from this checkout on port 5000 with the bundled API process.
- Live proof-14 mission `3aeadbae-cc90-49df-ba78-12d57c704dc4` reached the canonical build path but the loaded local model returned prose plus an unrelated evidence object. Workspace-plan local-model calls now request `response_format.type=json_object`; the parser extracts exactly one string-safe balanced JSON object and reports distinct no-valid-object, malformed-object and multiple-object diagnostics before strict schema validation. The production-bundle regression uses the real local-model connector with a fenced valid plan, verifies the JSON response-format request, creates both workspace linkage IDs and a visible pending second approval, and proves the target remains absent before that approval.
- Full root `pnpm.cmd run forge:start` completed all typechecks and builds after the provider-contract correction and started the bundled API on port 5000.
- Live proof-15 mission `7a4eaa40-9389-4ecd-981f-80045a61f373` again exposed stale deployed behavior with the removed raw-object error. The loaded runtime now persists a bounded, secret-scrubbed provider-output excerpt, total length, SHA-256, truncation state and concrete schema error on the failed parent mission. Mission Details renders those diagnostics. Production-bundle coverage accepts a realistic prose-plus-fenced valid Ollama plan, then rejects the realistic proof-15 evidence object at strict schema validation, leaves execution evidence null and performs no workspace mutation.
- Live proof-16 mission `7a0a5904-ca10-4725-b27d-d2faaa3f41da` failed with no valid JSON object. Its persisted diagnostics identified the actual provider as `manual-fallback`, not qwen. Workspace planning now sends separate system and user instructions plus an Ollama-compatible `json_schema` response format at temperature zero. A direct `qwen2.5-coder:7b` probe returned one raw 674-character JSON object with the approved full target and `push=false`. Failed output diagnostics additionally persist and render the first and last 500 characters. The production-bundle regression uses the OpenAI-compatible qwen response envelope, strictly validates the plan, and proves invalid proof-16-shaped output creates neither a linked workspace mission nor a second approval or mutation.
- Live proof-17 mission `8682b846-4a1a-4882-8671-334a03fbc9bc` reached structured workspace planning but returned free-text verification values. The provider schema and prompt now allow only `typecheck`, `test` and `build`; the exact historical Forge runtime test/typecheck phrases normalize to `test`/`typecheck`, while arbitrary commands and guidance fail closed. Production-bundle coverage verifies valid normalized planning creates both linkage IDs and a pending second approval without mutation, while the exact proof-17 response creates no linked mission or approval.
- Live proof-18 mission `571863d9-a44c-4fd2-aa7d-dfec61a4298e` proved two coupled causes: a manually started Copilot checkout occupied port 5000, and workspace planning selected persisted project memory containing proof-16. Forge Control v9 now displays and exports canonical repo `C:\Forge\forge-core`, rejects an existing non-canonical listener, and the runtime fails startup when its module is outside `FORGE_CANONICAL_REPO_ROOT`. Runtime/Mission Details expose canonical and actual repository roots. Workspace planner composition excludes all persisted memory and uses only the current objective, approved targets and their current content. Production coverage proves a proof-18 request contains no proof-16 context and rejects a stale proof-16 plan without a second mission, approval or mutation.
- Final Mirror workspace-chain correction makes Forge authoritative for plan narrative: the provider returns only changes, fixed verification identifiers and commit intent; the runtime deterministically derives a substantive summary, assumptions and verification guidance from the current objective and exact approved targets. Provider changes must equal the complete approved target set. Runtime startup additionally rejects a workspace root outside the canonical repository and rebinds persisted `forge-core` project state to the configured workspace root.
- Production evidence: `production API bundle proves persistent two-step workspace execution` builds and starts the same `artifacts/api-server/dist/index.mjs` binding as Forge Control v9, approves the operator mission, verifies the linked pending workspace approval and absent target, restarts the API with the same persisted state, approves the second decision, verifies the exact new `sandbox/mirror-final-workspace-flow.txt` content, successful fixed verification, SHA-256/file/artifact evidence and accepted evaluation, then restarts again and confirms all completion evidence remains persisted. Root typecheck plus frontend and API production builds pass.
- Live restart feedback exposed the post-mutation/pre-finalization crash window: a child `operator.workspace-change` could remain `running` with an already committed target. Successful workspace execution now atomically checkpoints final status, execution evidence, proof path/content/SHA-256 and verification receipts before MissionEngine completion. Startup preserves stale running workspace missions for read-only reconciliation, validates approved source linkage, exact file content/hash and persisted receipts, and never invokes WorkspaceExecutor during recovery. Mission Details renders the persisted mission result, proof fields, verification and recovery evidence.
- Production restart evidence: `production restart recovers workspace evidence without mutation replay` hard-kills the built API after the target and durable checkpoint exist but before finalization, restarts the same `dist/index.mjs` with the same state, proves the child mission becomes `succeeded`, all evidence fields survive, and target mtime remains unchanged.
- Existing pre-fix child mission `a11cddcb-1fe2-4806-992d-f9580739b587` has the legacy persisted shape `status=running`, `output=null` while its approved target exists. Startup now migrates this shape from the authoritative mission/governance/provider stores: it validates exact plan/project/approval linkage, canonical target path, content and SHA-256, runs only the approved verification identifiers, rechecks target content/hash/mtime, reconstructs evidence and accepted evaluation, and never calls WorkspaceExecutor or writes the target.
- Production legacy evidence: `production restart migrates legacy stale workspace mission without mutation replay` rewrites a durable test child to the exact old `running`/null-output form before restarting `dist/index.mjs`; recovery succeeds with full proof/evidence fields and unchanged target mtime.

## MIRROR_PROJECTION_FINAL_01 - verified 2026-07-31

- SQLite health uses the active adapter and resolves the existing shared data file at `C:\Forge\storage\forge.sqlite` from any workspace CWD without creating a second database.
- Mission intake persists one mission and one linked intake persistence set.
- Mirror is a read-only, non-persistent projection over authoritative runtime JSON, keyed by `missionId`.
- `GET /api/mirror/missions` returns 3,015 compact deterministic records in 838 ms and 800 ms live; each source is loaded once per request and projection timeout returns HTTP 503.
- `GET /api/mirror/missions/:missionId` correlates approvals, runtime audit receipts, evidence, artifacts, assessments and result. Verified mission: `544c805d-790e-4747-ab46-7bd15acf0b06`.
- List and detail responses were byte-identical before and after one controlled restart. All five source-store SHA-256 values remained unchanged.
- Root typecheck, frontend build, API build, 25 API tests, 55 runtime tests and 7 focused Mirror tests passed.
- Live runtime after validation: one port-5000 listener, PID `8652`; root and health HTTP 200 with `status=ok`, `database=ok`, `storage=ok`.
- Evidence: `reconstruction/MIRROR_PROJECTION_VERIFICATION.json`.

## MIRROR_UI_01 - verified 2026-08-01

- Forge Control exposes `Mirror` in the existing live-control navigation at `/mirror`, with read-only detail at `/mirror/:missionId`.
- The overview reads only `GET /api/mirror/missions`, searches missionId/title, filters status, sorts newest activity first and renders at most 50 of 3,015 compact records per page.
- Detail reads one `GET /api/mirror/missions/:missionId` and renders the endpoint timeline, approvals, evidence, artifacts, assessments, result, integrity warnings and missing links without reconstructing state.
- Frontend tests cover all 15 requested behaviors; the final 3,000-record test rendered 50 rows in 94 ms with one list request and no detail N+1 traffic.
- Frontend typecheck/build, 14 frontend tests, 7 Mirror API tests, 55 runtime tests and `git diff --check` passed.
- Live browser verification opened mission `a11cddcb-1fe2-4806-992d-f9580739b587`: list and detail each made one GET, no writes occurred, and console/page errors were empty.
- Root and health remained HTTP 200 with database/storage `ok`; one listener remained active on PID `8652`. No runtime restart was required.
- Evidence: `reconstruction/MIRROR_UI_VERIFICATION.json`.

## MIRROR_SESSION_01 - verified 2026-08-01

- Claude Mirror projects exactly one deterministic read-only SessionModel per authoritative `missionId`; it adds no session, mission, approval, memory or status store.
- Session identity, status, progress, blockers and next action are derived exclusively from the existing Mirror mission projection and persisted timeline evidence.
- `GET /api/mirror/session/:missionId` is GET-only, returns a clean 404 for an unknown mission and survives restart without Session persistence.
- Forge Control renders status, evidence-backed progress, next action and blockers above the existing Mirror timeline.
- Runtime tests passed 55/55 with exit code 0; frontend tests passed 14/14; API tests passed 30/30.
- Initial live 404 was deployment staleness: PID `8652` started before the Session-enabled `dist/index.mjs` was written. Reloading that existing bundle exposed the already registered route without a source change.
- Live mission `3af535ff-e793-47c6-b99b-0cb3c9c692c0` returned HTTP 200 with status `BLOCKED`, progress `45`, an explainable next action and its persisted blocker.
- Browser verification on mission `a11cddcb-1fe2-4806-992d-f9580739b587` showed the complete Claude Mirror panel, only GET requests and no console errors.
- Live runtime after validation: one port-5000 listener, PID `19116`; root and health HTTP 200 with database/storage `ok`.

## MIRROR_RESUME_01 - verified 2026-08-01

- Claude Mirror Resume deterministically derives restart- and chat-independent resume state from the existing Mirror projection and SessionModel; it adds no resume, mission, session, approval, memory or status store.
- Selection priority is explicit missionId, active/blocked candidates, open governance work, then unfinished work. Multiple candidates produce an explicit ambiguity response with at most five deterministically ordered candidates and no persisted selection.
- ResumeModel exposes proven last activity and evidence sources, derived current state and advice, unknown unlinked commit/runtime fields, blockers, missing data and integrity warnings.
- `GET /api/mirror/resume` and `GET /api/mirror/resume/:missionId` are GET-only. Unknown missionId returns 404; a source set containing only completed missions returns HTTP 200 with `resumeAvailable=false`.
- Focused Resume tests passed 12/12, existing Mirror tests 12/12, frontend tests 16/16 total, and runtime tests 55/55 with exit code 0.
- Frontend and API typechecks and builds passed with exit code 0. Unchanged source data produces byte-identical Resume selection before and after restart projection.
- Live default Resume returned HTTP 200 with five ambiguity candidates. Explicit mission `a11cddcb-1fe2-4806-992d-f9580739b587` returned `BLOCKED`, progress `30`, last completed step `approval_granted`, one blocker and HIGH-confidence `RESOLVE_BLOCKER` advice.
- Forge Control shows `Verdergaan`; `Open missie` and `Bekijk tijdlijn` resolve to the selected mission and timeline anchor. Browser traffic was GET-only and console errors were empty.
- Live runtime after one controlled bundle reload: one port-5000 listener, PID `39800`; root and health HTTP 200 with database/storage `ok`.

## MIRROR_INTAKE_01 - verified 2026-08-01

- `POST /api/mirror/missions` is the first controlled Claude Mirror write capability and delegates to the existing `ForgeRuntime.createMission -> MissionEngine.enqueue` chain.
- Intake writes one `operator.mirror-intake` record with persistent status `not_started` in the authoritative missionstore; MissionLoop claims only `queued` records and therefore cannot execute intake automatically.
- Required title/objective, field lengths, priority, requestId, actor/role, markup/script content, absolute local paths and optional projectId are validated server-side. Audit records correlate the authorized actor to missionId without mission text or local paths.
- Idempotency uses the requestId stored in `mission.input` and is checked inside the existing serialized MissionEngine mutation boundary. Sequential retries, concurrent equal requests and restart retries return the same missionId without a second store or timeline event.
- Mirror projects an inert intake as exactly one `input_received` event. Session and explicit Resume derive `NOT_STARTED`; no approval, execution, AI provider, Guardian or Governor event is created.
- Frontend typecheck/build passed. Frontend tests passed 18/18 total; API tests passed 44/44; focused intake passed 2/2; runtime tests passed 55/55. Existing Mirror, Session and Resume regressions remained green.
- Live mission `5c3701ef-2226-47ff-8a52-eb94a594f2a7`, title `Claude Mirror intake validatie`, returned HTTP 201 twice for requestId `mirror-intake-live-20260801-0847` with the same missionId and one persisted record.
- Live browser double-click produced one POST followed by two GETs, opened the correct detail, displayed confirmation, `input_received` and `Nog niet gestart`, and produced no console errors.
- Restart preserved missionId, `not_started`, zero attempts and exactly one `input_received`. Final root/health were HTTP 200 with database/storage `ok`; one listener remained on PID `17556`.
- Evidence: `reconstruction/MIRROR_INTAKE_VERIFICATION.json`.

## FORGE_VALIDATE_01 - verified 2026-08-01

- `pnpm forge:validate` is the central AI-independent validation command; `--restart` adds an isolated two-start/two-stop proof after configured builds and tests.
- `config/forge-validation.json` declares generic Git, command, runtime and HTTP steps. Future modules can add command or HTTP checks without changing runner code.
- Git checks include branch/commit, staged, unstaged and untracked files plus cached and uncached whitespace checks. A dirty development tree is explicit `WARNING`, while validation defects are `FAIL`.
- The report is confined to ignored `reports/validation-report.json` and contains timestamps, duration, branch, commit, statuses, exit codes, runtime PID/listener state, HTTP results and bounded errors without raw child-process output.
- Exit codes are deterministic: 0 for a technically green street, 1 for validation failure and 2 for configuration/process/infrastructure failure. The validator never mutates source, deploys, commits or pushes.
- Final restart-enabled validation completed 21 steps: 20 `PASS`, one expected Git `WARNING`, zero errors and exit code 0. Framework regression tests passed, including Windows command-shim execution and report path confinement.
- The isolated built API started and stopped twice on port 5010. The authoritative port-5000 runtime remained one listener on PID `17556`; root, health, Mirror, Session and Resume returned HTTP 200, and health reported `status=ok`, `database=ok`, `storage=ok`.
- Evidence: `reconstruction/FORGE_VALIDATION_VERIFICATION.json`.

## Goal-to-Software Build Graph first vertical slice - 2026-08-14

- `GoalSpec` deterministically requires an objective, desired behavior, constraints and concrete acceptance criteria with named evidence.
- Provider/model graph proposals are untrusted input and receive no authority until Forge validates one repository, at most two unique components, at most one dependency, acyclicity, exact safe targets, operational capabilities and fixed `typecheck`, `test` and `build` verification.
- Goal acceptance criteria must be covered by component criteria before workspace missions are created.
- Each final graph node references a unique existing `operator.workspace-change` mission ID; the graph has no separate task or status administration.
- Both workspace approval gates remain existing Governance Engine records. Approval of a dependent node fails closed until its predecessor mission is `succeeded` with `evaluation.decision=accepted`.
- Integration evaluation is derived from mission records. It writes one idempotent project evidence record, and becomes learning-eligible, only after the complete graph is accepted.
- Focused validator and runtime tests pass 6/6; the complete Forge Runtime suite passes 78/78. Final root `pnpm run typecheck` and `pnpm run build` both pass.

## Governed Forge self-mutation - 2026-08-15

- Intake, Mission Console, GoalSpec mandates and WorkspaceExecutor now permit repository-relative targets only under `sandbox/`, `lib/` and `artifacts/`.
- The original eleven immutable Forge files remain unchanged and are exported once from `goal-mandate.ts` for executor reuse. `GOVERNANCE/`, secret names, protected segments, traversal and every other root remain denied.
- Any mutation outside `sandbox/` must request `typecheck`, `test` and `build`; the executor runs the full repository commands before commit and rolls back exact snapshots on failure.
- Verification children do not inherit active `STORAGE_DIR` or `FORGE_WORKSPACE_ROOT`, preventing source checks from reading or mutating authoritative runtime state.
- Deterministic evidence: runtime 92/92, API 53/53, focused WorkspaceExecutor 8/8, root typecheck and build passed.
- Live success: WorkspaceExecutor created and committed `artifacts/self-mutation-live-proof.txt` as `3aa4e2a` after the complete verification set passed.
- Live failure: execution `269eb0ee-3a54-422b-88fe-b8aac8fb241a` received a controlled failing test receipt, returned `rolled_back`, made no commit and restored target content, HEAD and clean worktree.
- Evidence: `reconstruction/SELF_MUTATION_VERIFICATION.json`.

## Governed Forge source mutation - live verified 2026-08-15

- Canonical runtime binding loaded `artifacts/api-server/dist/index.mjs` from source SHA `15c2bd84e08e5eff21c3caab013723c9ba9af818` with explicit local-model routing.
- Planning mission `85672763-3481-4bdc-817d-4e19b996f50e` produced an exact two-target `lib/forge-runtime` manifest with structured assumptions, null creation preconditions, fixed `typecheck`, `test` and `build` gates, and `push=false`.
- Approved workspace mission `4a4e4941-9caa-44de-9eb6-be21f08660d8` created `source-mutation-proof.ts` and its own test, passed the complete 146/146 suite, typecheck and build, received accepted evaluation score 100, and committed as `9f6a125df3207c9e55c866c627d7b0eb7abc353d`.
- Negative planning mission `ae0e6cca-8ba4-4b94-a6ad-5092cb3072de` targeted only the existing source file with exact SHA-256 precondition `1cd5aac37bdfeedbea65d98b5588cc3ef2bfb033867de95fcf05e93d89b59cb2` and introduced a real runtime-breaking top-level return.
- Workspace execution `c9059e83-967d-4113-bcc1-3497c451a960` failed the complete test gate, persisted `status=rolled_back`, `rollbackPerformed=true` and `commitSha=null`, restored the original SHA, preserved HEAD `9f6a125df3207c9e55c866c627d7b0eb7abc353d`, and left an empty porcelain status.
- Allowed roots remain exactly `sandbox/`, `lib/` and `artifacts/`; immutable paths, graph limits and push authority were unchanged.
- Evidence: `reconstruction/SELF_MUTATION_SOURCE_VERIFICATION.json`.
