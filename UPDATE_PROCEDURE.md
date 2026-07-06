# Forge Core — Update Procedure

Safe procedure for updating a running Forge Core installation to a newer version of the codebase.

## 0. Before you start

- Read the release notes / commit log for breaking changes (especially schema changes).
- Plan a short maintenance window: the app restarts during the update.

## 1. Backup first (mandatory)

```sh
./scripts/src/backup.sh
# note the produced filenames — they are your rollback point:
#   storage/backups/forge-db-<stamp>.sql
#   storage/backups/forge-storage-<stamp>.tar.gz
```

## 2. Fetch the update

```sh
git fetch origin
git log --oneline HEAD..origin/main     # review incoming changes
git pull --ff-only origin main
```

(Zip-based installs: unpack the new version over the project directory, keeping `.env` and `storage/`.)

## 3. Install dependencies & run migrations

```sh
corepack enable
pnpm install --frozen-lockfile
./scripts/src/migrate.sh                # applies schema changes (Drizzle push)
```

## 4. Build

```sh
pnpm run build                          # typecheck + build all packages
```

Stop here if the build fails — the running old version is untouched until step 6.

## 5. Tests

```sh
pnpm run typecheck                      # full typecheck across all packages
```

Then run the smoke checks from `VERIFICATION_CHECKLIST.md` sections 1–4 against the updated build (start it on a spare port with `PORT=5001 node artifacts/api-server/dist/index.mjs` if you want to verify before switching over).

## 6. Restart the app

```sh
# systemd:
sudo systemctl restart forge-core

# manual:
#   stop the old process (Ctrl+C / kill <pid>), then:
node artifacts/api-server/dist/index.mjs

# Docker Compose:
docker compose up -d --force-recreate app
```

## 7. Verify

```sh
curl -fsS http://localhost:5000/api/healthz
```

Open the dashboard, check that data is intact, and run through `VERIFICATION_CHECKLIST.md` (at least sections 1–5).

## 8. Rollback on problems

If the new version misbehaves:

```sh
# 1. Stop the app.

# 2. Restore the code to the previous version:
git log --oneline -5                    # find the previous commit
git checkout <previous-commit>          # or: git reset --hard <previous-commit>

# 3. Reinstall dependencies for that version:
pnpm install --frozen-lockfile

# 4. Roll the database back to the pre-update backup
#    (needed when the update changed the schema):
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" < storage/backups/forge-db-<stamp>.sql

# 5. Restore storage if it was affected:
tar -xzf storage/backups/forge-storage-<stamp>.tar.gz

# 6. Rebuild and restart:
pnpm run build
node artifacts/api-server/dist/index.mjs   # or systemctl / docker compose

# 7. Verify:
curl -fsS http://localhost:5000/api/healthz
```

Data created **between** the backup and the rollback is lost — this is why step 1 (backup immediately before updating) is mandatory and the window should be short.
