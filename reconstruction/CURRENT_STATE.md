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
