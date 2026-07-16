# LiViL — Instagram Style Guide

> **The definitive guide for LiViL's Instagram content.**
> Every post should look like a frame from a product-launch keynote — not a social feed.

**Version 1.0** · Companion to [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md), [`BRAND_GUIDE.md`](./BRAND_GUIDE.md), [`CREATIVE_DIRECTOR.md`](./CREATIVE_DIRECTOR.md)

This document does **not** redefine colors, type, gradients, or mockup rules — those live
in `DESIGN_SYSTEM.md` and are referenced by section (e.g. [DS §9](./DESIGN_SYSTEM.md#9-gradients)).
It defines how that system is _composed_ into Instagram artboards.

---

## How to use this guide

1. Pick a **[post category](#7-post-categories)** — it sets the layout, type scale, and screenshot rule.
2. If it's a carousel, pick a **[framework](#8-carousel-structure)**.
3. Build on the right **[canvas](#3-canvas-sizes)** with the **[layout grid](#2-layout-principles)**.
4. Frame screenshots per **[§4](#4-screenshot-guidelines)** — real UI only, always.
5. Run the **[Consistency Checklist](#12-consistency-checklist)** before publishing.

---

## Table of Contents

1. [Overall Goal](#1-overall-goal)
2. [Layout Principles](#2-layout-principles)
3. [Canvas Sizes](#3-canvas-sizes)
4. [Screenshot Guidelines](#4-screenshot-guidelines)
5. [Typography](#5-typography)
6. [Color Usage](#6-color-usage)
7. [Post Categories](#7-post-categories)
8. [Carousel Structure](#8-carousel-structure)
9. [Screenshot Placement](#9-screenshot-placement)
10. [Cards](#10-cards)
11. [Motion (for video posts)](#11-motion-for-video-posts)
12. [Image Generation](#12-image-generation)
13. [Things to Avoid](#13-things-to-avoid)
14. [Consistency Checklist](#14-consistency-checklist)

---

## 1. Overall Goal

### What people should feel

When someone lands on a LiViL post, they should feel like they've walked in on a
**calm, confident product keynote** — the Linear changelog, the Stripe Sessions stage,
an Apple "here's how we built it" segment. Not an ad. Not a meme. Not a growth-hack.

The feeling, in order:

1. **"That's a beautifully made product."** — before they read a single word.
2. **"These people care about the details."** — the spacing, the glow, the real UI.
3. **"I want to see what they ship next."** — they follow to watch the journey, not to be sold.

Per [`BRAND_GUIDE.md`](./BRAND_GUIDE.md): every post communicates one of —
_we build carefully · we care about details · we love music · we enjoy hard problems ·
we're transparent about the journey · we ship consistently._

### The aesthetic, defined

| It IS | It is NOT |
|---|---|
| Product-launch presentation | Social-media graphic |
| Portfolio piece / case study | Promotional flyer |
| Dark-first, obsidian canvas | Bright, white, "friendly" SaaS |
| Minimal, one idea per frame | Busy, multi-message collage |
| Engineering-honest | Hype / buzzword-driven |
| Premium & calm | Loud & urgent |
| Real screenshots as the hero | Stock photos, fake mockups, clip-art |

**The north-star test:** _Could this frame appear, unchanged, as a slide in a LiViL
keynote or in a design portfolio?_ If not, it's not ready.

---

## 2. Layout Principles

LiViL posts are built on **presentation composition**, not social-graphic composition.
Fewer elements, larger, with a lot of dark air around them.

### Visual hierarchy — one idea per frame
Every artboard has exactly **one** primary element (a headline, a screenshot, or a stat)
and at most **two** supporting ones. If you can't say the frame's purpose in one sentence,
it's doing too much. Reading order flows top-left → down, or center-out for hero frames.

### The grid
- **Canvas:** 1080px wide (all formats). Work at 2× (2160px) for crispness, export at 1080.
- **Outer margin (safe gutter):** **96px** left/right on a 1080 canvas (≈9%). Nothing
  important touches the edge. This generous margin is a LiViL signature — resist filling it.
- **Baseline grid:** 8px. All spacing is a multiple of 8 (mirrors [DS §5](./DESIGN_SYSTEM.md#5-spacing-system)).
- **Optical centering:** center content to the _optical_ middle, not the mathematical one —
  account for the Instagram caption/username crop at the bottom of feed posts.

### Whitespace & negative space
Negative space _is_ the design. The obsidian background (`#0A0A0F`) should occupy the
**majority** of most frames. Dark air around a screenshot signals confidence and quality;
a packed frame signals a discount. When in doubt, remove an element and enlarge the rest.

### Alignment
- **Left-align** text blocks by default (headline + supporting copy share a left edge).
- **Center** only hero statements and single-device showcases.
- Establish **one or two alignment lines** per frame and snap everything to them. No stray, floated elements.
- Screenshots and text should share an edge or a centerline — never drift independently.

### Balance & screenshot prominence
- On showcase frames the **screenshot is 55–70% of the visual weight**; text is a quiet caption.
- On statement frames text leads and any screenshot is a supporting sliver (or absent).
- Balance dark mass with the single purple glow — the glow is the counterweight that keeps a minimal frame from feeling empty.

### Density rule
Max **~40 words** of body copy on any single frame (headline excluded). If you need more,
it's a carousel, not a post.

---

## 3. Canvas Sizes

All widths are **1080px** (design at 2× → 2160px, export 1080px, PNG or high-quality JPG).

| Format | Ratio | Pixels | Use |
|---|---|---|---|
| **Feed — Portrait (default)** | 4:5 | **1080 × 1350** | Primary format. Maximum feed real estate. Use for almost everything. |
| **Feed — Square** | 1:1 | 1080 × 1080 | Single-stat frames, logo/announcement cards, when a 4:5 would waste space. |
| **Carousel** | 4:5 | **1080 × 1350** | All carousels. Keep every slide the same ratio — mixing crops looks amateur. |
| **Stories / Reels** | 9:16 | **1080 × 1920** | Stories, teasers, behind-the-scenes, polls. |
| **Landscape** | 1.91:1 | 1080 × 566 | Rare. Link-preview / cross-post to X only. Avoid in-feed (smallest crop). |

### Safe areas (keep critical content inside)

- **Feed 4:5 (1080×1350):** keep headlines and key UI within a **~120px top / ~120px bottom**
  inset. Instagram's username, caption, and action icons crop the extreme edges in some views.
- **Carousel:** additionally reserve the **bottom ~100px center** — the slide-dot indicator
  and "1/6" sits there. Don't place text or a device edge under it.
- **Stories/Reels (1080×1920):** reserve **top ~250px** (profile ring + name) and
  **bottom ~320px** (caption, reply bar, CTA sticker). Put the message in the **middle 1350px**.
- **Universal:** the 96px outer gutter from [§2](#2-layout-principles) already protects left/right.

### Grid & counts
- **Carousels:** 3–8 slides. Sweet spot **5–6**. Fewer than 3 → make it a single post.
- **9-post grid planning:** LiViL's profile grid should read as a **considered set**, not a
  scrapbook. Alternate frame _types_ (hero statement / device showcase / stat) so the grid
  has rhythm, but keep the obsidian background constant so it reads as one surface.

---

## 4. Screenshot Guidelines

**Real product screenshots are the heart of LiViL's Instagram.** They are the proof that
this is a real, beautifully-built app. Per `CREATIVE_DIRECTOR.md`: never generate an
illustration when a real screenshot communicates the idea better.

### When to use screenshots
- **Always**, when showing a feature, a UI detail, a flow, or progress.
- A post about the _product_ without a screenshot must justify itself — usually only pure
  statements, founder text, or roadmap frames skip them.
- When a screenshot doesn't exist yet, **specify exactly which screen to capture** (device,
  screen, state, what's on it) rather than faking it.

### Preferred screenshots (LiViL's hero screens)
In rough priority — these are the app's most beautiful, most on-brand surfaces:
1. **The Feed** (`HomeScreen`) — post cards, cover art, the purple play button glow.
2. **Full-Screen Player** — blurred art, gradient scrims, the wave. The single most premium screen.
3. **Jam Room** — the "music is better together" story, made visible (presence avatars, shared player).
4. **Floating mini-player** — the morphing pill; great for a detail/zoom frame.
5. **Chat / reactions** — the social side; bubbles, reaction pills.
6. **Playlist / album cover art** — the gradient system ([DS §9](./DESIGN_SYSTEM.md#9-gradients)) is inherently photogenic.

### Framing — the LiViL house style
Follow [DS §24 Phone Mockups](./DESIGN_SYSTEM.md#24-phone-mockups). Summary for Instagram:

| Attribute | Spec |
|---|---|
| **Mockup** | Modern bezel-less phone, **dark / graphite frame only** (never white — it fights the UI). |
| **Perspective** | Floating **3D angled**: ~**15–20° Y-rotation**, ~2–4° Z-tilt for life. Subtle perspective, no fisheye. |
| **Rotation** | Alternate left/right lean across a carousel so consecutive device slides don't feel stamped. |
| **Layering** | Device floats above the background with a clear gap. Optional **second phone** behind (angled, ~60% opacity or slightly blurred) for depth. |
| **Cropping** | Show the **whole device** on hero/showcase frames. Crop into a **bleeding edge** (device runs off one side) only for detail/zoom frames — see [§9](#9-screenshot-placement). |
| **Shadow** | Soft **purple glow** ([DS §7](./DESIGN_SYSTEM.md#7-shadows--elevation)): `#7C3AED` @ ~30%, large blur (~60–80px), pooled behind & below. The device should look like it's _emitting_ the app's light. Never a hard black drop shadow. |
| **Device spacing** | On dual/duo layouts, overlap phones by ~20–30% or keep a clear 64–96px gap — never let them touch edge-to-edge or crowd. |
| **Status bar** | Clean and dark. Hide carrier clutter; a simple time + full battery reads best. |

### Naked screenshots (no device frame)
Acceptable for **close-up / detail-zoom** frames where the UI element _is_ the subject —
present it inside a **20-radius rounded rectangle** ([DS §6](./DESIGN_SYSTEM.md#6-border-radius))
on the obsidian bg, with a subtle purple glow behind. Corner radius makes a bare screenshot
feel intentional rather than pasted.

### Absolute rule
**Never use fake, mocked-up, or aspirational UI.** If a feature isn't built, don't fabricate
its screen. Show the real state (even a work-in-progress), or show a wireframe _clearly
labelled as a design_ in a Design Breakdown post. LiViL's credibility is built on honesty.

---

## 5. Typography

Uses the system-font, heavy-weight, tight-tracking language from
[DS §4](./DESIGN_SYSTEM.md#4-typography), scaled up for presentation. (Marketing may use a
premium grotesk — e.g. Inter / SF Pro Display / General Sans — for headlines; keep it to
**one** family and reserve it for marketing, never the app UI.)

### Marketing type scale (on a 1080px-wide canvas)

| Role | Size (px) | Weight | Tracking | Color | Use |
|---|---|---|---|---|---|
| **Hero statement** | 96–120 | 800–900 | −2 to −3 | white | The one big line on a statement slide |
| **Headline** | 64–80 | 800 | −1.5 | white | Frame titles, feature names |
| **Subhead** | 40–48 | 700 | −0.5 | white / `#A78BFA` | Secondary line under a headline |
| **Body** | 28–32 | 400–500 | 0 | `#8B90A7` | Supporting copy (lh ≈ 1.4) |
| **Eyebrow / label** | 22–26 | 700 | **+2 (uppercase)** | `#A78BFA` or `#8B90A7` | Category tag above a headline ("ENGINEERING") |
| **Feature badge** | 20–24 | 700 | +0.5 | `#7C3AED` on `purpleDim` | Pill chip ("NEW", "SHIPPED") |
| **Statistic (number)** | 140–200 | 800–900 | −2 | white or gradient | The hero number on a metric frame |
| **Stat label** | 24–28 | 600 | +0.5 | `#8B90A7` | The word under a stat |
| **Quote** | 44–56 | 600 | −0.5 | white | Pull-quote / testimonial (italic optional) |
| **Code snippet** | 22–28 | 400 mono | 0 | syntax-tinted | Engineering posts (see below) |
| **Footnote / caption** | 20–24 | 500 | 0 | `#4B5268` | Slide number, handle, "1/6" |

### Headline hierarchy rule
Per frame: **one** hero/headline size, **one** supporting size, **one** label size. Three
type sizes max. A fourth size means the frame is trying to say too much.

### Spacing between text blocks
- Eyebrow → headline: **16–24px**.
- Headline → subhead: **24–32px**.
- Subhead/headline → body: **32–48px**.
- Body paragraph → paragraph: **24px**.
- Text block → screenshot: **64–96px** (generous — let the hero breathe).

### Small labels, badges, stats, quotes
- **Eyebrows** are always uppercase, tracked +2, in `purpleLight` or muted grey. They orient the reader ("FEATURE SPOTLIGHT", "DEEP DIVE").
- **Badges** reuse the app's pill language ([DS §12.6](./DESIGN_SYSTEM.md#126-chips-badges-avatars--shipped)): `purpleDim` fill + `purple` border, 999-radius.
- **Stats** are the loudest type in the system — a 180px number can be the entire frame. Pair with a quiet 24px label.
- **Quotes** get large, calm type and a lot of space; attribute in a 22px muted line. No giant quotation-mark graphics — a subtle purple accent bar (4px) to the left is enough.

### Code snippets (Engineering posts)
- Monospace (JetBrains Mono / SF Mono / Fira Code), 22–28px, in a `surface` (`#12121C`) card
  with 20-radius and 40–48px internal padding.
- Syntax coloring restrained and on-brand: keywords `#A78BFA`, strings `#22D3EE`, comments
  `#4B5268`, plain `#8B90A7`, foreground `white`. Never a bright rainbow theme.
- Show **5–12 lines max** — a focused excerpt, not a file. Highlight the one line that matters
  with a faint `purpleDim` row background.
- Real code from the repo (or a faithful simplification). Never fake code.

---

## 6. Color Usage

Pulls exclusively from [DS §3](./DESIGN_SYSTEM.md#3-color-system) and
[DS §9](./DESIGN_SYSTEM.md#9-gradients). How they compose for marketing:

### Backgrounds
- **Default:** flat obsidian **`#0A0A0F`**. This is the LiViL canvas — the vast majority of frames.
- **Depth variant:** the **hero gradient** `#0A0A0F → #1A1A2E → #3B1E6E` (obsidian rising into
  purple), used vertically or radially. Reserve for hero/opening and closing frames.
- **Surface panels:** `#12121C` (`surface`) / `#1A1A2E` (`card`) for cards on the canvas
  (see [§10](#10-cards)) — same elevation ramp as the app ([DS §3.2](./DESIGN_SYSTEM.md#32-elevation-by-color-the-dark-ramp--shipped)).
- Never a light, white, or high-saturation background. Ever.

### Accent colors
- **Purple `#7C3AED`** is _the_ accent — one hero accent per frame. Play buttons, badges,
  the glow, key underlines, the one word you emphasize.
- **`#A78BFA` (`purpleLight`)** for accent _text_ and highlights (better contrast than `#7C3AED` on dark).
- **Secondary hues** (`#22D3EE` cyan, `#EC4899` pink, `#00C853` green, `#F59E0B` amber) appear
  **only** as they naturally occur in cover-art gradients ([DS §9.1](./DESIGN_SYSTEM.md#91-as-built-gradient-systems--shipped)),
  or a single deliberate category tint. Never rainbow a frame.

### Text colors
- **White `#FFFFFF`** — headlines, hero statements, the words that matter.
- **`#8B90A7`** — body and supporting copy.
- **`#4B5268`** — footnotes, slide numbers, the quietest metadata. (Don't use for anything essential — [DS §3.4](./DESIGN_SYSTEM.md#34-accessibility--contrast).)
- Keep body text high-contrast; if a screenshot sits behind text, add a dark scrim like the player does.

### Gradients
- **Brand / hero:** `#7C3AED → #A78BFA` ("Royal") — the primary LiViL gradient, for hero text fills and glows.
- **Energetic accent:** `#EC4899 → #7C3AED` ("Berry") for release/celebration moments.
- **Warm:** `#F59E0B → #FF4D6D` ("Sunset") sparingly, for milestones.
- **Rule:** gradients go on **type fills, glows, and hero backgrounds** — never on body panels,
  never as a busy full-bleed texture. One gradient element per frame ([DS §9.2](./DESIGN_SYSTEM.md#92--reusable-brand-gradients-marketing--heroes)).

### Glow usage — the LiViL signature
- The **purple glow** is how LiViL creates depth and premium feel without clutter. Use it:
  - Behind the **device** (the app "emitting light").
  - Behind the **hero number / logo** on statement frames.
  - As a soft **radial** off-center on an otherwise flat obsidian frame, to avoid dead emptiness.
- **Restraint:** one, at most two glow sources per frame. Large, soft, low-opacity (~20–35%).
  A glow should feel like light in a dark room — never a neon sign. Never stack glows into a haze.

---

## 7. Post Categories

Each category has a fixed layout DNA so the feed reads as one company. All share the obsidian
canvas, 96px gutter, and type scale above.

### 1. Feature Spotlight
- **Purpose:** introduce one feature. **Format:** single 4:5 or 3–4 slide carousel.
- **Layout:** eyebrow "FEATURE" + headline (feature name) top-left → floating angled device
  showing the feature, purple glow, lower two-thirds. One-line benefit as body.
- **Screenshot:** the real feature screen, hero-framed. **Accent:** purple badge "NEW".

### 2. UI Showcase
- **Purpose:** let a beautiful screen speak. **Format:** single post or duo.
- **Layout:** minimal — device(s) large and centered/angled, tiny caption. Text is almost absent;
  the UI is the star. Maximum negative space + glow.
- **Screenshot:** hero screen (player, feed). Consider a **duo overlap** (feed + player).

### 3. Engineering Deep Dive
- **Purpose:** show how a hard problem was solved. **Format:** carousel (5–8).
- **Layout:** code card ([§5 code](#5-typography)) + a diagram/screenshot per slide. Eyebrow
  "ENGINEERING". Honest, specific, technical. Great source material: the playback single-engine,
  the beat-synced visualizer, the Fabric keyboard fix (all documented in `CLAUDE.md`).
- **Screenshot:** real code excerpts + before/after or architecture sketch on `surface` cards.

### 4. Founder Update
- **Purpose:** the human, build-in-public voice. **Format:** single post or short carousel.
- **Layout:** text-forward. Large calm quote/statement on obsidian, optional small founder note.
  Minimal or no device. Reads like a thoughtful journal entry, not an announcement.
- **Accent:** a single purple accent bar or underline. No stock "founder at laptop" photos.

### 5. Progress Update
- **Purpose:** "here's what shipped / where we are." **Format:** carousel or single.
- **Layout:** a checklist or timeline on `surface` cards (done = purple check, next = muted),
  or a stat frame. Eyebrow "PROGRESS" + date.
- **Screenshot:** optional — a device showing the newest thing.

### 6. Design Breakdown
- **Purpose:** show the craft — spacing, color, motion decisions. **Format:** carousel (5–7).
- **Layout:** annotated screenshots (redlines, spacing markers, color swatches in `purpleLight`).
  This is where a **labelled wireframe** is allowed (clearly a design artifact). Eyebrow "DESIGN".
- **Screenshot:** real screens with overlay annotations; swatch chips from [DS §3](./DESIGN_SYSTEM.md#3-color-system).

### 7. Roadmap
- **Purpose:** what's coming. **Format:** single 4:5 or carousel.
- **Layout:** vertical/horizontal timeline. Now / Next / Later columns or a phased list on
  `surface` cards. Current phase in purple, future in muted grey. Honest — no fake dates.
- **Accent:** one purple "you are here" marker.

### 8. Lessons Learned
- **Purpose:** reflect on a mistake or insight. **Format:** carousel.
- **Layout:** big statement per slide (the lesson), quiet body (the story). Text-forward, calm.
  Eyebrow "LESSONS" or "NOTES". Vulnerable and specific beats generic wisdom.

### 9. Release Notes
- **Purpose:** what changed in a version. **Format:** single 4:5 or 3-slide carousel.
- **Layout:** version number as a hero stat ("v1.1"), then a tight bulleted list on `surface`
  card — each item = purple check + short line. Mirrors a Linear changelog.
- **Screenshot:** one device showing the headline change.

### 10. Music Discovery
- **Purpose:** celebrate music / a track / a mood (the product's soul). **Format:** single or carousel.
- **Layout:** cover-art gradient ([DS §9](./DESIGN_SYSTEM.md#9-gradients)) as the hero — this is
  the one place richer color leads. Player screenshot, track/mood name in large type.
- **Screenshot:** the player or a playlist cover. Let the art's own gradient set the accent.

### 11. Artist Stories
- **Purpose:** spotlight an independent artist/creator. **Format:** carousel.
- **Layout:** artist's cover art / avatar hero, their words as a pull-quote, their music in the
  player screenshot. Warm and human. The artist's art may bring its own color — frame it in obsidian.
- **Rule:** real artists, real art, permission secured. Never stock musicians.

### 12. Community Highlights
- **Purpose:** show people using LiViL together (Jam Rooms, shared playlists, reactions).
- **Layout:** Jam Room / chat screenshots, presence avatars, a warm one-liner. The "music is
  better together" promise, made visible. Anonymize/consent real user content.

---

## 8. Carousel Structure

Reusable frameworks. Every carousel: same 4:5 ratio on every slide, obsidian canvas, consistent
gutter, slide number footnote, and a **cover slide that earns the swipe** + a **closing slide with
one CTA/question**. Consecutive device slides alternate lean.

### Framework A — Feature Story (default for Feature Spotlight)
1. **Hero** — feature name + one-line hook. Big type, glow, maybe a device peek.
2. **The problem** — what was annoying/missing. Honest, relatable.
3. **The solution** — the feature, stated simply.
4. **In the app** — the real screenshot, hero-framed.
5. **The detail** — one thoughtful touch (a zoom/close-up).
6. **Close** — "Try it / What would you add?" + wordmark.

### Framework B — Engineering Deep Dive
1. **Hero** — the problem as a provocative but honest title ("How we play audio + video on one engine").
2. **Why it's hard** — the constraint (Fabric defers view commands while backgrounded, etc.).
3. **The wrong way** — what didn't work / was ruled out.
4. **The approach** — the architecture, a diagram.
5. **The code** — the key excerpt (real).
6. **The result** — before/after, or the outcome.
7. **Close** — "Ask me anything / follow the build."

### Framework C — Progress / Build-in-Public
1. **Hero** — "This week at LiViL" / date.
2. **Shipped** — checklist of done (purple checks).
3. **Showcase** — device of the biggest new thing.
4. **Next** — what's coming (muted).
5. **Close** — a reflection + follow CTA.

### Framework D — Design Breakdown
1. **Hero** — "Designing the [screen]".
2. **The goal** — the feeling we wanted.
3. **Spacing/grid** — annotated screenshot.
4. **Color/type** — swatches + type specs.
5. **Motion** — the animation described (or a video slide).
6. **Final** — the polished screen, clean.
7. **Close** — "What details do you notice?"

### Framework E — Founder / Lessons (text-forward)
1. **Hero** — the statement/lesson, big.
2–4. **The story** — one calm idea per slide, quiet body.
5. **Close** — the takeaway + a question that invites replies.

> Cover-slide rule: slide 1 must communicate the whole value in **≤7 words** + a visual hook —
> the feed only shows slide 1, so it earns the follow and the swipe.

---

## 9. Screenshot Placement

How the hero screenshot sits in the frame. Pick per category/goal.

| Placement | When | Composition |
|---|---|---|
| **Single screenshot** | Feature Spotlight, Release Notes | One angled device, lower ⅔; text top-left; purple glow behind. The workhorse. |
| **Dual screenshot** | Showing a flow or two related screens | Two devices, overlapping ~20–30% or a clean 64–96px gap; one slightly forward. Alternate leans. |
| **Floating phones** | UI Showcase, hero frames | Device(s) floating with a clear gap above the bg, strong glow, gentle angle. Maximum negative space. |
| **Grid layout** | "Everything at once" / recap | 3–4 small screens in a neat grid on `surface` cards, equal radius (20). Used sparingly — density is off-brand, so keep it airy and aligned. |
| **Close-up UI** | Detail on one component | Crop tight to the element (the play button, a reaction pill, the wave). Naked screenshot in a 20-radius frame, glow behind. |
| **Detail zoom** | Design Breakdown | Full device + a magnified inset (circle or rounded rect) pulling out one detail, connected by a thin purple line. |
| **Bleeding edge** | Dynamic hero | Device runs off one edge of the frame (usually right), text on the open side. Adds energy without clutter. |

**Placement rules:**
- Screenshot and text share an alignment line ([§2](#2-layout-principles)).
- The device's glow is the visual counterweight to the text mass — place them on opposite sides/thirds.
- Never shrink a screenshot so small it can't be read — if the UI isn't legible, reframe or zoom.
- Consistent device model, frame color, and angle-family across a carousel.

---

## 10. Cards

On-canvas panels for structured content. All reuse the app's surface ramp and radius so
marketing and product feel identical. Base card: **`#12121C` (`surface`)**, **20-radius**
([DS §6](./DESIGN_SYSTEM.md#6-border-radius)), **1px `#252545` border**, **40–48px internal
padding**, optional soft glow.

| Card type | Style |
|---|---|
| **Feature card** | `surface`, 20-radius. Icon (`purpleDim` tile) + feature name (headline) + one-line body. Mirrors an app card. |
| **Engineering card** | `surface` code card — mono excerpt, syntax-tinted, one highlighted line (`purpleDim` row). 40–48px padding. |
| **Founder update** | Minimal — often no card at all; text on obsidian. If carded, `surface` with a 4px `purple` left accent bar (quote style). |
| **Metrics card** | Hero number (140–200px, white or Royal gradient) + label (`#8B90A7`). One stat per card. Optional tiny sparkline in `purpleLight`. |
| **Quote card** | `surface` or bare, big 44–56px quote, 4px purple accent bar left, muted attribution. No giant quote-mark glyph. |
| **Announcement card** | Centered wordmark + one line + purple badge. Uses the **hero gradient** bg. Reserved for real launches/milestones. |
| **Roadmap card** | `surface`, phased list. Current = purple check/fill; future = `#4B5268`. "Now / Next / Later" headers. |
| **Bug-fix card** | `surface`, small. Eyebrow "FIXED", a plain-English one-liner, optional tiny before/after. Honest, low-key — bug fixes are content too. |
| **Launch card** | The big moment: hero gradient bg, device + wordmark + "v1.0" stat + purple CTA. Save the strongest glow for these. |

**Card rules:** consistent radius (20) and border across a set; one accent per card; never nest
more than one card deep; keep 24–32px between stacked cards. Cards should look like they were
lifted straight out of the app.

---

## 11. Motion (for video posts)

When frames become Reels or animated posts, motion follows the app's philosophy
([DS §21](./DESIGN_SYSTEM.md#21-motion)): **smooth, purposeful, responsive, never distracting.**
Presentation-grade, like a Linear or Apple product film — not social jump-cuts.

### Principles
- **Calm and deliberate.** Slow, confident moves. Nothing frenetic, no snap-zoom meme energy.
- **One motion idea per shot.** A device drifts, or text fades, or a glow breathes — not all at once.
- **Ease everything.** Ease-in-out, ~300–500ms for UI moves; longer (2–4s) for ambient drift.

### Transitions
- **Cross-fades** and **soft slides** between frames (200–350ms). No hard cuts on hero moments.
- **Device hand-off:** one screen morphs/pushes to the next, mimicking real navigation.
- Match the app's real animation timing where showing the app (the floating-player morph, the
  wave, the tab-hide) — screen-record the real thing rather than re-animating it.

### Camera movement
- **Slow push-in / pull-back** on a floating device (±3–5% scale over 3–4s).
- **Gentle parallax:** device and its glow move at slightly different rates for depth.
- **Ambient float:** hero devices bob ±8px, ~3s ease-in-out (matches [DS §24](./DESIGN_SYSTEM.md#24-phone-mockups)).
- No spins, no whip-pans, no shake.

### Timing & structure
- **Hook in the first 1s** — the value/visual lands immediately (Reels are skimmed).
- Hold each key frame **long enough to read** (min ~1.5s for a headline).
- **Sound:** LiViL is a music app — use music intentionally, on-beat cuts where it fits. The wave
  visualizer reacting to the track is peak on-brand.
- Total: teasers 5–10s, deep dives up to 30–45s. End on the wordmark + one CTA.
- **Component Showcases** (a UI element brought to life) are built as **code-driven
  recreations**, never generative AI video — see [`MOTION_TECHNIQUES.md`](./MOTION_TECHNIQUES.md)
  for the production method, the 5-Phase Reveal, and the 3D-depth technique.

---

## 12. Image Generation

When a real screenshot can't carry the idea and an AI/rendered asset is needed (backgrounds,
abstract hero art, device renders, textures). **Default is still: use a real screenshot.**

### Prompt principles
Write prompts that enforce LiViL's identity. Always specify:
- **Aesthetic:** "premium, minimal, product-launch presentation, portfolio-quality, dark-first."
- **Palette:** "near-black `#0A0A0F` background, electric purple `#7C3AED` / `#A78BFA` accents,
  soft purple glow, subtle obsidian-to-purple gradient." Name the hexes.
- **Lighting:** "soft, cinematic, low-key studio lighting; a single soft purple light source; deep shadows."
- **Composition:** "lots of negative space, one focal subject, centered or rule-of-thirds, calm."
- **Reference vibe:** "in the style of Linear / Apple / Stripe product marketing."
- **Fidelity:** "high detail, clean, sharp, no text, no logos."

### Prompt template
```
A [subject] on a near-black #0A0A0F background, premium product-launch aesthetic,
minimal composition with generous negative space, soft purple (#7C3AED → #A78BFA) glow
as the only light source, subtle obsidian-to-purple gradient, cinematic low-key studio
lighting, deep shadows, high detail, sharp, no text, no logos, in the style of Linear
and Apple product marketing. Portrait 4:5.
```

### Rules
- **Never cartoonish / illustrated** unless the brief explicitly asks. No mascots, no doodles,
  no flat-vector "SaaS blobs," no 3D clay characters.
- **Never fake the app UI** with generation — devices may be rendered, but the _screen content_
  is always a real screenshot composited in.
- Generated backgrounds/textures are **supporting**, never the message. If AI art is the whole
  post, reconsider — LiViL's story is the product, not the render.
- Keep humans photographic and incidental if used at all; this brand leads with product, not people.

---

## 13. Things to Avoid

A LiViL post is defined as much by what it refuses to do. Never:

**Layout & density**
- ❌ Too much text on one frame (>~40 words body). Split into a carousel.
- ❌ Tiny, unreadable screenshots. If the UI can't be read, it fails its job.
- ❌ Messy, un-aligned layouts; floating elements with no alignment line.
- ❌ Cramming multiple messages into one frame. One idea per frame.
- ❌ Edge-to-edge content with no breathing room. Respect the 96px gutter.

**Imagery**
- ❌ **Fake, mocked, or aspirational UI.** The cardinal sin.
- ❌ Random stock photos (headphones on a desk, generic "music" imagery, laptop founders).
- ❌ White-framed phones, or phones on bright/white backgrounds.
- ❌ Cartoonish illustrations, mascots, clip-art, emoji-as-graphics.
- ❌ Hard black drop shadows on devices (use the purple glow).

**Color & effects**
- ❌ Light or white backgrounds. LiViL is dark-first, always.
- ❌ Bright, saturated, rainbow color. One purple accent per frame; secondary hues only from real cover art.
- ❌ Heavy, busy, multi-stop gradients as full-bleed texture. Gradients are for type, glow, heroes.
- ❌ Neon overload / stacked glows into a haze. Glow is quiet light, not a light show.
- ❌ Drop-shadowed text, bevels, gloss, or any 2010s effect.

**Voice & copy**
- ❌ Marketing buzzwords: "revolutionary, game-changing, next-gen, disrupting, industry-leading, ultimate." (See [`BRAND_GUIDE.md`](./BRAND_GUIDE.md#avoid).)
- ❌ Clickbait, fake urgency ("LAST CHANCE"), or engagement-bait.
- ❌ Emoji overload. At most one, as a quiet accent, never as a control or bullet.
- ❌ Hype, exclamation-mark spam, ALL-CAPS shouting (except small tracked eyebrows/badges).
- ❌ Over-explaining. Confident and short beats thorough and loud.

**General**
- ❌ Inconsistent device models/angles/frame colors across a set.
- ❌ Mixing aspect ratios within a carousel.
- ❌ Anything that would look at home on a generic "growth marketing" account.

---

## 14. Consistency Checklist

Every post passes **all** of these before publishing. If any fails, fix it or don't ship.

**Identity**
- [ ] Background is dark (`#0A0A0F` or the obsidian→purple hero gradient) — no white/light.
- [ ] Exactly **one** hero accent (purple) per frame; no rainbow.
- [ ] Purple **glow** used as light, not a light-show (≤2 soft sources per frame).
- [ ] Could this frame appear, unchanged, in a LiViL keynote or a design portfolio? (The north-star test.)

**Layout**
- [ ] One clear idea per frame; ≤40 words of body copy.
- [ ] 96px outer gutter respected; nothing important on the edge.
- [ ] Everything snaps to 1–2 alignment lines; spacing on the 8px grid.
- [ ] Generous negative space; the frame feels calm, not full.
- [ ] ≤3 type sizes; heavy weight + tight tracking on headlines.

**Screenshots**
- [ ] Real product UI — **nothing faked or mocked**.
- [ ] Device is dark-framed, floating, angled 15–20°, with a purple glow.
- [ ] Screenshot is legible; hero screens preferred (feed / player / jam).
- [ ] Consistent device + angle-family across the carousel.

**Format**
- [ ] Correct canvas (4:5 feed / 1080×1920 story); safe areas respected.
- [ ] Carousel: same ratio on every slide; cover earns the swipe (≤7-word value); closing slide has one CTA.
- [ ] Slide numbers / footnotes consistent.

**Voice**
- [ ] Founder voice — short, clear, confident, no buzzwords ([`BRAND_GUIDE.md`](./BRAND_GUIDE.md)).
- [ ] No clickbait, no fake urgency, ≤1 emoji.
- [ ] The post teaches, inspires, or shows progress (per `CREATIVE_DIRECTOR.md`).
- [ ] Caption sparks a conversation, not just a broadcast.

**Final gut check**
- [ ] Would this make someone think _"a startup I'd love to work at"_ / _"these people care about music"_?
- [ ] Does it strengthen the brand, or just fill the calendar? (If the latter — don't post it.)

---

_When this guide and `DESIGN_SYSTEM.md` disagree on a token, the Design System wins. When it
disagrees with `BRAND_GUIDE.md` on voice, the Brand Guide wins. This document owns only how they
compose into Instagram artboards. Keep every post unmistakably LiViL: calm, premium, dark,
music-first — a product keynote, one frame at a time._
