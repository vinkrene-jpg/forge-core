# Forge Next Mission

## Resume point after MIRROR_INTAKE_01

Status: Mirror projection, Session projection, deterministic Resume and controlled mission intake complete and live verified.

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

## Next action

Use the deterministic Resume response when the operator asks to continue, then require an explicit missionId when the response is ambiguous. Intake creates work only; any future start/approve capability must remain a separately governed mission with explicit authority.

## Failure rules

- Preserve `missionId` as the primary cross-store correlation key.
- Keep SessionModel a deterministic projection; never add a Session store or parallel status truth.
- Keep ResumeModel read-only and derived; never persist candidate choice or infer state from chat text alone.
- Keep Mirror intake inert and idempotent in the existing missionstore; never treat `not_started` as queued execution authority.
- Do not introduce a parallel mission, approval, audit, artifact or memory truth.
- Provider failure remains isolated and must not trigger automatic retry.
- No destructive operations, protected-path changes or history rewrite.
