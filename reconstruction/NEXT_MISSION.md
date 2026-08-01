# Forge Next Mission

## Resume point after MIRROR_UI_01

Status: Mirror projection and Forge Control UI complete and live verified.

## Verified baseline

1. The canonical runtime serves one listener on port 5000 from `artifacts/api-server/dist/index.mjs`.
2. Root and health are HTTP 200; database and storage are healthy.
3. Mirror list and detail endpoints are read-only, deterministic and restart-safe.
4. Forge Control exposes `/mirror` and `/mirror/:missionId` with a 50-row page boundary, one list GET and one on-demand detail GET.
5. Runtime JSON stores remain authoritative; Mirror has no persistence, write endpoint or UI action.
6. Verification evidence is `reconstruction/MIRROR_UI_VERIFICATION.json`.

## Next action

Select the next approved roadmap mission from the current repository state. Do not reopen Mirror unless its API contracts, source authority or operator requirements change.

## Failure rules

- Preserve `missionId` as the primary cross-store correlation key.
- Do not introduce a parallel mission, approval, audit, artifact or memory truth.
- Provider failure remains isolated and must not trigger automatic retry.
- No destructive operations, protected-path changes or history rewrite.
