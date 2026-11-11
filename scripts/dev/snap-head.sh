#!/usr/bin/env bash
# Puts the COMMITTED tree (HEAD) of this checkout into a copy under C:\tmp for Playwright runs, so
# edits made while a browser test runs never hot-reload the page under test, and uncommitted work
# never reaches a run. Usage, from anywhere:
#   bash scripts/dev/snap-head.sh [destination, default /c/tmp/<checkout name>-e2e]
#   cd <destination> && E2E_PORT=5192 npx playwright test e2e/<spec>
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DST="${1:-/c/tmp/$(basename "$SRC")-e2e}"
# The main checkout holds the real node_modules; every worktree junctions to it.
MAIN="$(git -C "$SRC" worktree list --porcelain | head -1 | cut -d' ' -f2-)"
mkdir -p "$DST"
# Everything but the node_modules junction and old results goes; never the junction's target.
find "$DST" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name test-results -exec rm -rf {} +
git -C "$SRC" archive HEAD | tar -x -C "$DST"
if [ ! -e "$DST/node_modules" ]; then
  powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$(cygpath -w "$DST")\\node_modules' -Target '$(cygpath -w "$MAIN")\\node_modules' | Out-Null"
fi
echo "snapshot of $(git -C "$SRC" rev-parse --short HEAD) ready in $DST"
