#!/usr/bin/env bash
# Docker-only dev loop: builds and tests in containers, then runs Jellyfin with Lumen installed.
# Needs only Docker (Docker Desktop on macOS, or Docker Engine on Linux); no local Node, .NET or ffmpeg.
#
#   scripts/docker-dev.sh [up]   build client + plugin, (re)start Jellyfin on :8096 (also reachable on your LAN)
#   scripts/docker-dev.sh test   run client and server unit tests in containers
#   scripts/docker-dev.sh e2e    `up`, then run the Playwright suite against it (sets up admin/lumen-admin)
#   scripts/docker-dev.sh logs   follow the Jellyfin container's logs
#   scripts/docker-dev.sh down   stop and remove the container (data in artifacts/docker is kept)
#
# Environment: JELLYFIN_IMAGE (default jellyfin/jellyfin:12.4), LUMEN_PUBLISHED_URL (default http://<LAN IP>:8096).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"

JELLYFIN_IMAGE="${JELLYFIN_IMAGE:-jellyfin/jellyfin:12.4}"
NODE_IMAGE="node:24"
DOTNET_IMAGE="mcr.microsoft.com/dotnet/sdk:10.0"
CONTAINER="lumen-jellyfin"
DATA="$ROOT/artifacts/docker"
VERSION="$(lumen_version)"

# On Linux, run as the current user so files written to the repo aren't root-owned (Docker Desktop maps this itself).
USER_ARGS=()
if [[ "$(uname -s)" == "Linux" ]]; then USER_ARGS=(--user "$(id -u):$(id -g)"); fi
run() { docker run --rm ${USER_ARGS[@]+"${USER_ARGS[@]}"} -e HOME=/tmp "$@"; }

