#!/usr/bin/env bash
# Next.js hangs on cold start when the project lives under a path containing '&'.
# This mirrors the app to /tmp/atlas-clean and runs the dev server there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/tmp/atlas-clean
PORT="${PORT:-3055}"

mkdir -p "$DEST"
rsync -a --delete --exclude node_modules --exclude .next "$ROOT/" "$DEST/"
cd "$DEST"
if [[ ! -d node_modules ]]; then
  npm install --no-audit --no-fund
fi
echo "ATLAS demo → http://127.0.0.1:${PORT}"
echo "(mirrored from path with '&' to avoid Next hang)"
exec npx next dev --port "$PORT" -H 127.0.0.1
