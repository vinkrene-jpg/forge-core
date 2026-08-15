# Forge Next Mission

## Resume point after governed Forge source mutation

Status: Forge has live-mutated real `lib/forge-runtime` TypeScript, added its own passing test, committed only after full verification, and automatically restored an exact snapshot after a genuinely breaking follow-up mutation. Existing immutable and governance paths remain protected.

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

## Next action

Use the verified source-mutation baseline for the next bounded GoalSpec component. Keep the target under the existing three roots, require exact SHA preconditions and full verification, and inspect the final GoalSpec report through authoritative mission APIs. Do not widen allowed roots, immutable paths, graph limits or push authority.

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
