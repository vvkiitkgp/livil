#!/usr/bin/env bash
#
# Render the profile-link preview card.
#
#   docs/favicon.svg (the mark)  ->  docs/og-follow.png  (1200 x 630)
#
# This is the image WhatsApp / iMessage / Instagram DMs show when someone pastes a
# livil-music.com/@<username> link: the Livil mark and "Follow me on Livil". It is the SAME
# for everyone on purpose — the card's title text (rendered by web/api/profile.ts) is what
# names the person. Styled to sit beside docs/og.png, the site's own card.
#
# The mark is lifted from docs/favicon.svg at render time, so a rebrand of the mark
# reaches this card by re-running the script rather than by redrawing it.
#
# Requires: Google Chrome (headless rasterizer) and python3 with Pillow. Fonts come from
# Google Fonts, so it needs a network connection.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/favicon.svg"
OUT="$ROOT/docs/og-follow.png"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W=1200
H=630

[ -f "$SRC" ] || { echo "missing source: $SRC" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 - "$SRC" "$TMP/card.html" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
svg = open(src, encoding="utf-8").read()
# The mark is the nested <svg> inside the rounded-square favicon; drop the square.
m = re.search(r'<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" (viewBox="[^"]*")[^>]*>(.*?)</svg>', svg, re.S)
if not m:
    sys.exit("could not find the mark inside docs/favicon.svg")
mark = f'<svg class="mark" {m.group(1)} fill="#ffffff" xmlns="http://www.w3.org/2000/svg">{m.group(2)}</svg>'

html = """<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;800;900&family=Instrument+Serif:ital@1&display=block" rel="stylesheet">
<style>
html,body{margin:0;padding:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:#0A0A0F;
  font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#fff}
.glow1{position:absolute;right:-180px;top:-260px;width:820px;height:820px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(109,40,217,.55),rgba(76,29,149,.18) 60%,transparent)}
.glow2{position:absolute;left:-260px;bottom:-360px;width:760px;height:760px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(76,29,149,.45),transparent)}
.mark{position:absolute;left:100px;top:88px;width:232px;height:auto;
  filter:drop-shadow(0 0 10px rgba(255,255,255,.55)) drop-shadow(0 0 28px rgba(168,85,247,.55))}
.wave{position:absolute;left:0;top:300px;width:1200px;height:120px}
h1{position:absolute;left:96px;top:262px;margin:0;font-weight:900;font-size:92px;
  line-height:1.02;letter-spacing:-2.5px}
h1 em{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-style:italic;
  letter-spacing:-1px;font-size:100px;
  background:linear-gradient(90deg,#A78BFA,#C9B6FF);-webkit-background-clip:text;
  background-clip:text;color:transparent;padding-right:6px}
.tag{position:absolute;left:100px;bottom:82px;font-size:19px;font-weight:600;
  letter-spacing:6px;color:#A78BFA}
.url{position:absolute;right:92px;bottom:80px;font-size:21px;font-weight:600;color:#9a9aa8}
.dot{position:absolute;width:4px;height:4px;border-radius:50%;background:#3b3b52}
</style></head>
<body>
<div class="glow1"></div><div class="glow2"></div>
<div class="dot" style="left:520px;top:92px"></div>
<div class="dot" style="left:900px;top:200px"></div>
<div class="dot" style="left:1120px;top:300px"></div>
<div class="dot" style="left:760px;top:420px"></div>
<div class="dot" style="left:300px;top:470px"></div>
<svg class="wave" viewBox="0 0 1200 120" preserveAspectRatio="none">
  <path d="M0,86 C140,92 230,60 340,62 C470,64 520,100 640,96 C760,92 800,54 900,56
           C1000,58 1040,96 1200,88" fill="none" stroke="#6D5BAE" stroke-opacity=".75" stroke-width="2.5"/>
</svg>
MARK
<h1>Follow me<br>on <em>Livil</em>.</h1>
<div class="tag">LIVE · VIBE · LINK</div>
<div class="url">livil-music.com</div>
</body></html>"""
open(out, "w", encoding="utf-8").write(html.replace("MARK", mark))
PY

# --virtual-time-budget lets the web fonts arrive before the screenshot is taken;
# without it the headline renders in the fallback face.
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 \
  --window-size="$W,$H" \
  --virtual-time-budget=8000 \
  --screenshot="$TMP/raw.png" \
  "file://$TMP/card.html" >/dev/null 2>&1

python3 - "$TMP/raw.png" "$OUT" "$W" "$H" <<'PY'
import sys
from PIL import Image
src, out, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert("RGB")
if im.size != (w, h):
    sys.exit(f"expected {w}x{h}, got {im.size}")
# Opaque RGB PNG: chat apps composite transparent pixels onto white or grey.
im.save(out, optimize=True)
print(f"wrote {out}")
PY
