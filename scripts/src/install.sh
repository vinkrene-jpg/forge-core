#!/usr/bin/env sh
# Forge Core — installation script (Linux/macOS; on Windows use Git Bash or WSL)
set -e

echo "── Forge Core install ──────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 24+ is required. Install it from https://nodejs.org"
  exit 1
fi

corepack enable >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit it with your DATABASE_URL and AI keys."
fi

echo "Installing dependencies…"
pnpm install

echo "Applying database schema…"
pnpm --filter @workspace/db run push

mkdir -p storage/sandboxes storage/snapshots storage/backups

echo "Done. Start the API server with:"
echo "  pnpm --filter @workspace/api-server run dev"
echo "and the dashboard with:"
echo "  pnpm --filter @workspace/forge-core run dev"
