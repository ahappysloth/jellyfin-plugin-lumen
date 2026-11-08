#!/usr/bin/env bash
# Runs the E2E suite against the local portable dev server (see scripts/dev.sh). Linux (including WSL2) and macOS.
# Extra arguments go to `playwright test`, e.g. `./scripts/e2e-local.sh specs/home.spec.ts --headed`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -d "$ROOT/e2e/fixtures/media/movies" ]] || "$ROOT/scripts/gen-test-media.sh"
"$ROOT/scripts/dev.sh"
cd "$ROOT/e2e"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
npx playwright install chromium
LUMEN_E2E_MEDIA_PATH="$ROOT/e2e/fixtures/media" npx playwright test "$@"
