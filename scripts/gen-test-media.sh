#!/usr/bin/env bash
# Deterministic fixture media for dev and E2E:
# - VP9/Opus WebM (Chromium can direct-play it; Playwright's Chromium has no H.264)
# - NFO metadata (no internet lookups needed), poster/backdrop/logo images, and a local trailer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"
if [[ -z "${FFMPEG:-}" ]]; then
  if [[ -x "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" ]]; then FFMPEG="$LUMEN_DEV_HOME/ffmpeg/ffmpeg"; else FFMPEG="$(command -v ffmpeg)"; fi
fi
OUT="${1-$ROOT/e2e/fixtures/media}"

# OUT is wiped and regenerated, so only ever delete something that is recognisably a previous fixture tree.
if [[ -z "$OUT" || "$(realpath -m "$OUT")" == "/" || "$(realpath -m "$OUT")" == "$(realpath -m "$HOME")" ]]; then
  echo "gen-test-media: refusing to use '$OUT' as the output directory" >&2
  exit 1
fi
if [[ -e "$OUT" && ! -d "$OUT" ]]; then
  echo "gen-test-media: '$OUT' exists and is not a directory" >&2
  exit 1
fi
if [[ -d "$OUT" && -n "$(ls -A "$OUT")" && ! -d "$OUT/movies" && ! -d "$OUT/tv" ]]; then
  echo "gen-test-media: refusing to delete '$OUT': it is not empty and has no movies/ or tv/ subdirectory" >&2
  exit 1
fi
rm -rf "$OUT"
mkdir -p "$OUT/movies" "$OUT/tv"

video() { # path seconds hue
  "$FFMPEG" -loglevel error -y -f lavfi -i "testsrc2=size=640x360:rate=24,hue=h=$3" -f lavfi -i "sine=frequency=440" \
    -t "$2" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 300k -c:a libopus -b:a 48k -shortest "$1"
}
image() { # path size color
  "$FFMPEG" -loglevel error -y -f lavfi -i "color=c=$3:s=$2" -frames:v 1 "$1"
}
movie() { # title year genres(comma) rating hue color with_logo(1|0)
  local dir="$OUT/movies/$1 ($2)"
  mkdir -p "$dir"
  video "$dir/$1 ($2).webm" 20 "$5"
  video "$dir/$1 ($2)-trailer.webm" 8 "$5"
  image "$dir/poster.jpg" 400x600 "$6"
  image "$dir/backdrop.jpg" 1280x720 "$6"
  if [[ "$7" == 1 ]]; then image "$dir/logo.png" 800x200 white; fi
  {
    echo '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    echo "<movie><title>$1</title><year>$2</year><rating>$4</rating><mpaa>PG-13</mpaa><plot>$1 is a Lumen test movie.</plot>"
    IFS=',' read -ra genres <<< "$3"
    for g in "${genres[@]}"; do echo "<genre>$g</genre>"; done
    echo '</movie>'
  } > "$dir/movie.nfo"
}

movie "Lumen Alpha" 2001 "Action,Science Fiction" 8.1 0 0x33557a 1
movie "Lumen Beta" 2002 "Drama" 7.2 90 0x7a3355 0
movie "Lumen Gamma" 2003 "Action,Comedy" 6.5 180 0x557a33 1

show="$OUT/tv/Lumen Show (2010)"
mkdir -p "$show"
image "$show/poster.jpg" 400x600 0x224466
image "$show/backdrop.jpg" 1280x720 0x224466
image "$show/logo.png" 800x200 white
cat > "$show/tvshow.nfo" <<'NFO'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow><title>Lumen Show</title><year>2010</year><rating>8.5</rating><genre>Science Fiction</genre><plot>A Lumen test series.</plot></tvshow>
NFO
for s in 1 2; do
  mkdir -p "$show/Season 0$s"
  for e in 1 2 3; do video "$show/Season 0$s/Lumen Show S0${s}E0${e}.webm" 15 $((s * 60 + e * 20)); done
done
echo "Fixture media written to $OUT"
