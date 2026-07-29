# Forge Memory Bridge

## Purpose

Forge Memory Bridge is the durable memory layer for Forge Runtime.
It stores only persistent project intelligence and operational context, independent of chat history.

Primary objective:

- Forge never depends on chat history as primary knowledge source.

## Storage root

Default in standalone startup (`pnpm forge:start`):

- `D:\Forge\memory`

Override:

- `FORGE_MEMORY_BRIDGE_ROOT`

Runtime fallback (when launcher override is not used):

- `storage/memory-bridge`

## Durable artifacts

Forge stores:

- durable decisions
- capability evidence
- lessons learned
- durable knowledge entries
- current context snapshot

Data files are local JSONL / JSON files under the bridge root.

## Automatic loop integration

1. After each mission result event (succeeded/failed/rejected), Forge captures durable mission knowledge.
2. At each new autonomous AI cycle, Forge retrieves relevant durable context and injects it into prompt composition.

This ensures new AI sessions start from persistent memory, not chat logs.

## API

- `GET /api/memory-bridge`
- `GET /api/memory-bridge/context?query=...&limit=...`
- `GET /api/memory-bridge/search?query=...&limit=...`
- `POST /api/memory-bridge/decisions`
- `POST /api/memory-bridge/learning`
- `POST /api/memory-bridge/capabilities`
- `PUT /api/memory-bridge/current-context`

## Example requests

### Record decision

```json
POST /api/memory-bridge/decisions
{
  "title": "Adopt dependency-scoped failure domains",
  "content": "Provider failures must not block unrelated deterministic branches.",
  "tags": ["governance", "failure-domain"],
  "sourceMissionId": "<mission-id>"
}
```

### Update current context

```json
PUT /api/memory-bridge/current-context
{
  "summary": "Focus on provider bridge hardening and deterministic verification.",
  "priorities": ["workspace bridge", "mission throughput"],
  "blockers": ["none"],
  "activeMissionIds": ["<mission-id>"]
}
```
