# Claude Mirror session progress

`MIRROR_SESSION_01` is a read-only projection. It persists no session or status.
Exactly one stable `sessionId` is derived from each authoritative `missionId`.

Completion is the sum of evidence-backed timeline milestones:

| Milestone | Required event | Percentage |
|---|---|---:|
| Input | `input_received` | 10 |
| Interpretation | `interpretation_created` | 10 |
| Approval decision | `approval_granted` or `approval_rejected` | 10 |
| Execution started | `execution_started` | 10 |
| Execution completed | `execution_completed` | 15 |
| Evidence | `evidence_created` | 15 |
| Review | `evaluation_completed` or `guardian_reviewed` | 10 |
| Guardian | `guardian_reviewed` | 5 |
| Governor | `governor_released` or `governor_blocked` | 5 |
| Result | `result_published` | 10 |

Missing events contribute zero. Elapsed time, mission age, model output and
operator expectation never affect progress. A terminal mission can therefore
show less than 100% when its persisted evidence chain is incomplete.