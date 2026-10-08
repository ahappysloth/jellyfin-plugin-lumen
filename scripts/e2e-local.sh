#!/usr/bin/env bash
# Runs the E2E suite against the local portable dev server (see scripts/dev.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -d "$ROOT/e2e/fixtures/media/movies" ]] || "$ROOT/scripts/gen-test-media.sh"
"$ROOT/scripts/dev.sh"
cd "$ROOT/e2e"
LUMEN_E2E_MEDIA_PATH="$ROOT/e2e/fixtures/media" npx playwright test "$@"
