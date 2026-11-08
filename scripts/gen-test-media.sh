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

# Absolute, symlink-free path that need not exist yet (portable stand-in for GNU `realpath -m`).
abspath() {
  local p="$1" tail=""
  [[ "$p" == /* ]] || p="$PWD/$p"
  while [[ ! -d "$p" ]]; do tail="/$(basename "$p")$tail"; p="$(dirname "$p")"; done
  p="$(cd "$p" && pwd -P)"
  [[ "$p" == / ]] && p=""
  p="$p$tail"
  echo "${p:-/}"
}

# OUT is wiped and regenerated, so only ever delete something that is recognisably a previous fixture tree.
if [[ -z "$OUT" || "$(abspath "$OUT")" == "/" || "$(abspath "$OUT")" == "$(abspath "$HOME")" ]]; then
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

# A bold font for titles on artwork, if one is available (DejaVu on Linux/the Jellyfin image, Arial on macOS).
FONT=""
for f in /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf /usr/share/fonts/TTF/DejaVuSans-Bold.ttf \
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf"; do
  if [[ -f "$f" ]]; then FONT="$f"; break; fi
done
# Read the list once: `ffmpeg | grep -q` fails under pipefail when grep exits early (SIGPIPE).
FILTERS="$("$FFMPEG" -hide_banner -filters 2>/dev/null || true)"
has_filter() { [[ "$FILTERS" == *" $1 "* ]]; }
FANCY=0
if [[ -n "$FONT" ]] && has_filter drawtext && has_filter gradients; then FANCY=1; fi

# Artwork that reads like real key art: a diagonal gradient, optionally with a title. Falls back to a flat colour.
art() { # path WxH color title(optional) fontsize
  local w="${2%x*}" h="${2#*x}"
  if [[ "$FANCY" == 0 ]]; then image "$1" "$2" "$3"; return; fi
  local vf="gradients=s=$2:c0=$3:c1=0x0b0d12:x0=0:y0=0:x1=$w:y1=$h:nb_colors=2,vignette=PI/5"
  if [[ -n "${4:-}" ]]; then
    vf="$vf,drawtext=fontfile='$FONT':text='$4':fontcolor=white@0.9:fontsize=$5:x=(w-tw)/2:y=h*0.72-th/2"
  fi
  "$FFMPEG" -loglevel error -y -f lavfi -i "$vf" -frames:v 1 "$1"
}

# A transparent title logo; a white block when no font is available.
logo() { # path title
  if [[ "$FANCY" == 0 ]]; then image "$1" 800x200 white; return; fi
  # Real logos are trimmed to their artwork: size the canvas to the text (DejaVu/Arial Bold caps ≈ 0.74 em wide).
  local size=96 width=$((${#2} * 96 * 74 / 100 + 24))
  "$FFMPEG" -loglevel error -y -f lavfi -i "color=c=black@0:s=${width}x130,format=rgba" -vf \
    "drawtext=fontfile='$FONT':text='$(echo "$2" | tr '[:lower:]' '[:upper:]')':fontcolor=white:fontsize=$size:x=(w-tw)/2:y=(h-th)/2:shadowcolor=black@0.5:shadowx=3:shadowy=3" \
    -frames:v 1 "$1"
}

cast() { # "Name:Role" ...
  for pair in "$@"; do echo "<actor><name>${pair%%:*}</name><role>${pair#*:}</role><type>Actor</type></actor>"; done
}
movie() { # title year genres(comma) rating hue color with_logo(1|0)
  local dir="$OUT/movies/$1 ($2)"
  mkdir -p "$dir"
  video "$dir/$1 ($2).webm" 20 "$5"
  video "$dir/$1 ($2)-trailer.webm" 8 "$5"
  art "$dir/poster.jpg" 400x600 "$6" "$1" 44
  art "$dir/backdrop.jpg" 1280x720 "$6"
  if [[ "$7" == 1 ]]; then logo "$dir/logo.png" "$1"; fi
  {
    echo '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    echo "<movie><title>$1</title><year>$2</year><rating>$4</rating><mpaa>PG-13</mpaa><plot>$1 is a Lumen test movie.</plot>"
    IFS=',' read -ra genres <<< "$3"
    for g in "${genres[@]}"; do echo "<genre>$g</genre>"; done
    cast "Ada Vance:Captain Rhee" "Marco Ilic:The Navigator" "June Okafor:Dr. Sol" "Theo Brandt:Kestrel"
    echo '</movie>'
  } > "$dir/movie.nfo"
}

movie "Lumen Alpha" 2001 "Action,Science Fiction" 8.1 0 0x33557a 1
movie "Lumen Beta" 2002 "Drama" 7.2 90 0x7a3355 0
movie "Lumen Gamma" 2003 "Action,Comedy" 6.5 180 0x557a33 1
movie "Lumen Delta" 2019 "Horror,Thriller" 6.9 270 0x5a2a2a 1
movie "Lumen Epsilon" 2021 "Romance,Drama" 7.4 320 0x7a5533 1
movie "Lumen Zeta" 2024 "Adventure,Fantasy" 7.8 40 0x2f6b5e 1
movie "Lumen Eta" 2015 "Animation,Comedy" 8.0 120 0x6b5a2f 0
movie "Lumen Theta" 2023 "Thriller,Crime" 7.1 220 0x3d3d6b 1

show="$OUT/tv/Lumen Show (2010)"
mkdir -p "$show"
art "$show/poster.jpg" 400x600 0x224466 "Lumen Show" 44
art "$show/backdrop.jpg" 1280x720 0x224466
logo "$show/logo.png" "Lumen Show"
{
  echo '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  echo '<tvshow><title>Lumen Show</title><year>2010</year><rating>8.5</rating><genre>Science Fiction</genre><plot>A Lumen test series.</plot>'
  cast "Ada Vance:Commander Hale" "Rui Tanaka:Ensign Mori"
  echo '</tvshow>'
} > "$show/tvshow.nfo"
for s in 1 2; do
  mkdir -p "$show/Season 0$s"
  for e in 1 2 3; do video "$show/Season 0$s/Lumen Show S0${s}E0${e}.webm" 15 $((s * 60 + e * 20)); done
done
echo "Fixture media written to $OUT"
