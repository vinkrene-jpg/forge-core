# Forge Next Mission

## Resume point after spend and execution-isolation hardening

Status: Source and deterministic tests prove missing-capability repair, mandatory paid-provider spend authority, fail-closed host package execution and exception-safe runtime cleanup. Real WorkspaceExecutor capability-repair dogfood is intentionally blocked until a network-isolated execution backend with package installation disabled is available.

## Verified baseline

1. The canonical runtime serves one listener on port 5000 from `artifacts/api-server/dist/index.mjs`.
2. Root and health are HTTP 200; database and storage are healthy.
3. Mirror list and detail endpoints are read-only, deterministic and restart-safe.
4. `GET /api/mirror/session/:missionId` derives one stable SessionModel from the existing mission projection without persistence or write authority.
5. `GET /api/mirror/resume` returns either one deterministic resume state, no result, or an explicit ambiguity response with at most five candidates; explicit missionId remains authoritative.
6. Forge Control exposes `Verdergaan` with read-only mission and timeline navigation, status, progress, blockers, advice, confidence and integrity warnings.
7. Runtime JSON stores remain authoritative; Mirror, Session and Resume have no persistence, write endpoint or execution action.
8. Runtime 55/55, frontend 16/16, Resume 12/12, Mirror 12/12, typechecks, builds and live browser/API validation are green.
9. `POST /api/mirror/missions` records one idempotent `not_started` mission through the authoritative MissionEngine and grants no execution or approval authority.
10. Live validation mission `5c3701ef-2226-47ff-8a52-eb94a594f2a7` survives restart with one `input_received` event and zero attempts.
11. `pnpm forge:validate` runs the config-driven Git, typecheck, build, test, runtime and HTTP street without AI, source mutation, deployment or Git writes.
12. The restart-enabled street completed 21 steps with 20 PASS, one expected dirty-tree Git WARNING, zero errors and exit code 0; isolated restart proof left live PID `17556` and its single listener untouched.
13. Live source mutation mission `4a4e4941-9caa-44de-9eb6-be21f08660d8` created two `lib/forge-runtime` files, passed typecheck, 146/146 tests and build, received accepted evaluation score 100, and committed locally as `9f6a125df3207c9e55c866c627d7b0eb7abc353d` without push.
14. Breaking execution `c9059e83-967d-4113-bcc1-3497c451a960` failed the complete test gate, persisted `rolled_back`, created no commit, restored the original SHA and left HEAD unchanged with a clean worktree.
15. Runtime commit `350aa9c5f766fd3206c80c527487b116e1f9ccf8` registered terminal outcome gaps in existing capability analyses and ranked 14 candidate goals by recurring cause.
16. Historical missions `590a73c5`, `455dd01a` and `ed87826a` are linked respectively to evaluation and workspace-plan validation gaps.
17. Operator release created GoalSpec mission `d1fe7a03-07ba-4e4a-bf27-39e32e62e438`; it remained `not_started` with zero attempts and zero approvals, and repeated release was idempotent.
18. Runtime 98/98, API 53/53 and frontend 25/25 tests, root typecheck, build and live console verification passed.
19. One approved `operator.goal-run` completed two ranked capability-gap GoalSpecs sequentially, accepted both graph executions, removed both gaps and created no child approvals.
20. Run boundaries cover exact directories, maximum goals, duration and estimated cost; three failures for one capability stop before a fourth attempt and an out-of-directory target blocks immediately.
21. Goal-run preflight detects unavailable BuildGraph capabilities, plans deepest repair first and activates dependent repair/original missions only after accepted workspace evidence.
22. Repair depth is at most two; repair count is explicit; original goals plus repairs remain capped at twenty. Failed repair leaves capability status unchanged and records the full chain failure.
23. Paid provider execution requires persisted run and daily limits, reserves conservatively before connector access and rejects missing or exhausted authority without a provider call.
24. Operator autonomous intake places `$5` run and UTC-day limits in the governance-visible mission request; continuations inherit them.
25. Host package execution and package-script verification are disabled until a network-isolated backend exists; tests use injected bounded fixture runners only.
26. Execution-slice runtime ownership is exception-safe. The complete file passes 6/6 and exits in 4.573 seconds; both real proof tests pass independently in under two seconds.

## Next action

Implement or configure the governed network-isolated execution backend with package installation disabled. Then run `lib/forge-runtime/src/capability-repair-live.ts` once with `PNPM_WORKSPACE_CONCURRENCY=1` and capture the missing capability, repair/original mission IDs, local commit SHAs, accepted evaluations and final result in reconstruction evidence. Never re-enable direct host package execution as a shortcut.

## Failure rules

- Preserve `missionId` as the primary cross-store correlation key.
- Keep SessionModel a deterministic projection; never add a Session store or parallel status truth.
- Keep ResumeModel read-only and derived; never persist candidate choice or infer state from chat text alone.
- Keep Mirror intake inert and idempotent in the existing missionstore; never treat `not_started` as queued execution authority.
- Do not introduce a parallel mission, approval, audit, artifact or memory truth.
- Provider failure remains isolated and must not trigger automatic retry.
- No destructive operations, protected-path changes or history rewrite.
- Extend `config/forge-validation.json` for future module checks; do not create a parallel validation runner or evidence truth.
- BuildGraph nodes must continue to derive status from their linked Mission Engine records.
- A mandate-backed dependent workspace mission may never execute before its predecessor has an accepted evaluation.
- A GoalSpec mandate may never expand after approval or include hard-protected core/guardian paths.
- A paid call may never proceed when the approved maximum cost does not cover it.
- Graph learning evidence remains forbidden until integration evaluation accepts every node.
- Source mutation roots remain exactly `sandbox/`, `lib/` and `artifacts/`; every other root fails closed.
- `lib/` and `artifacts/` mutations require typecheck, the complete test suite and build before commit; any failure must restore exact snapshots.
- Capability gaps must remain analyses in the existing Capability Registry; do not add a parallel gap or candidate store.
- Candidate ranking must remain a deterministic projection over capability analyses and missionstore records.
- Releasing a candidate may create only an inert `operator.goal-build` mission; it may not approve, queue or execute that mission.
- A capability-goal run may execute only after its own persisted approval and only within its immutable directories, goal-count, duration and cost limits.
- Goal-run children may not receive separate approval authority, bypass fixed verification or continue after a mandate boundary.
- Three failed goals for one capability must stop the run before planning a fourth for that capability.
- Capability repair may recurse at most two levels and may not exceed the run's explicit repair count or the existing combined twenty-mission limit.
- A capability may become operational only after every repair workspace child has accepted evaluation evidence; planning, file writes or failed verification are insufficient.
- Repair failure must leave the registry unchanged, fail the waiting original and identify the capability, repair mission, failed child and reason.
