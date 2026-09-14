#!/usr/bin/env bash
#
# Generate the Play Store listing icon from the single source-of-truth mark.
#
#   docs/favicon.svg  ->  docs/play-store-icon-512.png
#
# The Play Console store icon is a MANUAL 512x512 upload under
# "Main store listing -> App icon". It is never extracted from the AAB, which is
# how it silently stayed on the pre-rebrand blue mark while the launcher icon in
# android/app/src/main/res/mipmap-* moved to the purple-rebrand one. Regenerating
# from favicon.svg keeps the store asset, the app icon and the site favicon on the
# same vector.
#
# Three deliberate differences from the favicon:
#   * square corners  - Play applies its own mask + shadow; baking rx="44" in
#                       renders as a double-rounded, inset icon
#   * fully opaque    - transparent corners come out ragged under that mask
#   * MARK_SCALE      - the pulse is scaled up about the centre so it still reads
#                       at the ~48px size Play uses in search results. The favicon
#                       is NOT changed; this is store-listing-only.
#
# Requires: Google Chrome (headless rasterizer) and python3 with Pillow.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/favicon.svg"
OUT="$ROOT/docs/play-store-icon-512.png"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SIZE=512
BG="#0A0A0F"
MARK_SCALE=1.20

[ -f "$SRC" ] || { echo "missing source: $SRC" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Full-bleed square, mark scaled about the canvas centre.
python3 - "$SRC" "$TMP/icon.html" "$SIZE" "$BG" "$MARK_SCALE" <<'PY'
import re, sys

src, out, size, bg, scale = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], float(sys.argv[5])
svg = open(src, encoding="utf-8").read()

svg = re.sub(r"<\?xml[^?]*\?>", "", svg)          # inline in HTML, no prolog
svg = svg.replace('rx="44"', 'rx="0"')            # Play applies its own mask

# The outer viewBox is the canvas; the nested <svg> is the pulse mark.
canvas = float(re.search(r'viewBox="0 0 (\d+(?:\.\d+)?)', svg).group(1))
inner = re.search(
    r'<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"', svg
)
if not inner:
    sys.exit("could not locate the nested mark <svg> in favicon.svg")

w, h = float(inner.group(3)) * scale, float(inner.group(4)) * scale
x, y = canvas / 2 - w / 2, canvas / 2 - h / 2
if x < 0 or y < 0:
    sys.exit(f"MARK_SCALE={scale} overflows the canvas (x={x:.2f}, y={y:.2f})")

svg = svg.replace(
    inner.group(0),
    f'<svg x="{x:.4g}" y="{y:.4g}" width="{w:.4g}" height="{h:.4g}"',
    1,
)

open(out, "w", encoding="utf-8").write(
    f"<style>html,body{{margin:0;padding:0;background:{bg}}}"
    f"svg{{display:block;width:{size}px;height:{size}px}}</style>\n{svg}"
)
print(f"mark {w:.4g}x{h:.4g} at ({x:.4g},{y:.4g}) in a {canvas:.0f} canvas "
      f"— {x / canvas * 100:.1f}% side margin")
PY

"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 \
  --window-size="$SIZE,$SIZE" \
  --default-background-color="FF${BG#\#}" \
  --screenshot="$TMP/icon.png" \
  "file://$TMP/icon.html" >/dev/null 2>&1

# Chrome writes 24-bit RGB; Play's uploader has historically wanted 32-bit PNG.
# Also asserts the corners really are opaque brand background, not transparent
# and not pre-rounded, and that the mark did not run off the edge.
python3 - "$TMP/icon.png" "$OUT" "$SIZE" <<'PY'
import sys
from PIL import Image

src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGBA")
if im.size != (size, size):
    sys.exit(f"expected {size}x{size}, got {im.size}")

expected = (10, 10, 15, 255)  # #0A0A0F, fully opaque
for xy in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)):
    px = im.getpixel(xy)
    if px != expected:
        sys.exit(f"corner {xy} is {px}, expected {expected} — rounded or transparent")

# No ink may touch the border, or the mask will shave the mark.
edges = (
    [(i, 0) for i in range(size)] + [(i, size - 1) for i in range(size)]
    + [(0, i) for i in range(size)] + [(size - 1, i) for i in range(size)]
)
for xy in edges:
    if im.getpixel(xy) != expected:
        sys.exit(f"mark touches the canvas edge at {xy} — reduce MARK_SCALE")

im.save(out)
print(f"wrote {out} ({size}x{size}, RGBA)")
PY
