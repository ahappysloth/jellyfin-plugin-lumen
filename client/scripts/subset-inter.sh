#!/bin/sh
# Makes Lumen's copies of Inter (src/assets/fonts/inter-{400,500,600}.woff2) from an official Inter release. Run it
# only to update Inter or change what the files cover; the build uses the committed files.
#
#   pip install fonttools brotli   # fonttools 4.60.1 made the committed files
#   curl -LO https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip && unzip Inter-4.1.zip -d inter
#   sh scripts/subset-inter.sh inter
#
# Inter 4.1 (Inter-4.1.zip, sha256 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e), SIL Open Font
# License 1.1 (src/assets/fonts/LICENSE-Inter.txt). From the release's web fonts, which Inter ships without hinting.
#
# What's kept, to stay small (about 19 KB a weight):
# - Basic Latin, Latin-1 Supplement and Latin Extended-A, Romanian's comma letters, and the punctuation, arrows and
#   symbols Lumen's own text uses. Anything else (Greek, Cyrillic, Vietnamese, CJK in a media title) comes from the
#   system font, as before; base.css's unicode-range says the same, so keep the two in step.
# - Kerning, marks and composition (ccmp, locl, mark, mkmk, kern) and tabular figures (tnum: times and counters use
#   font-variant-numeric: tabular-nums). Not Inter's contextual alternates, fractions or stylistic sets.
# - The name table's copyright, licence and licence URL.
set -eu
src=${1:?usage: subset-inter.sh <unzipped Inter release>}
out=$(dirname "$0")/../src/assets/fonts
unicodes='U+0000-017F,U+0218-021B,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD'
for pair in Regular:400 Medium:500 SemiBold:600; do
  pyftsubset "$src/web/Inter-${pair%%:*}.woff2" \
    --unicodes="$unicodes" \
    --layout-features=ccmp,locl,mark,mkmk,kern,tnum \
    --name-IDs=0,1,2,3,4,5,6,13,14 \
    --flavor=woff2 \
    --output-file="$out/inter-${pair##*:}.woff2"
done
cp "$src/LICENSE.txt" "$out/LICENSE-Inter.txt"
