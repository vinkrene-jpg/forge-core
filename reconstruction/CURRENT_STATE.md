# Forge Current State

Verified through: 2026-07-12 19:16 +02:00

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
