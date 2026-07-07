# LiViL — Advanced Carousel Techniques

> **A LiViL carousel is one continuous presentation, not a folder of images.**
> Every swipe should reward the user by answering a question the last slide raised.

**Version 1.0** · Craft layer for [`POST_FRAMEWORKS.md`](./POST_FRAMEWORKS.md) + [`INSTAGRAM_STYLE.md`](./INSTAGRAM_STYLE.md)
Built on [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md), [`BRAND_GUIDE.md`](./BRAND_GUIDE.md), [`CREATIVE_DIRECTOR.md`](./CREATIVE_DIRECTOR.md)

`POST_FRAMEWORKS.md` tells you the **story shape**; `INSTAGRAM_STYLE.md` tells you the
**look**. This doc is the **carousel craft** — how to make a multi-slide post feel like a
single, moving, rewarding presentation. It assumes the tokens and rules from those docs and
does not redefine them.

---

## Core principle

Instagram shows only slide 1 in the feed, then reveals the rest **one at a time on swipe** —
no peek of the next slide. That constraint is the whole game:

- **Slide 1 must earn the swipe** (≤7-word value + a visual hook — [IS §8](./INSTAGRAM_STYLE.md#8-carousel-structure)).
- **Every slide must end on an open loop** — an incomplete headline, a half-shown device, a
  raised question — that the next slide closes. This is what makes swiping feel _rewarded_
  rather than optional.
- **Never repeat information.** Each swipe advances; nothing restates.

The techniques below are ten ways to build that continuous, rewarding motion. Use them to
_serve the story_ ([Story Progression](#10-story-progression)) — never as decoration.

---

## The master-canvas method (how continuity is actually built)

Every continuous-canvas technique here (shared backgrounds, split screenshots, extending
devices, spanning headlines) is built the same way. **This is the executional core — read it first.**

### The math
- Each slide is **1080 × 1350** (4:5 — [IS §3](./INSTAGRAM_STYLE.md#3-canvas-sizes)).
- A carousel of **N** continuous slides is designed as **one master canvas**:
  **width = N × 1080**, height = 1350. (5 slides → **5400 × 1350**. Work at 2× → 10800 × 2700, export slices at 1080 × 1350.)
- Slice the master at every **1080px boundary**: slide 1 = px 0–1080, slide 2 = 1080–2160, etc.
- Export each slice as its own image, in order. On swipe they reassemble into the continuous scene.

### The seam rule (the one thing that breaks continuity)
The slice line is a **hard seam** — Instagram adds no gap, but the swipe animation and any
device bezel/rounding makes the boundary _visible_. So:

- **Keep critical content off the seam.** Never let a face, a key word, a logo, or a UI hotspot
  land _on_ a 1080 boundary. Text and focal points live in the safe middle of each slide panel.
- **Cross the seam only with continuous, forgiving elements** — gradients, a long screenshot, a
  device body, a timeline line, a waveform. These read fine when split; sharp details don't.
- **Respect the per-slide safe area** ([IS §3](./INSTAGRAM_STYLE.md#3-canvas-sizes)) on _every_
  panel: 96px outer gutter, ~120px top/bottom inset, and the bottom-center ~100px reserved for
  the slide-dot "1/N" indicator. A background may bleed edge-to-edge; _content_ stays inside.

### Design-then-slice workflow
1. Build the whole scene on the N×1080 master.
2. Drop **guide lines** at every 1080 boundary; nudge focal elements to panel-centers.
3. Verify each 1080 window reads as a complete slide on its own AND flows to the next.
4. Slice, export in order, and **preview by swiping on a phone** before publishing — the seam
   only reveals itself in the real swipe.

> Not every carousel is continuous. A "discrete" carousel (each slide self-contained, shared
> only by style) is valid and simpler — use it for Release Notes, Progress Updates. Reserve the
> master-canvas method for stories where continuity _adds_ meaning.

---

## 1. Continuous Canvas

**What:** Slides share one unbroken background — a gradient, artwork, or texture that flows
across the whole carousel.

**How (LiViL):**
- Run the **hero gradient** `#0A0A0F → #1A1A2E → #3B1E6E` ([DS §9](./DESIGN_SYSTEM.md#9-gradients))
  horizontally across the full N×1080 master, so purple deepens as the user swipes toward the payoff.
- Or hold a flat obsidian field constant and move a **single purple glow** across slides (glow
  low on slide 1, drifting up/across to sit behind the hero on the final slide) — cheap, powerful continuity.
- Cover-art gradients ([DS §9.1](./DESIGN_SYSTEM.md#91-as-built-gradient-systems--shipped)) can span a Music Discovery / Artist Story carousel.

**Rule:** the background is continuous; the _content_ still respects each panel's safe area. One
gradient/glow system per carousel — don't switch palettes mid-swipe.

---

## 2. Split Screenshots

**What:** One long UI screenshot spans multiple slides — a feed, playlist, Jam Room, or chat
extended across panels.

**How (LiViL):**
- Capture a **tall/long real screenshot** (e.g. a scrolled feed, a full playlist, a long chat).
  Place it on the master; let it cross seams as a continuous device screen.
- **Feed across 2 slides:** post card A resolves on slide 1, the next card begins and completes on slide 2.
- **Playlist across 3:** cover + first tracks (1) → mid-list (2) → end + CTA (3).
- **Jam Room across multiple:** the shared player (1) → the presence avatars (2) → the group chat (3).
- **Chat revealed progressively:** see [Progressive Reveal](#3-progressive-reveal).

**Rule:** **never crop randomly.** Split on natural UI gaps (between cards, between messages,
between sections) — never mid-word, mid-face, or mid-control. Every split must look deliberate.
Real UI only ([IS §4](./INSTAGRAM_STYLE.md#4-screenshot-guidelines)).

---

## 3. Progressive Reveal

**What:** Withhold, then reveal on swipe — surface only the top of an interface first, then more,
then the implementation, then the outcome.

**How (LiViL):**
- Slide 1: the surface (what the user sees).
- Slide 2: reveal more of the screen / the interaction.
- Slide 3: the implementation detail (code, diagram, design decision).
- Slide 4: the outcome / why it matters.
- Pairs naturally with **Engineering Deep Dive**, **Design Breakdown**, **Feature Spotlight**
  ([frameworks 3, 11, 1](./POST_FRAMEWORKS.md)).

**Rule:** each slide answers the question the previous slide raised, and raises the next. The
reveal must feel earned, not padded — if a slide adds nothing, cut it.

---

## 4. Zoom Storytelling

**What:** Start wide, then zoom deeper each slide — whole screen → one component → one
interaction → why it matters.

**How (LiViL):**
- Slide 1: the full device / screen.
- Slide 2: zoom to one component (the play button, a reaction pill, the wave visualizer) — a
  naked screenshot in a 20-radius frame ([IS §9](./INSTAGRAM_STYLE.md#9-screenshot-placement)).
- Slide 3: zoom to the single interaction (the morph, the like, the scrub).
- Slide 4: the payoff — why that detail matters.
- Optional: a thin purple connector line from the wide shot to the zoomed inset for spatial continuity.

**Rule:** keep the zoom target legible at each step; the deepest zoom is still sharp real UI.
Consistent device angle across the zoom sequence.

---

## 5. Layered Devices

**What:** A phone begins on one slide and continues onto the next; devices overlap across panels.

**How (LiViL):**
- Place a device on the master so its body **crosses a seam** — it exits slide 1's right edge and
  enters slide 2's left, as one continuous object.
- Or a **second device** ([IS §9 dual/floating](./INSTAGRAM_STYLE.md#9-screenshot-placement))
  half-revealed on slide 1, fully on slide 2 — a swipe "brings it into frame."
- Keep the floating-3D-angled house style ([DS §24](./DESIGN_SYSTEM.md#24-phone-mockups)) and one
  purple glow that travels with the device.

**Rule:** **perspective and lean stay consistent** across the span — a device can't change its
angle mid-cross. The glow crosses the seam with it.

---

## 6. Large Headlines (spanning type)

**What:** A single headline is deliberately split across slides so the sentence completes on swipe.

**How (LiViL):**
- Slide 1: **"Music"** — huge, 96–120px, tight tracking ([IS §5](./INSTAGRAM_STYLE.md#5-typography)).
- Slide 2: **"should be social."** — the completion.
- Or a 3-beat: "Discovery" / "is better" / "with people."
- Type can also physically continue across the seam (a giant word exits right, resumes left) using
  the master-canvas method — but only for a word that survives being split cleanly (avoid splitting mid-letter awkwardly).

**Rule:** the incomplete first slide must still make someone _want_ the rest. The tension of an
unfinished sentence is the swipe engine. Don't complete the thought on slide 1.

---

## 7. Continuous Timeline

**What:** Multiple slides build a single timeline / journey the user travels by swiping.

**How (LiViL):**
- A **connector line** (thin, `purpleLight`) runs across the full master, crossing every seam; each
  slide is one stop with a node on the line.
- LiViL's signature journey — the product thesis, made visual:
  **Discovery → Playlist → Jam Room → Conversation → Friendship.**
  One stop per slide, each with a real screenshot of that moment.
- Current/reached nodes in purple; upcoming in muted grey (mirrors the roadmap card, [IS §10](./INSTAGRAM_STYLE.md#10-cards)).

**Rule:** the line is continuous across seams (a forgiving element — [seam rule](#the-seam-rule-the-one-thing-that-breaks-continuity)); the node labels sit safely inside each panel. Great for **Future Vision**, **Product Decision**, brand-thesis posts.

---

## 8. Animated Feeling (static that implies motion)

**What:** Static slides composed so the eye perceives movement across the swipe.

**How (LiViL):**
- **Objects entering:** a card/device sits further into frame each slide (slightly more revealed,
  or nudged along a consistent vector).
- **Cards sliding:** a post card lower/off-frame on slide 1, centered on slide 2 — the swipe "slides" it in.
- **Phone rotation:** device lean shifts a few degrees per slide (15° → 12° → 8°) so swiping "rotates" it toward the viewer.
- **Waveform growing:** the wave visualizer ([DS §15](./DESIGN_SYSTEM.md#15-player-ui)) flatter on
  early slides, fuller/taller on later ones — the track "builds."
- **Player progressing:** the seek bar / progress ring advances each slide (10% → 45% → 90%) — time "passes" as you swipe.

**Rule:** motion cues follow **one consistent direction/vector** across the carousel (usually
left-to-right, matching swipe). Contradictory motion reads as a mistake. Subtle beats dramatic —
this is implied movement, not a flipbook.

---

## 9. Hidden Details (reward the swipe)

**What:** Small rewards on later slides for users who go deep.

**How (LiViL):**
- A tiny implementation note in a footnote ("this runs on one audio engine").
- A real, meaningful statistic revealed late.
- A design decision or an engineering insight most posts wouldn't bother sharing.
- A small easter egg — a `♪`, a hidden waveform, a wink in the copy — never loud.
- Place these in the footnote zone (20–24px, `#4B5268` — [IS §5](./INSTAGRAM_STYLE.md#5-typography)) so they reward attention without cluttering.

**Rule:** hidden details are a bonus, never load-bearing — the story must fully land without them.
On-brand insight over gimmick; one or two per carousel, not a scavenger hunt.

---

## 10. Story Progression

**What:** The discipline that makes a carousel a _presentation_ — the rule all other techniques serve.

**How (LiViL):**
- Map the carousel as a **question chain**: slide 1 poses a question; each slide answers it and
  poses the next; the final slide resolves and invites discussion ([Universal Checklist](./POST_FRAMEWORKS.md#universal-checklist)).
- Use a `POST_FRAMEWORKS` structure as the spine (Framework A–E, [IS §8](./INSTAGRAM_STYLE.md#8-carousel-structure)).
- Sweet spot **5–6 slides** (range 3–8; Instagram allows up to 20, LiViL rarely exceeds 8 — restraint is on-brand).

**Rules:**
- **Never repeat information** — no slide restates a prior one.
- **Every swipe answers the previous slide's open loop.**
- **The last slide closes the story** and carries the single CTA + wordmark.
- If a slide doesn't advance the story, delete it. Fewer, tighter slides beat padded ones.

---

## Creative Layouts (a menu, in service of story)

Experiment freely — but every choice must _improve_ storytelling, never distract. Pair these with
the techniques above:

| Layout | Best for | Technique it uses |
|---|---|---|
| Split screenshots | Long feed / playlist / chat | [§2](#2-split-screenshots) |
| Continuous mockups | A flow across screens | [§5](#5-layered-devices) |
| Full-width artwork spanning slides | Music Discovery, Artist Story | [§1](#1-continuous-canvas) |
| Cropped UI details | Zoom / detail focus | [§4](#4-zoom-storytelling) |
| Multi-slide diagrams | Engineering / architecture | [§3](#3-progressive-reveal) |
| Layered typography | Hero statements | [§6](#6-large-headlines) |
| Full carousel backgrounds | Any continuous story | [§1](#1-continuous-canvas) |
| Giant statistics | Milestone, Metrics | [IS §5 stat](./INSTAGRAM_STYLE.md#5-typography) |
| Hero art + screenshots | Discovery, brand posts | [§1](#1-continuous-canvas) + [§2](#2-split-screenshots) |
| Phone frames extending past slide edges | Layered devices | [§5](#5-layered-devices) |
| Scrollable feed simulation | "Look at the feed" | [§2](#2-split-screenshots) + [§8](#8-animated-feeling) |
| Before/After sliding comparison | Redesigns | [§8](#8-animated-feeling) + [Framework 4](./POST_FRAMEWORKS.md#4-before-vs-after) |
| Multi-slide architecture diagram | Deep Dive | [§3](#3-progressive-reveal) |
| Long timelines / journey maps | Brand thesis, roadmap | [§7](#7-continuous-timeline) |
| Progressive feature reveals | Feature Spotlight | [§3](#3-progressive-reveal) |

**All must still obey:** obsidian canvas, one purple accent, 96px gutter, real UI only, per-slide
safe areas, and the seam rule. Creativity within the system — never instead of it.

---

## Carousel Craft Checklist

Run this in addition to the [Universal Checklist](./POST_FRAMEWORKS.md#universal-checklist) and
[IS §14](./INSTAGRAM_STYLE.md#14-consistency-checklist).

**Continuity**
- [ ] Slide 1 earns the swipe on its own (feed shows only slide 1).
- [ ] Every slide ends on an open loop the next slide closes.
- [ ] No slide repeats information; each swipe advances the story.
- [ ] The final slide resolves the story + carries the one CTA + wordmark.

**Master-canvas execution** (if continuous)
- [ ] Designed on an N×1080 master; sliced cleanly at 1080 boundaries.
- [ ] No critical content (faces, key words, logos, hotspots) lands on a seam.
- [ ] Only forgiving elements (gradient, device body, screenshot, line, wave) cross seams.
- [ ] Per-slide safe areas respected on every panel (gutter, top/bottom, dot zone).
- [ ] Consistent device angle/lean and one traveling glow across spans.

**Motion & reward**
- [ ] Implied motion (if used) follows one consistent direction across slides.
- [ ] At least one earned reward on a later slide (insight/stat/detail) — but story lands without it.

**Restraint**
- [ ] 3–8 slides (target 5–6); no padding.
- [ ] One gradient/glow system, one purple accent, one type hierarchy throughout.
- [ ] Every creative choice serves the story — remove anything that only decorates.

**Final preview**
- [ ] Previewed by actually swiping on a phone — the seam and the flow only reveal themselves live.

---

_A LiViL carousel is a keynote you hold in your hand: one continuous canvas, every swipe a
deliberate reveal, nothing repeated, nothing wasted. Techniques serve the story; the story serves
the brand — calm, premium, music-first._
