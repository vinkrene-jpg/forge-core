# Forge Context

Last reconstructed: 2026-07-12

## Identity and mission

Forge is a local-first, autonomous AI Software Engineering Platform. Its purpose is to understand goals, design and build software, validate its work, preserve architectural quality and improve its own capabilities under explicit governance.

Forge is independent of FPS One, FPS Connect, Sparki and other products. Those products may be built or operated through Forge, but their domain logic does not belong in Forge Core.

## Foundational assignment

Replit provided the bootstrap. After the local Forge Core became viable, Forge was intended to take responsibility for its own continued development until the end architecture is reached or an objectively unsolvable boundary requires human intervention.

The operator defines strategy, goals, authority boundaries and exceptional approvals. The operator should not have to prescribe every capability or implementation step.

## System model

Forge separates thinking from controlled execution:

```text
Operator goal
    -> Forge Intelligence (understand, research, design, propose)
    -> GitHub control layer (history, checks, review, rollback, approval)
    -> Forge Productivity/Core (execute, test, evaluate, persist, govern)
    -> Verified result and learning
    -> Next evidence-backed mission
```

Forge Intelligence may research and propose. Forge Core/Productivity controls execution and may reject a proposal when tests, evidence, rollback, security or governance are insufficient.

## Intended autonomous loop

```text
Human intent
  -> explicit Goal
  -> capability analysis
  -> Mission
  -> Plan
  -> grounded prompt and model routing
  -> controlled provider/tool execution
  -> Evaluation
  -> governance decision
  -> persistence and learning
  -> capability update
  -> next Mission
```

The loop must be observable through the Forge Desktop/Operator Console. Raw terminals and chat sessions are technical tools, not the primary operator interface.

## Permanent principles

- Architecture before implementation.
- Evidence over assumptions.
- Small, explainable and reversible changes.
- No hidden prompts, configuration or decisions.
- Tests before acceptance; production is not a debugging environment.
- Local-first operation and vendor-independent model routing.
- One authoritative runtime state.
- Git-based traceability and rollback.
- Provider credentials stay local and are never persisted in Forge state.
- Human approval at constitutional, destructive, production, security, external-access and budget boundaries.

## Two separate research lines

These subjects must remain distinct from routine implementation work:

1. **Human Intent Understanding** — determine what a person truly needs, distinguish wishes from requirements, expose ambiguity, define success and translate intent into a stable Goal.
2. **Representation beyond source code** — investigate whether Forge should reason in goals, objects, relationships, states and transformations while treating TypeScript, Rust, Python or machine code as execution targets rather than its native cognitive representation.

Neither research line may destabilize the verified runtime. Experimental results enter Forge Productivity only after validation and governance approval.

## Definition of success

Forge is not complete merely because individual engines exist. The decisive milestone is a verified closed loop in which Forge can select, execute, evaluate and learn from multiple consecutive missions, request approval only where required, and expose the complete reasoning and evidence trail to the operator.
