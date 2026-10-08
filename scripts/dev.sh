#!/usr/bin/env bash
# Build the plugin, deploy it into the portable dev server, and (re)start the server on :8096.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"

VERSION="$(grep -oP '(?<=<Version>)[^<]+' "$ROOT/Directory.Build.props")"
dotnet publish "$ROOT/src/Jellyfin.Plugin.Lumen" -c Debug -o "$ROOT/artifacts/plugin" --nologo -v quiet

rm -rf "$LUMEN_DEV_HOME/data/plugins"/Lumen_*
PLUGIN_DIR="$LUMEN_DEV_HOME/data/plugins/Lumen_$VERSION"
mkdir -p "$PLUGIN_DIR"
cp "$ROOT/artifacts/plugin/Jellyfin.Plugin.Lumen.dll" "$PLUGIN_DIR/"

PID_FILE="$LUMEN_DEV_HOME/jellyfin.pid"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  OLD_PID="$(cat "$PID_FILE")"
  kill "$OLD_PID"
  for _ in $(seq 1 30); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 0.5; done
  if kill -0 "$OLD_PID" 2>/dev/null; then kill -9 "$OLD_PID" 2>/dev/null || true; sleep 1; fi
fi

mkdir -p "$LUMEN_DEV_HOME/log"
"$LUMEN_DEV_HOME/jellyfin/jellyfin" \
  --datadir "$LUMEN_DEV_HOME/data" --configdir "$LUMEN_DEV_HOME/config" \
  --cachedir "$LUMEN_DEV_HOME/cache" --logdir "$LUMEN_DEV_HOME/log" \
  --ffmpeg "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" > "$LUMEN_DEV_HOME/log/console.log" 2>&1 &
echo $! > "$PID_FILE"

# Healthy only when the body is exactly "Healthy" (a Degraded 503/200 does not count).
healthy() { [[ "$(curl -s http://localhost:8096/health || true)" == "Healthy" ]]; }
for _ in $(seq 1 90); do healthy && break; sleep 1; done
if ! healthy; then
  echo "Server did not become healthy; last log lines from $LUMEN_DEV_HOME/log/console.log:"
  tail -n 30 "$LUMEN_DEV_HOME/log/console.log"
  exit 1
fi
echo "Jellyfin dev server: http://localhost:8096  (plugin Lumen $VERSION)"
