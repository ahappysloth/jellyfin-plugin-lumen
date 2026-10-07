#!/usr/bin/env bash
# One-time local setup without sudo or Docker: .NET 10 SDK, portable Jellyfin, portable jellyfin-ffmpeg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"

JELLYFIN_VERSION="${JELLYFIN_VERSION:-12.2}"
FFMPEG_TARBALL="${FFMPEG_TARBALL:-jellyfin-ffmpeg_8.1.3-1_portable_linux64-gpl.tar.xz}"

if ! command -v dotnet >/dev/null || ! dotnet --list-sdks | grep -q '^10\.'; then
  echo "Installing .NET 10 SDK into ~/.dotnet"
  curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 10.0 --install-dir "$HOME/.dotnet"
fi

mkdir -p "$LUMEN_DEV_HOME"/{data,config,cache,log,ffmpeg}

if [[ ! -x "$LUMEN_DEV_HOME/jellyfin/jellyfin" ]]; then
  echo "Downloading Jellyfin $JELLYFIN_VERSION (portable)"
  curl -fSL "https://repo.jellyfin.org/files/server/linux/stable/v${JELLYFIN_VERSION}/amd64/jellyfin_${JELLYFIN_VERSION}-amd64.tar.gz" \
    -o /tmp/jellyfin.tar.gz
  tar -xzf /tmp/jellyfin.tar.gz -C "$LUMEN_DEV_HOME"
fi

if [[ ! -x "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" ]]; then
  echo "Downloading jellyfin-ffmpeg (portable)"
  curl -fSL "https://repo.jellyfin.org/files/ffmpeg/linux/latest-8.x/amd64/${FFMPEG_TARBALL}" -o /tmp/jffmpeg.tar.xz
  tar -xJf /tmp/jffmpeg.tar.xz -C "$LUMEN_DEV_HOME/ffmpeg"
fi

echo "dotnet: $(dotnet --version)"
echo "jellyfin: $LUMEN_DEV_HOME/jellyfin/jellyfin"
echo "ffmpeg: $("$LUMEN_DEV_HOME/ffmpeg/ffmpeg" -hide_banner -version | head -1)"
