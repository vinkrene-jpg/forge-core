#!/usr/bin/env sh
# Forge Core — restore script.
# Usage: ./scripts/src/restore.sh <db-dump.sql> [storage-archive.tar.gz]
set -e

DB_DUMP="$1"
STORAGE_ARCHIVE="$2"

if [ -z "$DB_DUMP" ] || [ ! -f "$DB_DUMP" ]; then
  echo "Usage: $0 <db-dump.sql> [storage-archive.tar.gz]"
  exit 1
fi

if [ -z "$DATABASE_URL" ] && [ -f .env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set (env or .env)"
  exit 1
fi

echo "Restoring database from $DB_DUMP…"
psql "$DATABASE_URL" < "$DB_DUMP"

if [ -n "$STORAGE_ARCHIVE" ] && [ -f "$STORAGE_ARCHIVE" ]; then
  echo "Restoring storage from $STORAGE_ARCHIVE…"
  tar -xzf "$STORAGE_ARCHIVE"
fi

echo "Restore complete."
