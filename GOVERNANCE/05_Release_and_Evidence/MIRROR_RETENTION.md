# Mirror retention and source authority

Mirror is a read-only projection. It does not own mission, approval, audit,
evidence, artifact, result, or memory records and has no persistence store.
`missionId` is the primary projection key. A nested record inherits `missionId`
from its authoritative mission parent; an explicit conflicting source value is
reported as an integrity warning and is never silently rewritten.

No automatic destructive cleanup is introduced by `MIRROR_PROJECTION_01`.

| Storage type | Authority and persistence | Retention and removal | Restart and missing-source behavior |
| --- | --- | --- | --- |
| Mission state | Authoritative, atomic runtime JSON in `storage/forge-runtime/missions.json` | Explicitly unlimited; only reviewed governance or operator maintenance may remove records | Reloaded on restart. Mirror returns 404 for an unknown mission and never synthesizes one. |
| Approvals | Authoritative, atomic runtime JSON in `storage/forge-runtime/governance.json` | Explicitly unlimited; no automatic cleanup | Reloaded on restart. A required but absent approval is exposed as `missing approval`. |
| AI input/output | Authoritative execution records in `storage/forge-runtime/ai-gateway.json`; prompt compositions in `operator-core.json` | Existing bounded retention: newest 100 AI executions and newest 50 prompt compositions. Older records fall outside the live store when a new record is persisted. | Reloaded on restart. Missing execution data remains a visible absent timeline segment; Mirror does not reconstruct provider output. |
| Runtime audit | Persistent action receipts nested in authoritative mission output; the runtime event bus is derived and in-memory only | Nested receipts follow mission retention. Event history retains the newest 500 events and disappears on restart. Legacy relational `audit_logs` remain under their existing governance and are not promoted to mission truth. | Mirror uses persistent receipts, not the event bus, for restart-safe audit events. Missing receipts are not invented. |
| Evidence | Authoritative project-memory evidence in `operator-core.json`, learning observations in `learning.json`, and execution evidence nested in mission output | Explicitly unlimited for project memories and learning observations; follows mission retention when nested | Reloaded on restart. Required absent execution evidence is exposed as `missing evidence`. |
| Artifacts | Authoritative artifact metadata/content nested in mission execution evidence; referenced filesystem/Git effects remain authoritative at their original paths | Follows the containing mission and existing workspace/Git governance; no Mirror cleanup | Mirror adds the parent `missionId` only to its response shape. Missing artifacts stay absent; conflicting source correlation gets an integrity warning. |
| Mirror projection | Derived, read-only, non-persistent | No retention and no deletion process because nothing is stored | Recomputed from current authoritative stores after every request and restart. Missing links and duplicate source records remain visible. |
| Temporary logs | Derived Pino stdout/stderr and transient process output | Process/supervisor policy; no repository retention guarantee | Not restart-persistent and never used as Mirror history. |
| Memory | Project memory is authoritative atomic JSON; Memory Bridge records are append-only JSONL plus current-context JSON | Project memory is explicitly unlimited. Memory Bridge files are not truncated; its in-memory search window retains the newest 10,000 loaded/appended records. Removal requires reviewed governance. | Reloaded on restart. Mirror reads correlated project evidence but creates no memory entry. Missing memory never creates replacement truth. |

## Correlation rules

1. Approval records use their authoritative `missionId`.
2. AI executions and learning observations are included only when their
   authoritative `missionId` equals the projected mission.
3. Project-memory evidence is included only when its source or content carries
   the exact mission identifier.
4. Runtime action receipts and artifacts inherit correlation from the mission
   output that contains them. Their source IDs remain unchanged.
5. Guardian reviews and Governor decisions remain authoritative in their
   existing relational module-evolution stores. Those legacy records have no
   mission correlation contract, so Mirror does not guess a link and reports
   the missing assessment links instead.
6. Duplicate source records are retained in the response and marked; Mirror
   never deduplicates authoritative history silently.