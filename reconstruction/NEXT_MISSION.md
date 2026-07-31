# Forge Next Mission

## Resume point after MIRROR_PROJECTION_FINAL_01

Status: Mirror projection complete and live verified.

## Verified baseline

1. The canonical runtime serves one listener on port 5000 from `artifacts/api-server/dist/index.mjs`.
2. Root and health are HTTP 200; database and storage are healthy.
3. Mirror list and detail endpoints are read-only, deterministic and restart-safe.
4. Runtime JSON stores remain authoritative; Mirror has no persistence or write endpoint.
5. Verification evidence is `reconstruction/MIRROR_PROJECTION_VERIFICATION.json`.

## Next action

Select the next approved roadmap mission from the current repository state. Do not reopen Mirror unless live evidence, source contracts or retention policy change.

## Failure rules

- Preserve `missionId` as the primary cross-store correlation key.
- Do not introduce a parallel mission, approval, audit, artifact or memory truth.
- Provider failure remains isolated and must not trigger automatic retry.
- No destructive operations, protected-path changes or history rewrite.
