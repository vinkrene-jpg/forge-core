# Forge Next Mission

## FG-003.100 — Autonomous Provider Loop Integration

Status: ready after successful real-provider verification.

## Objective

Prove that the existing MissionLoop, Governance Engine, Operator Core, AI Gateway, capability/evolution system and Forge Desktop operate as one controlled autonomous development loop.

This is an integration-and-evidence mission. It is not permission to rebuild verified components.

## Mandatory preflight

1. Read the mandatory files listed in `AGENTS.md`.
2. Record `git status`, branch and HEAD.
3. Inspect current source paths for MissionLoop, Operator Core, Prompt Composer, Model Router, AI Gateway, evaluation and event handling.
4. Map existing connections and identify only the missing links.
5. Confirm `.env` is ignored and provider secrets are neither logged nor persisted.

## Required execution chain

```text
Mission selected
  -> capability precheck
  -> governance decision/approval when required
  -> Project Memory and workspace evidence
  -> grounded Prompt Composition
  -> Model Router selection
  -> AI Gateway provider execution
  -> output evaluation
  -> mission result and evidence persistence
  -> learning/capability update
  -> next mission scheduled
  -> live Desktop update
```

## Acceptance criteria

- At least two consecutive missions complete without a new human task being entered between them.
- Every provider call is linked to its mission, composition, routing decision and evidence.
- Provider output is evaluated before the mission is accepted.
- Failures, timeouts and quota errors produce controlled failed/blocked states rather than corrupting the loop.
- Governance approval is requested only when the active policy requires it.
- Execution, evaluation, learning and next-mission rationale persist across runtime replacement.
- Forge Desktop shows the live mission phase, activity, provider status, evaluation, approval and next mission.
- No static demo state or separate Desktop truth exists.
- Secrets are absent from state, evidence, logs and Git.
- Typecheck, build, tests and live verification are green.

## Required evidence

Create a new evidence artifact, preferably:

`reconstruction/AUTONOMOUS_PROVIDER_LOOP_VERIFICATION.json`

It should include:

- source commit and verification timestamp;
- mission IDs and cycle order;
- capability and governance decisions;
- composition, routing and execution IDs;
- provider/model metadata without credentials;
- evaluation result and acceptance decision;
- persistence/restart proof;
- next-mission rationale;
- relevant test/build results.

## Out of scope

- Production deployment.
- Constitution or governance relaxation.
- A fixed 500-task learning curriculum.
- Fundamental alternative-to-code research.
- Rebuilding existing Mission, Governance, Evolution, Operator or Gateway components.

## Completion rule

When the acceptance criteria are proven, update `CURRENT_STATE.md`, mark Roadmap Phase R3 complete and let Forge propose the first Phase R4 mission from actual capability evidence.
