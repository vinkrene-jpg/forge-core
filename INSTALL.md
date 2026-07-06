# Forge Core — Installation & Operations

Forge Core is fully portable: it runs anywhere Node.js 24+ and PostgreSQL are available. All configuration lives in `.env` — there are no hosting-platform dependencies for core functionality.

Related documents:

- `MIGRATION.md` — moving Forge Core from Replit (or any machine) to a local machine
- `BACKUP_RESTORE.md` — backup, restore, and rollback procedures
- `UPDATE_PROCEDURE.md` — safe update procedure
- `VERIFICATION_CHECKLIST.md` — post-install / post-migration verification checklist

## Required versions

| Component | Version | Notes |
|---|---|---|
| Node.js | **24.x** (minimum 24.0) | includes corepack |
| pnpm | **9.x or 10.x** | via `corepack enable` (repo pins the exact version in `package.json` / lockfile) |
| PostgreSQL | **14+** (16 recommended) | local, Docker, or managed |
| Docker | **24+** with Docker Compose **v2.24+** | only for the Docker Compose option (compose ≥ 2.24 is needed for optional `env_file`) |

## Option 1 — Docker Compose (easiest)

```sh
cp .env.example .env      # edit AI keys if desired (optional; compose works without .env)
docker compose up -d
```

- App: http://localhost:5000
- Data persists in Docker volumes: `forge_pgdata` (database), `forge_storage` (sandboxes/snapshots/backups)
- The app service installs dependencies, pushes the DB schema and builds on first start — the first boot can take several minutes (healthcheck `start_period` allows for this).

### Start / stop / restart (Docker)

```sh
docker compose up -d            # start (detached)
docker compose stop             # stop containers (keep volumes)
docker compose restart app      # restart only the app
docker compose down             # stop and remove containers (volumes preserved)
docker compose down -v          # DANGER: also deletes database + storage volumes
docker compose logs -f app      # follow app logs
docker compose logs -f db       # follow database logs
docker compose ps               # status + health of services
```

### Healthcheck (Docker)

```sh
curl -fsS http://localhost:5000/api/healthz     # {"status":"ok",...}
docker compose ps                               # shows (healthy) when both healthchecks pass
docker compose exec db pg_isready -U forge      # database healthcheck
```

## Option 2 — Linux (manual)

```sh
# 1. Prerequisites: Node.js 24+, PostgreSQL running, git
corepack enable

# 2. Install
./scripts/src/install.sh        # pnpm install, .env from template, schema push, storage dir

# 3. Edit .env — at minimum DATABASE_URL
```

### Start / stop / restart (manual)

```sh
# Development (two terminals):
pnpm --filter @workspace/api-server run dev     # API server (PORT from .env, default 5000)
pnpm --filter @workspace/forge-core run dev     # Dashboard (Vite dev server)

# Production (single bundle, serves API):
pnpm run build
node artifacts/api-server/dist/index.mjs        # start
# stop: Ctrl+C (or kill <pid>); restart: run the command again

# As a systemd service (recommended for servers): create
# /etc/systemd/system/forge-core.service with
#   ExecStart=/usr/bin/node /opt/forge-core/artifacts/api-server/dist/index.mjs
#   EnvironmentFile=/opt/forge-core/.env
#   Restart=always
# then: sudo systemctl enable --now forge-core
sudo systemctl start forge-core
sudo systemctl stop forge-core
sudo systemctl restart forge-core
sudo systemctl status forge-core
```

### Healthcheck (manual)

```sh
curl -fsS http://localhost:5000/api/healthz     # {"status":"ok",...} — checks DB + storage
psql "$DATABASE_URL" -c "SELECT 1"              # database reachable
```

## Option 3 — Windows + WSL

1. Install WSL2 with Ubuntu: `wsl --install` (PowerShell as administrator), then reboot.
2. Inside the WSL terminal, install prerequisites:

```sh
# Node.js 24 (via nodesource or nvm)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-client
corepack enable

# Start PostgreSQL and create the database
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER forge WITH PASSWORD 'forge' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE forge OWNER forge;"
```

3. Clone/copy the project **inside the WSL filesystem** (e.g. `~/forge-core`, not `/mnt/c/...` — much faster and avoids permission issues), then:

```sh
./scripts/src/install.sh
# edit .env: DATABASE_URL=postgres://forge:forge@localhost:5432/forge
```

4. Start/stop/restart and healthchecks: same commands as Linux above. The app is reachable from Windows at http://localhost:5000.

Alternative on Windows: Docker Desktop with WSL2 backend + Option 1 (Docker Compose) — no manual Node/PostgreSQL setup needed.

## Configuration (.env)

See `.env.example` for the full annotated list. Key entries:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `PORT` | API server port (default 5000) |
| `STORAGE_DIR` | Directory for sandboxes, snapshots, backups |
| `SESSION_SECRET` | Random string for session signing |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CUSTOM_AI_*` | AI Gateway providers (Custom = any OpenAI-compatible endpoint, e.g. Ollama) |
| `AI_DEFAULT_PROVIDER`, `AI_FALLBACK_PROVIDER` | Provider selection |
| `AI_ROUTE_<TASKTYPE>` | Per-task-type provider routing |
| `TEST_SECRET_ALLOWLIST` | Env vars allowed inside the real test runner sandbox |
| `REAL_TEST_STEP_TIMEOUT_MS` | Per-step timeout for real test execution |
| `CORE_ADMIN_OVERRIDE` | Owner-only override for the Locked Core (leave unset) |

## Database migrations

```sh
./scripts/src/migrate.sh        # applies the current schema (Drizzle push)
```

## Backup & restore

See `BACKUP_RESTORE.md`. Short version:

```sh
./scripts/src/backup.sh                         # dumps DB + storage to storage/backups
./scripts/src/restore.sh <db.sql> [storage.tar.gz]
```

## Known limitations

1. **No authentication**: the API and dashboard have no login. Run Forge Core only on a trusted network (localhost or behind a reverse proxy with auth). Do not expose port 5000 to the internet.
2. **AI Guardian requires an API key**: without `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `CUSTOM_AI_*`, AI reviews and AI invocations return a clear 400 error. The rule-based Guardian and the rest of the platform work without keys.
3. **Real test runner requires strict local isolation**: sandboxed module code runs under the Node.js permission model with a restricted environment, but non-Node child processes are a residual risk. Run the platform under a dedicated OS user with minimal permissions; for production, running the test runner inside a dedicated Docker container is recommended.
4. **Docker app service not yet proven end-to-end on a local machine**: `docker-compose.yml` is provided and the configuration is validated, but the full `docker compose up` boot has not been executed in the development environment (no Docker available there). Verify locally with `VERIFICATION_CHECKLIST.md`.
