# Forge Next Mission

## FG-005.100 - Provider Change Planner and Host Execution Bridge

Status: ready after verified Workspace Executor foundation.

## Objective

Translate one grounded provider result into a strict bounded WorkspaceChangeRequest, show exact files, hashes, risk and verification for approval, and execute it through the verified host-local Workspace Executor.

## Required chapters

1. Strict executable change schema; prose is never executable.
2. Source selection and SHA-256 binding before provider execution.
3. Deterministic validation before approval.
4. Persistent authenticated Docker-to-host executor bridge.
5. Approval view with exact diff, commands, commit and push intent.
6. One real small Forge task from operator goal through provider plan, approval, verification, rollback proof and local commit.

## Failure rules

- Shared schema, integrity, typecheck or build failure blocks dependent execution.
- Unrelated provider or research failure blocks only its own branch.
- No automatic provider retry.
- No push or deployment without separate explicit approval.