# Sources are copied into the container before building: bind-mounted node_modules is very slow on macOS.
build_client() {
  echo "==> Building client ($NODE_IMAGE)"
  mkdir -p "$ROOT/client/dist"
  run -v "$ROOT/client:/src:ro" -v "$ROOT/client/dist:/out" "$NODE_IMAGE" bash -ec '
    mkdir /tmp/w && cd /src && tar --exclude=node_modules --exclude=dist -cf - . | tar -xf - -C /tmp/w
    cd /tmp/w && npm ci --no-audit --no-fund --loglevel=error && npm run build
    rm -rf /out/* && cp -r dist/. /out/'
}

build_plugin() {
  echo "==> Building plugin ($DOTNET_IMAGE)"
  mkdir -p "$ROOT/artifacts/plugin"
  run -v "$ROOT:/src:ro" -v "$ROOT/artifacts/plugin:/out" "$DOTNET_IMAGE" bash -ec '
    mkdir /tmp/w && cd /src && tar --exclude=./artifacts --exclude=node_modules --exclude=bin --exclude=obj -cf - . | tar -xf - -C /tmp/w
    cd /tmp/w && dotnet publish src/Jellyfin.Plugin.Lumen -c Release -o /out --nologo -v quiet -p:SkipClientBuild=true'
}

unit_tests() {
  echo "==> Client tests ($NODE_IMAGE)"
  run -v "$ROOT/client:/src:ro" "$NODE_IMAGE" bash -ec '
    mkdir /tmp/w && cd /src && tar --exclude=node_modules -cf - . | tar -xf - -C /tmp/w
    cd /tmp/w && npm ci --no-audit --no-fund --loglevel=error && npm run lint && npm run typecheck && npm test'
  build_client
  echo "==> Server tests ($DOTNET_IMAGE)"
  run -v "$ROOT:/src:ro" "$DOTNET_IMAGE" bash -ec '
    mkdir /tmp/w && cd /src && tar --exclude=./artifacts --exclude=node_modules --exclude=bin --exclude=obj -cf - . | tar -xf - -C /tmp/w
    cd /tmp/w && dotnet test --nologo -p:SkipClientBuild=true'
}

gen_media() {
  # Made again when it predates the IMDb stand-ins' 1080p ones.
  [[ -f "$DATA/media/imdb/trailer-vp9-1080p.mp4" ]] && return
  echo "==> Generating fixture media (jellyfin-ffmpeg from $JELLYFIN_IMAGE)"
  mkdir -p "$DATA"
  run --entrypoint bash -v "$ROOT/scripts:/scripts:ro" -v "$DATA:/data" "$JELLYFIN_IMAGE" -c \
    'FFMPEG=/usr/lib/jellyfin-ffmpeg/ffmpeg LUMEN_DEV_HOME=/tmp bash /scripts/gen-test-media.sh /data/media'
}

wait_healthy() {
  for _ in $(seq 1 90); do
    [[ "$(curl -s http://localhost:8096/health || true)" == "Healthy" ]] && return 0
    sleep 1
  done
  echo "Jellyfin did not become healthy; last log lines:" >&2
  docker logs --tail 30 "$CONTAINER" >&2
  return 1
}

# (Re)starts the Jellyfin container. TMDB_BASE and TRAKT_BASE (end-to-end tests only) point the image proxy and the Top
# 10 rows' Trakt client at the stub Seerr, and PUSH_BASE lets push subscriptions name its stand-in push service; with
# it the push job's pass is an hour apart and a failed send is tried again after 2 s (docs/development.md).
# YOUTUBE_BASE points the browser at the stub's stand-in for YouTube's player. IMDB_API and IMDB_VIDEO point IMDb trailer
# lookups at the stub's stand-in for IMDb's API, and tell the server where the browser finds its stand-in videos.
start_server() {
  local ip url
  ip="$(lan_ip)"
  url="${LUMEN_PUBLISHED_URL:-${ip:+http://$ip:8096}}"
  echo "==> Starting $JELLYFIN_IMAGE"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # Port 7359/udp lets Jellyfin apps on the LAN auto-discover the server; the published URL is what it advertises.
  # host.docker.internal lets it reach services on this machine (e.g. a local Seerr, or the tests' stub).
  docker run -d --name "$CONTAINER" --hostname lumen-dev --restart unless-stopped \
    ${USER_ARGS[@]+"${USER_ARGS[@]}"} --add-host=host.docker.internal:host-gateway \
    -p 8096:8096 -p 7359:7359/udp ${url:+-e JELLYFIN_PublishedServerUrl="$url"} \
    ${TMDB_BASE:+-e LUMEN_TMDB_IMAGE_BASE="$TMDB_BASE"} \
    ${TRAKT_BASE:+-e LUMEN_TRAKT_API_BASE="$TRAKT_BASE"} \
    ${PUSH_BASE:+-e LUMEN_PUSH_TEST_ENDPOINT="$PUSH_BASE" -e LUMEN_PUSH_TEST_PASS_SECONDS=3600 -e LUMEN_PUSH_TEST_RETRY_SECONDS=2} \
    ${YOUTUBE_BASE:+-e LUMEN_YOUTUBE_EMBED_BASE="$YOUTUBE_BASE"} \
    ${IMDB_API:+-e LUMEN_IMDB_API_BASE="$IMDB_API"} ${IMDB_VIDEO:+-e LUMEN_IMDB_VIDEO_BASE="$IMDB_VIDEO"} \
    -v "$DATA/config:/config" -v "$DATA/cache:/cache" -v "$DATA/media:/media:ro" \
    "$JELLYFIN_IMAGE" >/dev/null
  wait_healthy
}

up() {
  build_client
  build_plugin
  gen_media
  rm -rf "$DATA/config/plugins"/Lumen_*
  mkdir -p "$DATA/config/plugins/Lumen_$VERSION" "$DATA/cache"
  cp "$ROOT/artifacts/plugin/Jellyfin.Plugin.Lumen.dll" "$DATA/config/plugins/Lumen_$VERSION/"

  start_server
  local ip
  ip="$(lan_ip)"
  echo "Jellyfin with Lumen $VERSION: http://localhost:8096"
  if [[ -n "$ip" ]]; then echo "On your network:            http://$ip:8096"; fi
  echo "Media library folders (inside the container): /media/movies, /media/tv"
}

e2e() {
  # The browser runs in the Playwright container below, beside the stub: the stub player (and IMDb's stand-in videos)
  # are at its localhost.
  TMDB_BASE=http://host.docker.internal:5055/t/p TRAKT_BASE=http://host.docker.internal:5055/trakt \
    PUSH_BASE=http://host.docker.internal:5055/push/ YOUTUBE_BASE=http://localhost:5055 \
    IMDB_API=http://host.docker.internal:5055/imdb/graphql IMDB_VIDEO=http://localhost:5055 up
  local pw
  pw="$(node -p "require('$ROOT/e2e/package-lock.json').packages['node_modules/@playwright/test'].version" 2>/dev/null \
    || sed -n '/"node_modules\/@playwright\/test"/,/}/s/.*"version": "\(.*\)".*/\1/p' "$ROOT/e2e/package-lock.json")"
  echo "==> Running E2E (Playwright $pw)"
  mkdir -p "$ROOT/e2e/test-results" "$ROOT/e2e/playwright-report"
  # The stub Seerr runs in this container (Playwright webServer); publish it so Jellyfin can reach it.
  local rc=0
  run --ipc=host --add-host=host.docker.internal:host-gateway -p 5055:5055 \
    -v "$ROOT/e2e:/src:ro" -v "$ROOT/client/src/compat:/client-compat:ro" -v "$ROOT/e2e/test-results:/out/test-results" -v "$ROOT/e2e/playwright-report:/out/playwright-report" \
    -v "$DATA/media/imdb:/imdb-media:ro" -e LUMEN_STUB_IMDB_MEDIA=/imdb-media \
    -e LUMEN_E2E_BASE_URL=http://host.docker.internal:8096 -e LUMEN_E2E_MEDIA_PATH=/media \
    -e LUMEN_E2E_SEERR_URL=http://host.docker.internal:5055 \
    "mcr.microsoft.com/playwright:v$pw-noble" bash -c '
      mkdir /tmp/w && cd /src && tar --exclude=node_modules --exclude=test-results --exclude=playwright-report -cf - . | tar -xf - -C /tmp/w
      # Specs import the jellyfin-web registry from client/src/compat (../../client from specs/).
      mkdir -p /tmp/client/src && cp -r /client-compat /tmp/client/src/compat
      cd /tmp/w && npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"; rc=$?
      cp -r test-results/. /out/test-results/ 2>/dev/null; cp -r playwright-report/. /out/playwright-report/ 2>/dev/null
      exit $rc' bash "$@" || rc=$?
  # Back to real TMDB artwork (and Trakt, YouTube, IMDb, and real push services only) for normal use.
  TMDB_BASE='' TRAKT_BASE='' PUSH_BASE='' YOUTUBE_BASE='' IMDB_API='' IMDB_VIDEO='' start_server
  return $rc
}

cmd="${1:-up}"
[[ $# -gt 0 ]] && shift
case "$cmd" in
  up) up ;;
  test) unit_tests ;;
  e2e) e2e "$@" ;;
  logs) docker logs -f "$CONTAINER" ;;
  down) docker rm -f "$CONTAINER" ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
