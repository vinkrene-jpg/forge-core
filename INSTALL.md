# Forge Core — Installation & Operations

Forge Core is fully portable: it runs anywhere Node.js 24+ and PostgreSQL are available. All configuration lives in `.env` — there are no hosting-platform dependencies for core functionality.

## Requirements

- Node.js 24+ (with corepack/pnpm)
- PostgreSQL 14+ (local, Docker, or managed)
- Optional: Docker + Docker Compose for one-command deployment

## Option 1 — Docker Compose (easiest)

```sh
cp .env.example .env      # edit AI keys if desired
docker compose up -d
```

The app is then available at http://localhost:5000 and data persists in Docker volumes (`forge_pgdata`, `forge_storage`).

## Option 2 — Manual install

### Linux / macOS

```sh
./scripts/src/install.sh
```

### Windows

Use **Git Bash** or **WSL** and run the same script, or do it manually in PowerShell:

```powershell
corepack enable
pnpm install
copy .env.example .env    # then edit .env (DATABASE_URL etc.)
pnpm --filter @workspace/db run push
mkdir storage
```

### Running

```sh
# API server (port from .env, default 5000)
pnpm --filter @workspace/api-server run dev

# Dashboard (Vite dev server)
pnpm --filter @workspace/forge-core run dev
```

For production, build once and run the bundle:

```sh
pnpm run build
node artifacts/api-server/dist/index.cjs
```

## Configuration (.env)

See `.env.example` for the full annotated list. Key entries:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `PORT` | API server port |
| `STORAGE_DIR` | Directory for sandboxes, snapshots, backups |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CUSTOM_AI_API_KEY` | AI Gateway providers |
| `AI_DEFAULT_PROVIDER`, `AI_FALLBACK_PROVIDER` | Provider selection |
| `AI_ROUTE_<TASKTYPE>` | Per-task-type provider routing |
| `CORE_ADMIN_OVERRIDE` | Owner-only override for the Locked Core (leave unset) |

## Database migrations

```sh
./scripts/src/migrate.sh        # applies the current schema (Drizzle push)
```

## Backup & restore

```sh
./scripts/src/backup.sh                         # dumps DB + storage to storage/backups
./scripts/src/restore.sh <db.sql> [storage.tar.gz]
```

Backups contain everything needed to move Forge Core to another machine: the SQL dump (all projects, tasks, modules, memory, audit history) and the storage archive (sandbox files, snapshots).

## Moving to another environment

1. Run a backup on the old machine.
2. Install Forge Core on the new machine (either option above).
3. Copy the backup files over and run the restore script.
4. Copy your `.env` (or recreate it from `.env.example`).
