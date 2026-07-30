# Forge Next Mission

## Issue #4 follow-up - Live Mission Console verification

Status: ready after source integration and exact Mission Console request coverage.

## Objective

Verify the merged Mission Console workspace-execution linkage against the authoritative live runtime without bypassing either approval.

## Required chapters

1. Start one real `generic-build` mission for an explicitly allowed sandbox target.
2. Approve the planning mission and confirm the second workspace approval appears in Approvals.
3. Confirm the target is absent and execution evidence is null before the second approval.
4. Approve the workspace execution and inspect receipts, file effects, verification runs, artifacts and evaluation in Mission Console and Missions.
5. Persist the live mission, approval, evaluation and artifact identifiers under `reconstruction/`.

## Failure rules

- Provider availability or quota failure remains isolated and must not trigger automatic retry.
- Do not bypass the second approval or use a parallel execution path.
- No destructive operations, protected-path changes or history rewrite.

## Resume checklist

1. Confirm the deployed runtime contains issue #4.
2. Confirm runtime and API health.
3. Execute the two-approval flow from Mission Console with an explicit repository-relative target and confirm the `/api/missions` request contains `targets[{path, allowCreate:true}]`.
4. Capture live mission, approval, evidence and artifact identifiers.
5. Update `CURRENT_STATE.md` only after the live file effect and evaluation are verified.
