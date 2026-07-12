# Forge Next Mission

## FG-004.000 - Learning Engine Evidence Foundation

Status: ready after live completion of the autonomous provider loop.

## Objective

Implement the smallest canonical Learning Engine foundation that consumes persisted mission, execution, evaluation and capability evidence. It must update a transparent capability profile and propose the next learning mission without bypassing governance.

## Evidence from Phase R3

- Two consecutive real provider-backed missions completed.
- The second mission was scheduled automatically within the approved bound.
- Both outputs were deterministically evaluated before acceptance.
- Mission, execution, evaluation and Project Memory evidence survived a hard runtime replacement.
- Verification: `reconstruction/AUTONOMOUS_PROVIDER_LOOP_VERIFICATION.json`.

## Forge proposal from the final verified cycle

## Single next evidence-backed step

**Complete FG-003.100 by executing and finalizing one governed, live, two-cycle `operator.autonomous-cycle` run against the real provider in the local Docker runtime.**

This should precede any Phase R4 implementation. The supplied evidence consistently identifies live provider-loop finalization as the only remaining Phase R3 gap:

- `GOVERNANCE/ROADMAP.md`: implementation has deterministic coverage; live finalization is pending.
- `reconstruction/CURRENT_STATE.md`: `Live provider loop verification: PENDING_FINALIZATION`.
- `reconstruction/NEXT_MISSION.md`: requires one live two-cycle run and finalization evidence.

No supplied evidence proves this live finalization has occurred.

### Assumptions to verify

1. GitHub-backed HEAD still contains the autonomous-cycle executor and finalization tooling.
2. Repository instructions in `AGENTS.md` permit the run and introduce no additional requirements.
3. The local Docker runtime is available and configured with usable provider credentials.
4. `.env` remains ignored, and credentials cannot enter logs, persisted state, evidence, or Git.
5. Required governance approval can be provided for the initial external-provider cycle.

If any assumption fails, record the run as blocked; do not create successful verification evidence.

### Concrete verification steps

1. Record branch, HEAD, remote, and working-tree status; read `AGENTS.md`.
2. Inspect the actual autonomous-cycle and finalization paths rather than relying solely on reconstruction documents.
3. Run the repository-defined typecheck, build, and test commands.
4. Start one governed live run and approve it only as required by the active policy.
5. Demonstrate two consecutive provider-backed missions without entering another human task.
6. For both cycles, verify persistent linkage among:
   - mission and capability decision;
   - governance decision/approval;
   - prompt composition and routing decision;
   - provider execution;
   - evaluation before acceptance;
   - evidence and capability/learning update;
   - automatic next-mission rationale.
7. Replace or restart the runtime and verify that execution, evaluation, approval, evidence, and continuation state remain available.
8. Confirm Forge Desktop displays the same authoritative state, without separate demo data.
9. Scan logs, persisted state, generated evidence, and Git changes for secrets.
10. Only if all criteria pass:
    - generate `reconstruction/AUTONOMOUS_PROVIDER_LOOP_VERIFICATION.json`;
    - mark Roadmap Phase R3 verified;
    - update `CURRENT_STATE.md`;
    - replace `NEXT_MISSION.md` with the first Phase R4 mission derived from observed capability evidence;
    - commit and push according to repository governance.

Do not begin the canonical Learning Engine until this live Phase R3 closure is proven.

## Constraints

- Inspect current source before adding a new engine.
- Reuse mission, capability, evaluation and Project Memory evidence.
- Keep scoring explainable and deterministic before adding model-assisted learning.
- Do not implement the full junior-to-senior capability matrix in this first mission.
- Keep Human Intent Understanding and alternative-to-code research out of the operational runtime until separately validated.
- Update CURRENT_STATE, ROADMAP and this handoff in the same verified commit.
