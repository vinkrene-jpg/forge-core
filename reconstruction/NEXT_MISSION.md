# Forge Next Mission

## FG-004.110 - Executable Learning Exercise Tool Binding

Status: ready after verified containment of the FG-004.100 negative path.

## Objective

Give one learning exercise a controlled read-only verification tool path so Forge can inspect actual runtime evidence instead of asking a provider to claim execution. Reuse the recovery proposal, require explicit approval, keep the cycle bound at one and accept success only when tool evidence and deterministic evaluation agree.

## Constraints

- Do not repeat the failed provider-only exercise.
- No workspace mutation or capability promotion in this mission.
- Tool evidence must be persisted and linked to mission, proposal and evaluation.
- Provider failure or weak output remains negative evidence without automatic retry.
- Human approval remains mandatory before any new provider call.
