# Forge Next Mission

## FG-005.150 - Validate evaluator stability across provider modes

Status: ready.

## Objective

Demonstrate stable, evidence-based evaluator outcomes across both real-provider and fallback-provider routes, with explicit proof that accepted and rejected decisions match execution evidence.

## Required chapters

1. Run one governed autonomous mission on a real configured provider route (if available) and capture acceptance evidence.
2. Run one governed autonomous mission on fallback route and capture acceptance or rejection evidence with full check breakdown.
3. Verify evaluator checks map directly to provider execution state and output text characteristics (substantive content, assumptions, verification guidance, secret safety).
4. Publish comparative evidence under `reconstruction/` with mission, execution, evaluation and memory IDs for both routes.

## Failure rules

- Shared typecheck, test or build failure blocks completion.
- Provider availability or quota failures are isolated and must not trigger automatic retry.
- No destructive operations and no history rewrite.

## Resume checklist

1. Confirm runtime/API health.
2. Validate provider routing and connectivity preflight for both configured real-provider and fallback-provider modes.
3. Execute governed missions and capture evaluator check-level outcomes.
4. Capture comparative evidence IDs and hashes across mission/evaluation/memory stores.
5. Commit only after verification succeeds.
