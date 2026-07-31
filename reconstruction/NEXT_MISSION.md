# Forge Next Mission

## Issue #4 follow-up - Deploy and confirm canonical live runtime

Status: ready after production-built legacy null-output recovery passed without replay.

## Objective

Deploy the verified commit to the canonical checkout and perform one final operator-visible confirmation without bypassing either approval.

## Required chapters

1. Fast-forward the clean canonical checkout at `C:\Forge\forge-core` to the verified commit.
2. Rebuild and restart exclusively through Forge Control v9.
3. Confirm Runtime Details reports module and workspace roots under `C:\Forge\forge-core`.
4. Confirm legacy child mission `a11cddcb-1fe2-4806-992d-f9580739b587` migrates from `running`/null-output to `succeeded`.
5. Confirm Mission Details shows mission result, proof fields, verification, execution evidence and `legacyMigrated=true` without changing the target mtime.
6. Persist the live recovery evidence under `reconstruction/`.

## Failure rules

- Provider availability or quota failure remains isolated and must not trigger automatic retry.
- Do not bypass the second approval or use a parallel execution path.
- No destructive operations, protected-path changes or history rewrite.

## Resume checklist

1. Fast-forward the clean canonical checkout at `C:\Forge\forge-core`, then rebuild and restart exclusively through Forge Control v9. Verify Mission Details reports the new commit, `runtimeRepositoryRoot`, `workspaceRoot` and `canonicalRepositoryRoot` as `C:\Forge\forge-core`, and `runtimeModulePath` as `C:\Forge\forge-core\artifacts\api-server\dist\index.mjs`.
2. Confirm runtime and API health.
3. Confirm the visible build marker is `mission-console-mounted-submit-2026-07-30.2`, execute the two-approval flow from Mission Console with the next proof objective, and confirm client diagnostics and persisted mission input retain full `rawObjective`, one full-path `allowCreate` target, and canonical `generic-build` / `build-or-mutate`; then confirm the linked pending workspace approval is immediately visible after the first approval.
4. Capture live mission, approval, evidence and artifact identifiers.
5. Update `CURRENT_STATE.md` only after the live file effect and evaluation are verified.
