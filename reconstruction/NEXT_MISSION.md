# Forge Next Mission

## Resume point after structured generic-build assumptions

Status: intake preserves complete one- or two-target sandbox manifests; workspace plans carry structured assumptions into evaluation; one bounded GoalSpec mandate replaces per-child approvals while preserving all execution gates.

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

## Next action

Repeat the measured generic-build/BuildGraph path as one governed live API proof on a clean named non-main branch: verify both sandbox targets persist, the provider plan contains `assumptions`, component A evaluates accepted and releases B, and the final report contains both accepted components. Preserve the current two-component, one-dependency, one-repository limit. Do not add parallel execution, deployment, push automation or reusable pattern libraries.

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
