#!/usr/bin/env bash
#
# Regenerate every raster favicon from the single source-of-truth mark.
#
#   docs/favicon.svg  ->  favicon-16/32/96.png, icon-192.png, apple-touch-icon.png, favicon.ico
#
# WHY THIS EXISTS. The same failure the Play store icon had, in a second place.
# `docs/favicon.svg` was rebranded to the handwritten waveform on a dark ground; the PNGs and
# the .ico beside it were never re-rendered, so every browser tab, bookmark and Chrome
# shortcut kept showing the pre-rebrand purple square with a simple pulse. Nothing in the
# build touches these files, so nothing could have caught it — a human noticed a phone
# screenshot. Sibling of scripts/gen-store-icon.sh, which fixed the store asset.
#
# TWO SHAPES, DELIBERATELY:
#
#   * Browser icons (16/32/96/192, .ico) keep favicon.svg's own rx="44" rounded corners.
#     Browsers draw the image as given; a square would read as a sticker among rounded
#     neighbours in Chrome's shortcut row.
#   * apple-touch-icon is FLATTENED to square and forced opaque. iOS applies its own mask and
#     shadow — baking in the radius renders a double-rounded, inset icon, and transparent
#     corners come out ragged under that mask. Same reasoning as the Play store icon.
#
# Requires: Google Chrome (headless rasterizer) and python3 with Pillow.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/favicon.svg"
OUT="$ROOT/docs"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BG="#0A0A0F"

[ -f "$SRC" ] || { echo "missing source: $SRC" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# $1 = pixel size, $2 = output path, $3 = "round" | "square"
render() {
  local size="$1" out="$2" corners="$3"

  python3 - "$SRC" "$TMP/icon-$size.html" "$size" "$BG" "$corners" <<'PY'
import re, sys
src, out, size, bg, corners = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
svg = open(src, encoding="utf-8").read()
svg = re.sub(r"<\?xml[^?]*\?>", "", svg)          # inline in HTML, no prolog
if corners == "square":
    svg = svg.replace('rx="44"', 'rx="0"')        # iOS applies its own mask
open(out, "w", encoding="utf-8").write(
    f"<style>html,body{{margin:0;padding:0;background:transparent}}"
    f"svg{{display:block;width:{size}px;height:{size}px}}</style>\n{svg}"
)
PY

  # --default-background-color=00000000 keeps the corners transparent for the rounded
  # variants; the square one is flattened onto the brand colour in Python below.
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size="$size,$size" \
    --default-background-color=00000000 \
    --screenshot="$TMP/raw-$size.png" \
    "file://$TMP/icon-$size.html" >/dev/null 2>&1

  python3 - "$TMP/raw-$size.png" "$out" "$size" "$corners" "$BG" <<'PY'
import sys
from PIL import Image
src, out, size, corners, bg = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
im = Image.open(src).convert("RGBA")
if im.size != (size, size):
    sys.exit(f"expected {size}x{size}, got {im.size}")

if corners == "square":
    # Flatten onto the brand background: no alpha at all, or iOS's mask frays the edge.
    flat = Image.new("RGB", (size, size), bg)
    flat.paste(im, mask=im.split()[3])
    px = flat.getpixel((0, 0))
    if px != tuple(int(bg[i:i+2], 16) for i in (1, 3, 5)):
        sys.exit(f"corner is {px}, expected opaque {bg}")
    flat.save(out)
else:
    # A rounded icon MUST have (near-)transparent corners — otherwise the dark square shows as
    # a black box on any light surface, which is exactly what a stale opaque render looks like.
    #
    # Not `== 0`: at 16px the corner radius is about 3.5 device pixels, so pixel (0,0) picks up
    # a little anti-aliasing and comes back with alpha 1. The check is "is this corner painted
    # in", not "is it mathematically empty" — a failed render gives 255, not 1.
    alpha = im.getpixel((0, 0))[3]
    if alpha > 16:
        sys.exit(f"corner alpha is {alpha} — the rounded corners did not render")
    im.save(out)
print(f"  {out.split('/')[-1]:<24} {size}x{size} {corners}")
PY
}

echo "regenerating favicons from docs/favicon.svg"
render  16 "$OUT/favicon-16.png"       round
render  32 "$OUT/favicon-32.png"       round
render  96 "$OUT/favicon-96.png"       round
render 192 "$OUT/icon-192.png"         round
render 180 "$OUT/apple-touch-icon.png" square

# The .ico carries 16/32/48 in one file; Windows and some bookmark UIs still ask for it.
python3 - "$TMP" "$OUT/favicon.ico" <<'PY'
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
base = Image.open(f"{tmp}/raw-192.png").convert("RGBA")
base.save(out, sizes=[(16, 16), (32, 32), (48, 48)])
print(f"  {out.split('/')[-1]:<24} 16/32/48 multi-size")
PY

echo "done — all five PNGs and the .ico now come from the same vector as the app icon"
