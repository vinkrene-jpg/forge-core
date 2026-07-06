# Forge Core — Migration Guide (Replit → local machine)

This document describes how to move a running Forge Core instance out of Replit (or any machine) onto a local machine, including database and storage.

Forge Core state lives in exactly three places:

1. **The codebase** (this repository)
2. **The PostgreSQL database** (`DATABASE_URL`) — projects, tasks, modules, test runs, approvals, memory, audit logs, everything
3. **The storage directory** (`STORAGE_DIR`, default `./storage`) — sandbox files on disk, snapshots, backups

Migrate all three and the instance is fully moved.

## 1. Export from Replit

### 1a. Code export

Either:

- **Git**: push the repository to GitHub/GitLab and clone it locally, or
- **Zip download**: use Replit's "Download as zip" and unpack locally.

### 1b. Database export

In the Replit shell:

```sh
pg_dump "$DATABASE_URL" > forge-db-export.sql
```

Or use the backup script (produces both dumps at once):

```sh
./scripts/src/backup.sh          # writes to storage/backups/
```

### 1c. Storage export

```sh
tar -czf forge-storage-export.tar.gz --exclude="backups" storage
```

(Skip this if you used `backup.sh` — it already produced `forge-storage-<stamp>.tar.gz`.)

Download `forge-db-export.sql` and `forge-storage-export.tar.gz` (they are included in the zip download if you place them in the project first).

## 2. Import on the local machine

### 2a. Install Forge Core

Follow `INSTALL.md` (Docker Compose, Linux, or Windows + WSL). Stop after installation — do not create any data yet.

### 2b. Configure .env

```sh
cp .env.example .env
# set at minimum: DATABASE_URL, and AI keys if you use them
```

Note: secrets (AI keys, SESSION_SECRET) are **not** part of any export. Re-enter them manually in the local `.env`.

### 2c. Database import

The dump contains `CREATE TABLE` statements, so import into an **empty** database:

```sh
# Manual PostgreSQL:
createdb forge          # or: sudo -u postgres createdb -O forge forge
psql "$DATABASE_URL" < forge-db-export.sql

# Docker Compose (db service must be up):
docker compose up -d db
docker compose exec -T db psql -U forge -d forge < forge-db-export.sql
```

If the local database already has tables (e.g. you ran the install script's schema push), drop and recreate it first:

```sh
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" < forge-db-export.sql
```

Or use the restore script:

```sh
./scripts/src/restore.sh forge-db-export.sql
```

### 2d. Storage import

```sh
# Manual install (from the project root):
tar -xzf forge-storage-export.tar.gz          # recreates ./storage/...

# Docker Compose (storage lives in the forge_storage volume):
tar -xzf forge-storage-export.tar.gz          # extract to ./storage first
docker compose up -d app                      # let it create the volume, then:
docker compose cp storage/. app:/app/storage/
```

Or use the restore script with both arguments:

```sh
./scripts/src/restore.sh forge-db-export.sql forge-storage-export.tar.gz
```

### 2e. Start

```sh
docker compose up -d            # or the manual start commands from INSTALL.md
```

## 3. Post-migration verification

Run through `VERIFICATION_CHECKLIST.md` in full. Minimum quick check:

```sh
# 1. App healthy (checks DB + storage):
curl -fsS http://localhost:5000/api/healthz

# 2. Data arrived — counts should match the old environment:
psql "$DATABASE_URL" -c "SELECT
  (SELECT count(*) FROM modules)      AS modules,
  (SELECT count(*) FROM tasks)        AS tasks,
  (SELECT count(*) FROM audit_logs)   AS audit_logs,
  (SELECT count(*) FROM memory_items) AS memory_items;"

# 3. Locked Core registry present (must be 13):
psql "$DATABASE_URL" -c "SELECT count(*) FROM core_components WHERE locked = true;"

# 4. Storage arrived:
ls storage/sandboxes            # sandbox directories present

# 5. Dashboard opens:
#    http://localhost:5000 → Dashboard shows the migrated projects/modules
```

Record the row counts on the old machine **before** migrating so you can compare.

## Notes

- The Locked Core registry is re-seeded automatically at startup if missing — but after a correct DB import it is simply the migrated data.
- `storage/backups/` is intentionally excluded from the storage archive; copy old backups separately if you want to keep them.
- Timezone: timestamps are stored in UTC; no conversion needed.
