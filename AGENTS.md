# Forge Agent Instructions

These instructions apply to the entire repository.

## Mandatory startup protocol

Before proposing or changing Forge, read these files in order:

1. `GOVERNANCE/CONSTITUTION.md`
2. `GOVERNANCE/FORGE_CONTEXT.md`
3. `GOVERNANCE/02_Architecture/END_ARCHITECTURE.md`
4. `GOVERNANCE/ARCHITECTURE_DECISIONS.md`
5. `GOVERNANCE/ROADMAP.md`
6. `reconstruction/CURRENT_STATE.md`
7. `reconstruction/NEXT_MISSION.md`

Then inspect the current Git branch, status and relevant source. Never infer the
current implementation solely from chat history, plans, filenames or old scripts.

## Source-of-truth hierarchy

When sources disagree, use this order:

1. Live runtime verification and persisted evidence.
2. Tests and current repository source.
3. Current Git history.
4. `reconstruction/CURRENT_STATE.md`.
5. Governance and architecture documents.
6. Recovered chat history and old milestone scripts.

A report, mock-up or proposed task is not implementation evidence.

## Operating rules

- Forge is an autonomous AI Software Engineering Platform, not product-specific FPS logic.
- GitHub is the source-code control layer; the primary runtime is local.
- Replit is not an operational command channel for Forge.
- Use repository-relative paths. Do not hardcode drive letters such as `C:` or `E:`.
- Preserve one authoritative runtime state; the Desktop must consume live runtime APIs.
- Never persist or print provider secrets.
- Do not rerun historical milestone scripts unless explicitly performing a reviewed recovery.
- Inspect before building. Extend verified code; do not duplicate an existing capability.
- Human approval remains mandatory at the boundaries defined by the Constitution.
- Keep user communication concise and in Dutch unless requested otherwise.
- Prefer one large, pasteable fail-fast PowerShell milestone over many manual commands. Every native command must check its exit code, and commit/push may occur only after all verification succeeds.

## Risk modes

- Green: reversible, low-risk work — act directly and verify proportionally.
- Orange: medium-risk work — perform one decisive preflight check, then continue.
- Red: destructive, production, secret, data-loss or history-rewrite risk — secure evidence/backups first, then repair, then clean up.

## Context maintenance

Every completed milestone must update, in the same commit:

- `reconstruction/CURRENT_STATE.md` with facts and evidence;
- `reconstruction/NEXT_MISSION.md` with the new resume point;
- `GOVERNANCE/ARCHITECTURE_DECISIONS.md` when a durable decision changed;
- `GOVERNANCE/ROADMAP.md` when phase status changed.

Do not mark a component complete without a concrete evidence file, test or live verification.

## Operator workflow preference

- Deliver one large pasteable PowerShell milestone with automatic stop on failure.
- Batch related chapters and minimize manual operator commands.
- Communicate concisely in Dutch.
- Shared source, schema, typecheck or build failures block dependent chapters.
- Unrelated provider, exercise or research failures block only their own branch.
- Never retry provider calls automatically.
- Commit and push only verified or safely contained outcomes.
