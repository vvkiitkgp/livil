# LiViL — Motion Techniques

> **A LiViL motion post is the real component, brought to life — never a generated video.**
> Every Reel should look like a frame from the product itself, animated with the same care as the code.

**Version 1.0** · Craft layer for [`POST_FRAMEWORKS.md`](./POST_FRAMEWORKS.md) + [`INSTAGRAM_STYLE.md`](./INSTAGRAM_STYLE.md) §11 (Motion)
Built on [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md), [`BRAND_GUIDE.md`](./BRAND_GUIDE.md), [`CREATIVE_DIRECTOR.md`](./CREATIVE_DIRECTOR.md)

`INSTAGRAM_STYLE.md` §11 sets the motion *philosophy* (calm, deliberate, one idea per shot).
This doc is the **production method** for a specific format — the **Component Showcase** —
plus the reusable phase structure and 3D-depth technique that make it work.

---

## Core principle — code-driven, never generative

LiViL's component showcases are built by **recreating the real UI** in HTML/CSS/Canvas/SVG
and choreographing its actual states — never by feeding a screenshot to a generative video
model (Higgsfield, Runway, Sora, etc.) and hoping it holds together.

**Why generative video is ruled out for this format:** these models re-hallucinate motion
from pixels — they don't understand a UI as a UI. In practice: icons melt, on-screen text
garbles, a waveform smears into an abstract blob, and clean geometry (a stroked progress
ring, a pill's exact radius) warps unpredictably. That destroys the exact fidelity that makes
a component showcase satisfying, and it contradicts the same principle behind
[`INSTAGRAM_STYLE.md` §4](./INSTAGRAM_STYLE.md#4-screenshot-guidelines) ("real screenshots
only") — for motion, that becomes **real components only, code-recreated at 1:1 fidelity.**

Generative video's one legitimate seat at the table: **atmospheric B-roll** — a mood shot,
a cinematic brand intro — never the product UI itself.

---

## The Component Showcase format (production steps)

1. **Source the real component.** Pull the literal component + its child pieces (e.g.
   `FloatingPlayer.tsx` + `WaveVisualizer.tsx`) — colors, sizes, ratios, and state machine
   come from the code, not memory.
2. **Recreate at 1:1 fidelity** in a self-contained HTML page — real SVG icons, exact color
   tokens (`COLORS.purple` = `#7C3AED`, etc.), exact proportions (e.g. pill height = 0.6× the
   circle diameter, matching `PILL_H` / `D` in the source).
3. **Choreograph the 5-Phase Reveal** (below).
4. **Screen-record the framed stage** (⇧⌘5 on Mac) at the largest comfortable zoom —
   everything is vector/Canvas, so it stays crisp at any capture size.
5. **Export for Instagram** via ffmpeg: **1080×1920, H.264, `+faststart`**, trimmed to a
   seamless loop (start and end on the same resting state).

---

## The 5-Phase Component Reveal (reusable technique)

| Phase | Beat | Purpose |
|---|---|---|
| 1 | **Element-only pop-in** | The hero piece appears alone — nothing else on screen. Builds anticipation. |
| 2 | **Static expansion from center** | Supporting structure grows OUT of the hero element (not in from the edges) — keeps the hero as the visual anchor. |
| 3 | **Live / intense state** | The real behavior at its most alive (e.g. a beat-reactive wave) — the "wow" beat. |
| 4 | **Interactive states demoed** | Cycle the component's actual toggle states as if tapped (tap-ripple + pop) so the viewer learns what it does with no caption needed. |
| 5 | **Alternate mode reveal, then return** | Collapse, reveal a second real mode (e.g. Jam), then return to the Phase-1 resting state so the loop is seamless. |

---

## Do-not-break (production traps already paid for)

| Trap | Rule / Why |
|---|---|
| Fading hidden controls | Never fade a hidden state's controls while the container also resizes — **hide them fast first** (~120ms, no delay), *then* move the container. Fading during the resize reads as icons sliding through each other. |
| Vertical pill morph | Prefer collapsing/expanding **horizontally from center** (width 0 → full) over a vertical height morph — it reads as the bar retracting into / growing out of the hero element, not squashing flat. |
| Opacity ≠ hidden layout | An `opacity:0` control set still occupies its flow space and can shove a *visible* sibling set inward. Reserve a fixed center column for the hero element and pin each side's state-sets to the **outer edge** (absolute), so a hidden set never pushes a visible one. |
| Ending mid-state | Always return to the Phase-1 resting state before the loop repeats — an IG Reel autoloops, so the last frame must match the first or the seam shows. |

---

## 3D-depth variant (pure CSS — no WebGL, no libraries)

Works inside the Artifact CSP with **zero external dependencies**:

- `perspective` + `transform-style:preserve-3d` on a wrapping "scene," and `translateZ` to
  place each visual layer in depth — background glow deepest → pill → icon content → wave →
  hero element nearest the camera.
- **A distinct camera tilt per phase** (`rotateX`/`Y`/`Z`, ~1.1s ease glide) gives every beat
  of the choreography its own vantage point — a keynote/product-film feel, not a flat demo.
- **Ambient sway** — a slow, small, continuous rotation loop (a few degrees, ~8s) so the scene
  feels alive between the big tilts.
- **Beat-reactive depth** — drive a small `translateZ` pulse on the hero element from the same
  audio-envelope values that drive the visualizer, so it visibly pushes toward the viewer on
  each kick.
- **Floor glow** — a blurred radial-gradient ellipse on a steeply rotated plane beneath the
  scene grounds the composition without needing real 3D geometry.
- **Restraint matters.** Keep tilts roughly within ±20°. Pushed further, 3D reads as
  gimmicky/AI-generated — the opposite of the brand's authenticity edge. Subtle beats showy.

---

## Reference builds (fork these for the next Component Showcase)

- **Floating Player — flat 2D**, 5-phase reveal: `claude.ai/code/artifact/e4dde0a3-5c83-4c00-a46d-186b839c6841`
- **Floating Player — 3D depth variant** (per-phase tilts): `claude.ai/code/artifact/831980cf-02bb-41ab-8005-90c015f3a792`

Both are faithful to `src/components/FloatingPlayer.tsx` + `src/components/WaveVisualizer.tsx`.
Start the next showcase from this HTML/CSS/JS rather than a blank page — the layout model
(reserved center column, horizontal collapse, hide-before-collapse) already solves the traps
above.

---

## Caption pairing

Motion posts pair with the product-first voice
([`COPYWRITING_GUIDE.md`](./COPYWRITING_GUIDE.md) "The Solo Story") — the caption centers the
feature; the solo / build-in-public line is a closer, framed as strength, not the headline.

---

_Show the real thing, moving. That's the whole method._
