# Forge Core — Local Verification Checklist

Run through this checklist after a fresh install, a migration, or an update. All commands assume the app runs on port 5000; adjust for a custom `PORT`.

Tip: pipe JSON responses through `node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')),null,2))"` (or `jq`) for readability.

## 1. App starts

- [ ] App process starts without errors (manual: console shows the listen line; Docker: `docker compose ps` shows the app as `healthy` after the first build)
- [ ] `curl -fsS http://localhost:5000/api/healthz` returns `{"status":"ok",...}`

## 2. Dashboard opens

- [ ] http://localhost:5000 loads the dashboard (dark mission-control UI)
- [ ] The summary cards show data (modules, tasks, approvals, audit)
- [ ] All 13 navigation sections open without errors

## 3. Database works

- [ ] `psql "$DATABASE_URL" -c "SELECT 1"` succeeds
- [ ] Locked Core seeded: `psql "$DATABASE_URL" -c "SELECT count(*) FROM core_components WHERE locked = true;"` returns **13**
- [ ] After migration: row counts of `modules`, `tasks`, `audit_logs`, `memory_items` match the old environment

## 4. Storage works

- [ ] `storage/` exists with subdirectories `sandboxes/`, `snapshots/`, `backups/` (created automatically at startup)
- [ ] Healthz reports storage OK

## 5. Module + sandbox creation

- [ ] Create a module:
  ```sh
  curl -fsS -X POST http://localhost:5000/api/modules -H 'Content-Type: application/json' -d '{
    "name":"verify-module","type":"planner","purpose":"local verification","version":"0.1.0",
    "riskLevel":"low","ownerAgent":"owner",
    "manifest":"{\"name\":\"verify-module\",\"version\":\"0.1.0\"}"
  }'
  ```
- [ ] Create a sandbox linked to it (use the returned module id):
  ```sh
  curl -fsS -X POST http://localhost:5000/api/sandboxes -H 'Content-Type: application/json' \
    -d '{"name":"verify-sandbox","purpose":"local verification","moduleId":<MODULE_ID>}'
  ```
- [ ] Add files (a `package.json` with a `test` script and a passing test file):
  ```sh
  curl -fsS -X POST http://localhost:5000/api/sandboxes/<SANDBOX_ID>/files -H 'Content-Type: application/json' \
    -d '{"path":"package.json","content":"{\"name\":\"verify\",\"version\":\"1.0.0\",\"scripts\":{\"test\":\"node test.js\"}}"}'
  curl -fsS -X POST http://localhost:5000/api/sandboxes/<SANDBOX_ID>/files -H 'Content-Type: application/json' \
    -d '{"path":"test.js","content":"console.log(\"ok\"); process.exit(0);"}'
  ```
- [ ] Writing a core path is refused with 403: `POST .../files` with `{"path":"core/x.ts",...}`

## 6. Real test runner

- [ ] Start a real run:
  ```sh
  curl -fsS -X POST http://localhost:5000/api/test-runs -H 'Content-Type: application/json' \
    -d '{"moduleId":<MODULE_ID>,"mode":"real","types":["unit"]}'
  ```
- [ ] Run status is `passed`; `GET /api/test-runs/<RUN_ID>` shows steps (install, unit) with stdout and durations
- [ ] A run **without** `"unit"` in types is refused (400)
- [ ] Tests page in the dashboard shows the run with expandable steps and a `real` badge

## 7. AI Guardian

- [ ] Rule-based review works: `POST /api/modules/<MODULE_ID>/guardian-review` returns an outcome
- [ ] With an AI key configured: `POST /api/modules/<MODULE_ID>/ai-guardian-review` returns a combined review (`reviewer: "ai"`, summary, model)
- [ ] Without an AI key: the same call returns a clear 400 error (not a crash)

## 8. Governor decision, approval, installation

- [ ] Trigger install: `POST /api/modules/<MODULE_ID>/install`
- [ ] Governor decision recorded: `GET /api/governor-decisions` shows `install_allowed` (low risk, all green) or `review_required`
- [ ] If `review_required`: an approval appears (`GET /api/approvals`), decide it:
  ```sh
  curl -fsS -X POST http://localhost:5000/api/approvals/<APPROVAL_ID>/decide -H 'Content-Type: application/json' \
    -d '{"approve":true,"decidedBy":"owner"}'
  ```
- [ ] Rejecting without a reason returns 400
- [ ] After approval + install: module status is installed/active and a snapshot exists (`GET /api/modules/<MODULE_ID>/snapshots`)

## 9. Rollback

- [ ] `POST /api/modules/<MODULE_ID>/rollback` restores the pre-install state (status `rolled_back`)
- [ ] The rollback is visible in the audit log

## 10. Memory

- [ ] `POST /api/memory-items` stores an item; `GET /api/memory-items` returns it
- [ ] Improvements: `POST /api/improvements` + convert to task works

## 11. Daily loop

- [ ] `POST /api/daily-loop/run` completes and produces a report
- [ ] `GET /api/daily-loop/runs` lists the run

## 12. Audit log

- [ ] `GET /api/audit-logs` shows entries for every action above (module create, test run, governor decision, approval, install, rollback)
- [ ] Attempting to modify a core component without override returns 403 **and** produces a `blocked` audit entry

## 13. Backup

- [ ] `./scripts/src/backup.sh` produces both files in `storage/backups/`
- [ ] The SQL dump is non-empty and contains `CREATE TABLE`; the tar.gz contains `storage/sandboxes`

## 14. Restore

- [ ] On a scratch database (`createdb forge_verify`): `DATABASE_URL=postgres://.../forge_verify ./scripts/src/restore.sh <dump.sql>` succeeds
- [ ] Row counts in the scratch database match the source
- [ ] (Full drill) `BACKUP_RESTORE.md` §5 executed successfully on a clean machine or container

## Cleanup

Remove the verification module/sandbox afterwards (`DELETE /api/modules/<MODULE_ID>`, `DELETE /api/sandboxes/<SANDBOX_ID>`) or keep them as reference.
