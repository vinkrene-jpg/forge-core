#!/usr/bin/env sh
# Forge Core — apply database schema changes (Drizzle push).
set -e
pnpm --filter @workspace/db run push
echo "Database schema is up to date."
