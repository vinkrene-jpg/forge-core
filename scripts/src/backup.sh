#!/usr/bin/env sh
# Forge Core — backup script: dumps the database and storage directory.
# Usage: ./scripts/src/backup.sh [output-dir]
set -e

OUT_DIR="${1:-storage/backups}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT_DIR"

if [ -z "$DATABASE_URL" ] && [ -f .env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set (env or .env)"
  exit 1
fi

echo "Dumping database…"
pg_dump "$DATABASE_URL" > "$OUT_DIR/forge-db-$STAMP.sql"

echo "Archiving storage…"
tar -czf "$OUT_DIR/forge-storage-$STAMP.tar.gz" --exclude="backups" storage 2>/dev/null || true

echo "Backup complete:"
echo "  $OUT_DIR/forge-db-$STAMP.sql"
echo "  $OUT_DIR/forge-storage-$STAMP.tar.gz"
