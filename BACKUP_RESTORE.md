# Forge Core — Backup & Restore

All persistent state lives in the PostgreSQL database and the storage directory (`STORAGE_DIR`, default `./storage`). A backup therefore always has two parts: a SQL dump and a storage archive.

## 1. Making a backup

```sh
./scripts/src/backup.sh                 # default output: storage/backups/
./scripts/src/backup.sh /path/to/dir    # custom output directory
```

This produces two timestamped files:

- `forge-db-<stamp>.sql` — full database dump (projects, tasks, modules, test runs, approvals, guardian reviews, governor decisions, memory, improvements, audit logs, locked core registry)
- `forge-storage-<stamp>.tar.gz` — storage archive (sandbox files, snapshots; `storage/backups` itself is excluded)

Docker Compose variant:

```sh
docker compose exec db pg_dump -U forge forge > forge-db-$(date +%Y%m%d-%H%M%S).sql
docker compose cp app:/app/storage ./storage-backup
tar -czf forge-storage-$(date +%Y%m%d-%H%M%S).tar.gz storage-backup
```

Recommended schedule: daily backup via cron, e.g.

```cron
0 3 * * * cd /opt/forge-core && ./scripts/src/backup.sh /var/backups/forge-core
```

Keep backups **outside** the machine (external disk, object storage) for real disaster recovery.

## 2. Restore

Stop the app first, then:

```sh
./scripts/src/restore.sh <forge-db-STAMP.sql> [forge-storage-STAMP.tar.gz]
```

- First argument: SQL dump → replayed into `DATABASE_URL`
- Second argument (optional): storage archive → unpacked into `./storage`

The dump contains `CREATE TABLE` statements. When restoring into a database that already has tables, reset it first:

```sh
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
./scripts/src/restore.sh forge-db-<stamp>.sql forge-storage-<stamp>.tar.gz
```

Restart the app afterwards and run the healthcheck (`curl -fsS http://localhost:5000/api/healthz`).

## 3. Database rollback

To roll the database back to an earlier point:

```sh
# 1. Stop the app
# 2. Reset and restore the chosen dump
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" < storage/backups/forge-db-<older-stamp>.sql
# 3. Restart the app
```

Note: this rolls back **everything** in the database (including audit logs and approvals) to that moment. For rolling back a *single module* installation, use the built-in per-module rollback instead: `POST /api/modules/:id/rollback` (or the Rollback button in the Modules page) — it restores the module from its pre-install snapshot without touching anything else.

## 4. Storage rollback

```sh
# 1. Stop the app
mv storage storage.broken-$(date +%s)          # keep the current state aside
tar -xzf storage/backups/forge-storage-<stamp>.tar.gz   # from the copy kept aside, or a saved backup
# 2. Restart the app
```

Keep database and storage from the **same backup moment** together: sandbox rows in the database reference directories on disk. Mixing a new database with old storage (or vice versa) leads to sandboxes whose files are missing.

## 5. Full disaster recovery procedure

Scenario: the machine is lost; you have the two backup files.

1. Provision a new machine and install Forge Core per `INSTALL.md` (any option).
2. Recreate `.env` from `.env.example` (secrets are not in backups — re-enter them).
3. Restore both parts:
   ```sh
   ./scripts/src/restore.sh forge-db-<stamp>.sql forge-storage-<stamp>.tar.gz
   ```
4. Start the app.
5. Verify:
   ```sh
   curl -fsS http://localhost:5000/api/healthz
   psql "$DATABASE_URL" -c "SELECT count(*) FROM core_components WHERE locked = true;"   # 13
   psql "$DATABASE_URL" -c "SELECT count(*) FROM modules;"                               # expected count
   ls storage/sandboxes
   ```
6. Run through `VERIFICATION_CHECKLIST.md`.
