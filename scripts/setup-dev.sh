#!/usr/bin/env bash
# One-time local setup without sudo or Docker: .NET 10 SDK, portable Jellyfin, portable jellyfin-ffmpeg.
# Supports Linux (x64/arm64, including WSL2) and macOS (Apple silicon/Intel). Everything goes under
# ~/.dotnet and $LUMEN_DEV_HOME (default ~/.local/share/lumen-dev).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"

JELLYFIN_VERSION="${JELLYFIN_VERSION:-12.4}"
FFMPEG_SERIES="${FFMPEG_SERIES:-latest-8.x}"
REPO="https://repo.jellyfin.org/files"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)               OS=linux; ARCH=amd64; FFMPEG_ARCH=amd64;  FFMPEG_SUFFIX=linux64 ;;
  Linux-aarch64|Linux-arm64)  OS=linux; ARCH=arm64; FFMPEG_ARCH=arm64;  FFMPEG_SUFFIX=linuxarm64 ;;
  Darwin-arm64)               OS=macos; ARCH=arm64; FFMPEG_ARCH=arm64;  FFMPEG_SUFFIX=macarm64 ;;
  Darwin-x86_64)              OS=macos; ARCH=amd64; FFMPEG_ARCH=x86_64; FFMPEG_SUFFIX=mac64 ;;
  *) echo "setup-dev: unsupported platform $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
# Jellyfin ships .tar.gz for Linux and .tar.xz for macOS.
if [[ "$OS" == linux ]]; then SERVER_EXT=tar.gz; else SERVER_EXT=tar.xz; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if ! command -v dotnet >/dev/null || ! dotnet --list-sdks | grep -q '^10\.'; then
  echo "Installing .NET 10 SDK into ~/.dotnet"
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$TMP/dotnet-install.sh"
  bash "$TMP/dotnet-install.sh" --channel 10.0 --install-dir "$HOME/.dotnet"
fi

mkdir -p "$LUMEN_DEV_HOME"/{data,config,cache,log,ffmpeg}

if [[ ! -x "$LUMEN_DEV_HOME/jellyfin/jellyfin" ]]; then
  echo "Downloading Jellyfin $JELLYFIN_VERSION ($OS/$ARCH, portable)"
  curl -fSL "$REPO/server/$OS/stable/v${JELLYFIN_VERSION}/$ARCH/jellyfin_${JELLYFIN_VERSION}-$ARCH.$SERVER_EXT" \
    -o "$TMP/jellyfin.$SERVER_EXT"
  tar -xf "$TMP/jellyfin.$SERVER_EXT" -C "$LUMEN_DEV_HOME"
fi

if [[ ! -x "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" ]]; then
  FFMPEG_DIR="$REPO/ffmpeg/$OS/$FFMPEG_SERIES/$FFMPEG_ARCH"
  # Jellyfin replaces old builds in place, so find the current file name instead of pinning it.
  if [[ -z "${FFMPEG_TARBALL:-}" ]]; then
    FFMPEG_TARBALL="$(curl -fsSL "$FFMPEG_DIR/" \
      | grep -oE "jellyfin-ffmpeg_[^\"/]+_portable_${FFMPEG_SUFFIX}-gpl\.tar\.xz" | sort -u | tail -n 1)"
  fi
  if [[ -z "$FFMPEG_TARBALL" ]]; then
    echo "setup-dev: no portable jellyfin-ffmpeg found at $FFMPEG_DIR/ (set FFMPEG_TARBALL to override)" >&2
    exit 1
  fi
  echo "Downloading $FFMPEG_TARBALL"
  curl -fSL "$FFMPEG_DIR/$FFMPEG_TARBALL" -o "$TMP/jffmpeg.tar.xz"
  tar -xf "$TMP/jffmpeg.tar.xz" -C "$LUMEN_DEV_HOME/ffmpeg"
fi

echo "dotnet: $(dotnet --version)"
echo "jellyfin: $LUMEN_DEV_HOME/jellyfin/jellyfin"
echo "ffmpeg: $("$LUMEN_DEV_HOME/ffmpeg/ffmpeg" -hide_banner -version | head -1)"
