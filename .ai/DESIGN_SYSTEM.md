# LiViL — Design System

> **The single source of truth for LiViL's visual identity.**
> _Your music, your world. Live · Vibe · Link._

**Version 1.1** · Last synced with code: **2026-07-05** · Owner: Design + whoever last touched `src/theme/`
See [§27 Governance & Changelog](#27-governance--changelog) for how this doc stays true.

---

## How to use this document

1. **Building a screen?** Start at [§0 Quick Reference](#0-quick-reference), then [§10 Interaction States](#10-interaction-states) and the relevant component section.
2. **Picking a value (color / spacing / radius)?** Every ambiguous token has a **✅ Go-forward default** — use it and move on. Don't re-derive.
3. **Writing marketing/mockups?** Jump to [§24 Phone Mockups](#24-phone-mockups) + [§25 Marketing Assets](#25-marketing-assets).
4. **When code and this doc disagree:** the code's `COLORS` file wins for _colors_; this doc wins for _intent, rules, and everything not yet tokenized_. Fix whichever is wrong and bump the changelog.

### Status legend — every claim in this doc is tagged

| Tag | Meaning |
|---|---|
| **✅ Shipped** | Exists in code today. The `file.tsx:line` reference proves it. This is law. |
| **🔵 Recommendation** | Proposed addition/normalization. **Not in code yet.** Adopt deliberately. |
| **⚠️ Inconsistency** | A real drift found in the audit. Documented so it gets reconciled, not copied. |
| **✅ Go-forward default** | When as-built values conflict, THIS is the one to use for new work. Resolves ambiguity. |

> If a section has no tag, assume **✅ Shipped**.

---

## Table of Contents

**Foundations**
- [§0 Quick Reference](#0-quick-reference)
- [§1 Design Philosophy](#1-design-philosophy)
- [§2 Core Principles](#2-core-principles)
- [§3 Color System](#3-color-system)
- [§4 Typography](#4-typography)
- [§5 Spacing System](#5-spacing-system)
- [§6 Border Radius](#6-border-radius)
- [§7 Shadows & Elevation](#7-shadows--elevation)
- [§8 Z-Index & Layering](#8-z-index--layering)
- [§9 Gradients](#9-gradients)

**Systems**
- [§10 Interaction States](#10-interaction-states)
- [§11 Icons](#11-icons)
- [§12 Components](#12-components)
- [§13 Component Anatomy](#13-component-anatomy)
- [§14 Empty, Loading & Error States](#14-empty-loading--error-states)

**Surfaces**
- [§15 Player UI](#15-player-ui)
- [§16 Feed UI](#16-feed-ui)
- [§17 Chat Screens](#17-chat-screens)
- [§18 Jam Rooms](#18-jam-rooms)
- [§19 Navigation & Bottom Tabs](#19-navigation--bottom-tabs)

**Cross-cutting**
- [§20 Layout Principles](#20-layout-principles)
- [§21 Motion](#21-motion)
- [§22 Accessibility](#22-accessibility)
- [§23 Voice & Tone](#23-voice--tone)

**Brand & Marketing**
- [§24 Phone Mockups](#24-phone-mockups)
- [§25 Marketing Assets](#25-marketing-assets)

**Governance**
- [§26 Do's & Don'ts](#26-dos--donts)
- [§27 Governance & Changelog](#27-governance--changelog)
- [Appendix A: Known Inconsistencies](#appendix-a-known-inconsistencies)
- [Appendix B: Recommended Token Files](#appendix-b-recommended-token-files)
- [Appendix C: Source-of-Truth Map](#appendix-c-source-of-truth-map)

---

## §0 Quick Reference

The 90% you'll reach for daily. Full detail in the linked sections.

```
COLOR          bg #0A0A0F · surface #12121C · card #1A1A2E · inputBg #1C1C30
               accent purple #7C3AED · accentLight #A78BFA
               text: white #FFFFFF · secondary #8B90A7 · muted #4B5268
               border #252545 · error #EF4444 · like #FF4D6D · online #22C55E

TYPE           system font (no custom family). Headers heavy (800/900) + tight (−0.2/−0.5).
               h1 22/900 · title 15/800 · body 15/400 lh21 · label 13/700 · caption 11/600
               numbers → fontVariant:['tabular-nums']

SPACE (new)    4 · 8 · 12 · 16 · 20 · 24   ·  screen gutter = 16, header gutter = 20

RADIUS (new)   xs4 · sm8 · md12 · lg18 · xl20 · xxl24 · pill999 · round(size/2)
               card=xl20 · media=lg18 · input/button=md12 · chip=pill

SHADOW         purple GLOW on actions (glowL {0,4}/0.5/r10), black LIFT on overlays.
               feed cards cast NO shadow (border + surface do the work).

PRESS          filled → activeOpacity 0.85 · ghost/icon → 0.7 · disabled → opacity 0.6

ICONS          <Icon name="..."> only. default 20px, textSecondary. Never inside <Text>.

RULES          dark only · no Alert.alert (use ConfirmActionModal / useToast) ·
               FormInput only · createNativeStackNavigator only · no new native pkgs
```

---

## §1 Design Philosophy

LiViL feels like a **late-night listening room**. The interface disappears into a
near-black canvas (`#0A0A0F`) so that album art, waveforms, and people's music are
the only things that glow. A single electric-purple accent (`#7C3AED`) threads
through the entire app — it's the color of "play", "send", "you", and "live".

The mood is **premium, calm, and music-first**. Chrome is quiet and translucent;
it slides out of the way when you scroll. Content — a post, a cover, a message,
a face — is always the loudest thing on screen. When the app _does_ speak, it does
so with a soft purple halo (glow shadows) rather than hard borders or bright fills,
giving surfaces a sense of depth and warmth without ever leaving the dark.

Nothing is skeuomorphic and nothing is flat-boring: it's **neon-on-obsidian**.
Rounded, pill-heavy geometry keeps it friendly and social (it is, after all,
Spotify × Discord × SoundCloud), while heavy, tightly-tracked type gives headers
a confident, editorial weight.

**The one-sentence test.** _Would this element still feel calm, premium, and
music-first at 2 a.m. in the dark?_ If it's loud, bright-on-white, or busy, it's
not LiViL.

---

## §2 Core Principles

| Principle | What it means in LiViL | How to check you followed it |
|---|---|---|
| **Dark-first** | One theme only. `#0A0A0F` base, no light mode — ever. | No white/light backgrounds anywhere, in-app or in marketing UI shots. |
| **Music-first** | Cover art, waveforms and the player are the visual anchors. Floating player is _always_ present. | The most saturated pixels on screen are user content (art), not chrome. |
| **Content-focused** | Chrome is translucent (`rgba(10,10,15,0.90)`) and auto-hides on scroll (`ChromeVisibilityContext`). | Chrome never competes with a post for attention. |
| **Premium** | Purple **glow** shadows (not black drop shadows) on primary actions. Blurred hero art, gradient scrims. | Every primary CTA emits a purple halo. |
| **Calm** | Muted secondary text, generous line-height, no aggressive color except genuine errors. | No more than one accent color competing per screen. |
| **Minimal** | One accent color. Icons over labels. Pills over boxes. | Could you remove any element and lose nothing? Then remove it. |
| **Accessible** | High-contrast body text; real touch targets; motion you can opt out of. | See [§22](#22-accessibility) — run the contrast + 44pt checks. |
| **One truth, never fork** | Playback is a single engine; color is a single token file. | New value? Add it to the token file, don't inline a hex. |

---

## §3 Color System

### 3.1 The palette — ✅ Shipped

Source of truth: [`src/theme/colors.ts`](../src/theme/colors.ts). **Import `COLORS`
— never hard-code a hex that already has a token.**

| Token | Value | Usage | Meaning |
|---|---|---|---|
| `bg` | `#0A0A0F` | App/screen background, deepest layer | The obsidian canvas |
| `surface` | `#12121C` | Cards, received chat bubbles, sheets, tab bar fill | First elevation |
| `card` | `#1A1A2E` | Nested cards (track cards, header action buttons, media fallback) | Second elevation |
| `inputBg` | `#1C1C30` | `FormInput` fill, tombstone posts | Interactive field surface |
| `purple` | `#7C3AED` | **Primary accent** — CTAs, active states, sent bubbles, play button, links | "Play / You / Live" |
| `purpleLight` | `#A78BFA` | Active tab icon, highlights, avatar initials, seek-bar fill, focused accents | Bright accent / emphasis |
| `purpleDim` | `rgba(124,58,237,0.15)` | Avatar backgrounds, chips, subtle tints, Android ripple | Muted accent wash |
| `purpleGlow` | `rgba(124,58,237,0.30)` | Stronger purple overlays | Glow / hover wash |
| `white` | `#FFFFFF` | Primary text, titles, icons on purple | Foreground |
| `textSecondary` | `#8B90A7` | Handles, captions, secondary body | Secondary foreground |
| `textMuted` | `#4B5268` | Timestamps, placeholders, inactive tab icons | Tertiary / disabled |
| `border` | `#252545` | Card borders, dividers, skeleton shimmer, disabled send button | Hairline structure |
| `error` | `#EF4444` | Destructive actions, error text/icons | Danger |
| `errorBg` | `rgba(239,68,68,0.10)` | Error banner fill | Danger wash |
| `errorBorder` | `rgba(239,68,68,0.30)` | Error banner / leave-jam border | Danger edge |
| `warning` | `#F59E0B` | Warnings (amber) | Caution |
| `warningBg` | `rgba(245,158,11,0.12)` | Warning wash | |
| `warningBorder` | `rgba(245,158,11,0.35)` | Warning edge | |
| `info` | `#22D3EE` | Info badges, "creator" tags (cyan) | Informational |
| `infoBg` | `rgba(34,211,238,0.12)` | Info wash | |
| `infoBorder` | `rgba(34,211,238,0.35)` | Info edge | |

### 3.2 Elevation-by-color (the dark ramp) — ✅ Shipped

LiViL builds depth by **lightening the surface**, not by adding shadows to cards.
Memorize this ladder — it's the backbone of the whole UI:

```
#0A0A0F  bg        ← screen
  #12121C  surface   ← card / sheet / bubble
    #1A1A2E  card      ← nested card inside a surface
      #1C1C30  inputBg   ← interactive field
```

The `errorBg/errorBorder`, `warningBg/warningBorder`, `infoBg/infoBorder` triplets
establish the **standard "status container" recipe**: 10–12% fill + 30–35% border of
the same hue. Use this exact recipe for any new semantic container.

### 3.3 Colors used in code but NOT yet tokenized — ⚠️ Inconsistency → 🔵 Recommendation

These literal hexes recur and should be promoted to `COLORS` (spec in [Appendix B](#appendix-b-recommended-token-files)):

| Literal | Where | Proposed token |
|---|---|---|
| `#EC4899` (pink) | Fallback cover blobs, cover-picker | `pink` |
| `#FF4D6D` (red-pink) | **Liked** heart + like count | `like` |
| `#00BFFF` (neon blue) | Cover-picker; `CLAUDE.md` "secondary accent" | `blue` |
| `#00C853` (green) | Cover-picker; `CLAUDE.md` "success" | `success` |
| `#22C55E` (online green) | Presence dots | `online` |
| `#FF4444` (jam live-red) | Live-jam pulse dot, JamBanner | `live` |
| `#E53935` (delete red) | Queue swipe-to-delete bg | retire → `error` |

**⚠️ Four reds in flight** — `error #EF4444`, like `#FF4D6D`, live `#FF4444`, delete `#E53935`.
**✅ Go-forward default:** exactly **three semantic reds** — `error` (destructive/validation),
`like` (`#FF4D6D`, engagement), `live` (`#FF4444`, real-time). Never introduce a fourth;
retire `#E53935` to `error`.

### 3.4 Accessibility & contrast — ✅ Shipped values, 🔵 fixes

Ratios vs their real backgrounds (WCAG AA body = 4.5:1, large/UI = 3:1):

| Pair | Ratio | Verdict |
|---|---|---|
| `white` on `bg`/`surface` | ~19:1 | ✅ AAA |
| `textSecondary #8B90A7` on `bg` | ~6.8:1 | ✅ AA |
| `textMuted #4B5268` on `bg` | ~3.1:1 | ⚠️ Fails AA for body. Large/decorative only. |
| `textSecondary` on `surface` (received bubble) | ~4.7:1 | ⚠️ Borderline. 🔵 Move to white. |
| `purple #7C3AED` on `bg` | ~4.4:1 | ✅ UI/large only. Never small body text. |
| `purpleLight #A78BFA` on `bg` | ~7.5:1 | ✅ Use for small accent text. |
| `white` on `purple` fill | ~5.0:1 | ✅ AA |

**✅ Go-forward rules:**
- `textMuted` only for ≥16px or non-essential metadata. Never for anything a user must read.
- Small accent text → `purpleLight`, never `purple`.
- Received chat bubble body → `white` (🔵 currently `textSecondary`).

---

## §4 Typography

**Font family — ✅ Shipped:** the **system font** everywhere (SF on iOS, Roboto on
Android). There is **no custom `fontFamily`** in the codebase (verified: zero declarations).
🔵 Keep it — instant load, native crispness. Any brand face stays marketing-only, never body UI.

**Numeric — ✅ Shipped:** changing numbers use `fontVariant: ['tabular-nums']` (timers,
counts, seek). **Always apply this to any number that updates in place.**

### 4.1 Weight scale — ✅ Shipped

LiViL runs **heavy**. By frequency: `700` (default emphasis, ~158) · `800` (strong
headers/titles, ~59) · `600` (semibold labels, ~90) · `900` (heaviest display, ~18) ·
`500` (sheet actions, ~9) · `400/300` (system messages, rare).

**Character:** headers use **negative tracking** (`−0.2` to `−0.5`, up to `−3` on the
88px onboarding wordmark). Uppercase labels use **positive tracking** (`+0.8` to `+1.2`).

### 4.2 Type ramp — ✅ Shipped (consolidated)

| Role | Size | Weight | Tracking | Color | Example |
|---|---|---|---|---|---|
| Display / wordmark | 88 | 800 | −3 | white | Onboarding "livil" |
| Screen H1 | 34 | 800 | −0.5 | white | "Welcome back" |
| Feed heading | 22 | 900 | −0.4 | white | HomeScreen feed title |
| In-app wordmark | 22 | 800 | −0.5 | white | Home top bar |
| Section heading | 17 | 800 | −0.2 | white | "Stories", sheet titles |
| Track title (card) | 17 | 800 | −0.3 | white | PostCard title |
| Title / display name | 15 | 800 | −0.2 | white | Post author |
| Row title | 15 | 600 | — | white | Inbox name, sheet action |
| Body (message) | 15 | 400 | — | white / secondary | Chat bubble (lh 21) |
| Body (caption) | 14 | 400 | — | textSecondary | Post caption (lh 20) |
| Label / stat | 13 | 600–700 | — | secondary | Stat counts, tabs |
| Metadata | 12 | 400–600 | — | muted/secondary | Handle, timestamp |
| Caption / helper | 11 | 600 | +0.2 | muted/secondary | Time separator, badges |
| Micro-label (upper) | 9–10 | 800–900 | +1 to +1.2 | varies | "VIDEO", creator tag |

**Line-height rule:** body runs `lineHeight ≈ size + 5..6` (14→20, 15→21). Keep the ratio.

**⚠️ Inconsistency:** the 700/800/900 boundary is applied a bit arbitrarily (feed heading
900, most titles 800, some section titles 700). **✅ Go-forward default:** use the ramp above
verbatim — `900` reserved for the single largest heading on a screen, `800` for all other
titles, `700` for labels/emphasis.

### 4.3 🔵 Named type tokens

No `typography.ts` exists today. Proposed tokens in [Appendix B](#appendix-b-recommended-token-files).

---

## §5 Spacing System

**⚠️** No spacing constant file exists; values are inlined. But the code is consistent
around a **4-based scale**, clustering at **4, 6, 8, 10, 12, 14, 16, 20, 24**.

### 5.1 As-built conventions — ✅ Shipped

| Context | Value |
|---|---|
| Card internal padding | 14 |
| Gap between feed cards | 14 |
| Header row gap (avatar ↔ text) | 12 |
| Icon ↔ label micro-gap | 4 |
| Name ↔ handle ↔ dot | 6 |
| Sheet/row vertical padding | 10–14 |

### 5.2 🔵 `SPACING` scale + go-forward rules

Adopt an 8-point scale (4 = half-step). Snap outliers (`7, 9, 15, 18, 22`) to nearest step.

```
xxs 2 · xs 4 · sm 6 · md 8 · lg 12 · xl 16 · xxl 20 · xxxl 24 · huge 32
```

**✅ Go-forward defaults (removes the "which gutter?" ambiguity):**
- **Screen/content gutter → 16** (`xl`). Lists, cards, feed.
- **Header & section-heading gutter → 20** (`xxl`).
- **Focused single-task screen (auth, onboarding) → 24** (`xxxl`).
- **Related items gap → 8** (`md`). **Loosely-related → 12** (`lg`). **Icon+label → 4** (`xs`).

---

## §6 Border Radius

### 6.1 As-built — ✅ Shipped

`999` (pill), `20`, `18`, `14`, `12`, `10`, `8`, `6`, `4` dominate; circular = half-of-size.

| Element | Radius |
|---|---|
| Pills / chips / tab-toggles | `999` (small pills like AddBadge/JamBanner use `20`) |
| Feed post card · modal · bottom sheet (top) | `20` |
| Reaction-picker card | `24` |
| Cover art / video thumb / skeleton | `18` |
| Profile grid card art | `14` |
| Input (`FormInput`) | `13` |
| Primary/secondary button | `14` |
| Modal button / send button | `12` |
| Chat bubble | `18` + `4` on sender-side tail corner |
| Reaction pill | `14` |
| Track card | `10` |
| Video badge / small tag | `6` |
| Sheet drag handle | `2` |
| Circular (avatars, round buttons) | `size / 2` |

### 6.2 🔵 Unified scale + go-forward defaults

Current set has drift (card 20 vs skeleton 18; cover 18 vs grid 14; input 13 / button 14 / modal-btn 12).

```
xs 4 · sm 8 · md 12 · lg 18 · xl 20 · xxl 24 · pill 999 · round(size/2)
```

**✅ Go-forward defaults (use these for NEW work; migrate old values opportunistically):**
- **Cards, sheets, modals → `xl` (20).**
- **Media / cover art / skeletons → `lg` (18).**
- **Inputs & buttons → `md` (12).** (Retires the 13/14 split.)
- **Chips / toggles / pills → `pill` (999).**
- **Small tags, track cards, bubble tails → `sm`/`xs`.**
- Grid-card art stays `14` **only if** you want a deliberately tighter grid; otherwise `lg` (18) to match feed. Pick one and document per-screen.

---

## §7 Shadows & Elevation

LiViL's signature is the **purple glow**, not a neutral drop shadow. Interactive elements
cast a `shadowColor: COLORS.purple` halo; **overlay** surfaces (modals, dragged rows) cast neutral black.

### 7.1 The shadow ladder — ✅ Shipped

| Preset | Element | offset | opacity | radius | elev | color |
|---|---|---|---|---|---|---|
| **glowXl** | Primary auth CTA | `{0,8}` | 0.45 | 18 | 8 | purple |
| **glowL** | Play button, upload/logo mark, story ring | `{0,4}` | 0.5–0.55 | 10 | 6 | purple |
| **glowM** | Active tab pill, visibility pill, JamBanner, send button | `{0,2}` | 0.4–0.5 | 6 | 3–4 | purple |
| **lift** | Modal / reaction-picker / dragged queue row | `{0,4}` | 0.3 | 8 | 8 | `#000` |
| **thumb** | Player scrubber knob | `{0,0}` | 0.6 | 6–8 | 4–8 | purple |

> **⚠️ Merged from prior "glowS/glowM":** the old two presets were perceptually identical
> (both `{0,2}/0.4/r6`, differing only in Android `elevation`). **✅ Go-forward default:**
> one **`glowM`** preset covers all small/medium purple actions; use `elevation: 4`.

### 7.2 Rules — ✅ Shipped

- **Any purple CTA gets a purple glow** — match the fill color in `shadowColor`.
- **Overlay/floating surfaces use neutral black** — glow is for _actions_, black is for _lift_.
- **Feed cards cast NO shadow** — border (`#252545`) + surface lightening separate them. Keep the feed flat.
- Always pair iOS `shadow*` with Android `elevation`.

Presets to codify: [Appendix B](#appendix-b-recommended-token-files).

---

## §8 Z-Index & Layering

🔵 There is no z-index token scale today; ordering is implicit in `RootNavigator`'s render
order plus a couple of literal `zIndex` values. Documented here so new overlays don't collide.

### 8.1 As-built stacking order — ✅ Shipped

From [`RootNavigator.tsx`](../src/navigation/RootNavigator.tsx) (bottom → top):

```
1  Navigation stack (screens)
2  GlobalAudioPlayer            (silent engine, 0×0)
3  FullScreenPlayer             (modal media surface)
4  FloatingPlayer               (absolute, above tab bar)
5  JamBanner                    (zIndex 9999, top-center)
6  Splash overlay               (cold-start, top of all)
```

Plus in-screen: fixed top bar `zIndex: 10`; tab bar absolute-bottom; sheet/modal scrims full-screen.

### 8.2 🔵 Proposed `Z` scale

```
base 0 · sticky 10 (fixed headers) · chrome 20 (tab bar, floating player) ·
overlayScrim 100 · overlayContent 110 (modals, sheets) ·
banner 9999 (JamBanner) · splash 10000
```

**Rule:** anything full-screen-blocking (scrim) sits at `overlayScrim`; its card at
`overlayContent`. Global always-on-top banners use `banner`. Don't invent ad-hoc `zIndex`.

---

## §9 Gradients

Gradients are used **sparingly and purposefully**, rendered with `react-native-svg`
`<LinearGradient>` — **never** `react-native-linear-gradient` (no new native pkgs, see `CLAUDE.md`).

### 9.1 As-built gradient systems — ✅ Shipped

**A. Cover-art gradients** — [`PlaylistCoverPicker.tsx`](../src/components/PlaylistCoverPicker.tsx)
`COVER_COLOR_OPTIONS`, rendered by [`EmojiCoverArt.tsx`](../src/components/EmojiCoverArt.tsx).
Always **top-left → bottom-right** (`x1=0 y1=0 x2=1 y2=1`):

| Name | Stops | | Name | Stops |
|---|---|---|---|---|
| Sunset | `#F59E0B → #FF4D6D` | | Mint | `#22D3EE → #00C853` |
| Ocean | `#00BFFF → #7C3AED` | | Royal | `#7C3AED → #A78BFA` |
| Forest | `#00C853 → #22D3EE` | | Twilight | `#1A1A2E → #7C3AED` |
| Berry | `#EC4899 → #7C3AED` | | Dusk | `#F59E0B → #7C3AED` |
| Lava | `#FF4D6D → #3B1E6E` | | | |

Solid cover options: `#7C3AED, #A78BFA, #EC4899, #00BFFF, #22D3EE, #00C853, #F59E0B, #FF4D6D, #1A1A2E`.

**B. Profile grid fallback accents** — `ProfileGridCard` `FALLBACK_ACCENTS`:
`[#7C3AED,#3B1E6E]`, `[#EC4899,#7C3AED]`, `[#22D3EE,#3B82F6]`, `[#F59E0B,#EF4444]`.

**C. "Blob" fallback art (missing cover)** — the universal art-missing texture in
`PostCard`/`FloatingPlayer`/`FullScreenPlayer`: a **purple** blob (`#7C3AED`, ~0.45, 240px,
top-left) + a **pink** blob (`#EC4899`, ~0.35, 200px, bottom-right).

**D. Player scrims** — `FullScreenPlayer` lays dark top+bottom gradient bands (black →
transparent) so white text reads over any art.

### 9.2 🔵 Reusable brand gradients (marketing + heroes)

| Purpose | Gradient |
|---|---|
| Brand / hero | `#7C3AED → #A78BFA` ("Royal") |
| Deep hero background | `#0A0A0F → #1A1A2E → #3B1E6E` (obsidian → purple) |
| Background glow (radial) | `radial(#7C3AED @0.30 → transparent)` behind key art |
| Energetic accent | `#EC4899 → #7C3AED` ("Berry") |
| Warm / celebratory | `#F59E0B → #FF4D6D` ("Sunset") |

**Rule:** gradients belong on **art, heroes, and glows** — never on tab bars, cards, or inputs.

---

## §10 Interaction States

🔵 This unifies values that are currently scattered across components. **This is the
contract for every interactive element** — a designer/agent should never have to guess a state.

### 10.1 The state matrix

| State | Visual treatment | As-built values |
|---|---|---|
| **Default** | Resting. | Per-component fill/border. |
| **Pressed** | Dim the whole element. | `activeOpacity` — **0.85** filled buttons/cards, **0.7** icon/ghost/rows. Android adds ripple `purpleDim`. |
| **Focused** (input) | Border → accent, instant (no animation). | `FormInput` border `#252545 → #7C3AED (purple)`, width 1.5. |
| **Selected / active** (toggle, tab) | Purple fill + white text + **glowM**. | Visibility pill, profile tab, jam tab. Inactive = transparent/bordered. |
| **Disabled** | Reduce opacity; do not change layout. | **0.6** (primary buttons) / **0.45** (send/comment). Send also swaps fill → `border`. |
| **Loading** | Replace content with skeleton (lists) or spinner (actions); keep footprint. | `PostCardSkeleton` shimmer = `border` color shapes. See [§14](#14-empty-loading--error-states). |
| **Liked / reacted** | Flip icon to `fill` + recolor. | Heart → `#FF4D6D` fill; reaction pill → `rgba(124,58,237,0.35)`. |
| **Error** (field/action) | `error` border/text + toast. | `errorBorder` on container; message via `useToast({kind:'error'})`. |

### 10.2 Rules — ✅ Go-forward defaults

- **Every touchable declares a pressed state.** Filled → `activeOpacity 0.85`; ghost/icon/row → `0.7`.
- **Disabled reduces opacity, never reflows.** Keep size stable so layout doesn't jump.
- **Focus is instant** (no animated border) — deliberate, avoids the Fabric remount trap.
- **Selected = purple fill + white + glowM.** This is the ONE selected-state recipe; don't invent alternates (underlines, outlines, checkmarks) without cause.
- **Touch targets ≥ 44×44pt** even when the visual is smaller — pad with `hitSlop` (see [§22](#22-accessibility)).

---

## §11 Icons

**Single import surface:** [`src/components/Icon.tsx`](../src/components/Icon.tsx).
**Never** hard-code a glyph/emoji as a UI icon; **never nest `<Icon>` in `<Text>`** (it's
SVG — wrap in a `<View>` row). See `CLAUDE.md`.

- **Library:** [Phosphor](https://phosphoricons.com) (`phosphor-react-native 3.0.6`) for
  everything + **Lucide** (`lucide-react-native 1.18.0`) for the one `drum` icon. Pure-JS
  SVG on `react-native-svg` — no native rebuild.
- **Weight conventions (from the `REGISTRY` defaults):**
  - **`fill`** — playback transport, musical objects (note/disc), status (checkCircle/error/info), roles.
  - **`bold`** — directional/structural (back, forward, close, add, repost, shuffle, repeat).
  - **`regular`** — passive/engagement outlines (unfilled heart, comment, flag, eye, tab icons).
  - Active engagement icons flip to **`fill`** (liked heart).
- **Default size 20px, default color `textSecondary`.**

### 11.1 Preferred sizes — ✅ Shipped

| Context | Size | | Context | Size |
|---|---|---|---|---|
| Feed action row | 16 | | Full-screen transport | 20 |
| Overflow / header / sheet action | 18 | | Send glyph | 28 (DM) / 18 (jam) |
| Tab bar | 26 | | Small chips / visibility | 12 |
| Center play-overlay (video) | 56 | | Play button glyph (card) | 16 |

**Stroke:** Phosphor weight handles it; the lone Lucide `drum` uses `strokeWidth 2` (regular) / `2.5` (bold/fill).

**Adding an icon:** map a **Livil-semantic** name in the `REGISTRY` (e.g. `mic`, not `Microphone`).

### 11.2 Emoji exceptions (stay text, NOT icons) — ✅ Shipped

Chat reaction emoji + picker, emoji in copy (`🎵 ${title}`, `👑 Host`), single-char
initials fallback (`name.charAt(0) || '♪'`), `ConfirmActionModal`'s decorative `glyph`.

---

## §12 Components

### 12.1 Buttons — ✅ Shipped

| Variant | Bg | Border | Radius | Padding | Text | Shadow |
|---|---|---|---|---|---|---|
| **Primary (CTA)** | `purple` | — | 14 | 16 v | white 16/700 | glowXl |
| **Secondary (outline)** | transparent / `surface` | 1.5 `border` | 14 | 15–16 v | white 15–16/600 | none |
| **Modal primary** | accent (purple/error) | — | 12 | 14 v | white 15/700 | glowM (color-matched) |
| **Modal secondary (cancel)** | transparent | — | — | 8 v | `textSecondary` 14 | none |
| **Send (circular)** | `purple` / `border` (disabled) | — | 19 (=38/2) | — | white send 28 | glowM |
| **Play button (card)** | `purple` | — | 23 (=46/2) | — | white play 16 | glowL |
| **Round back / icon** | `surface` | 1 `border` | 21 (=42/2) | — | icon | none |
| **Pill (visibility / tab)** | `purple` (active) / transparent | 1 `purple`/`border` | 999 | 6–8 v / 10–14 h | 13/700 | glowM when active |
| **AddBadge (chip)** | `purpleDim` | 1 `purple` | 20 | 2–3 v / 7–9 h | `purple` 10–12/600–700 | none |

States: see [§10](#10-interaction-states). Disabled 0.6 (primary) / 0.45 (send). Press 0.85 / 0.7.

### 12.2 Inputs — `FormInput` — ✅ Shipped

Always [`FormInput`](../src/components/FormInput.tsx) — never a raw `TextInput` with focus
state lifted to a parent (remount + keyboard dismissal on Android 15 Fabric).

- Wrapper: `flexDirection: row`, bg `inputBg`, radius **13** (🔵 → 12), border **1.5**.
- Border: `border` → **`purple` focused** (instant).
- Text 15 `white`; placeholder `textMuted`. Padding 15 v / 14 h (0-right with trailing icon).
- **Uppercase field label:** 12/600 `textSecondary`, `+0.8` tracking, `textTransform: uppercase`.

### 12.3 Cards — ✅ Shipped

- **Feed post card:** bg `surface`, radius **20**, border 1 `border`, padding 14, `mx 16`, `mb 14`. **No shadow.**
- **Nested track card:** bg `card`, radius 10, padding 8, 44×44 art (radius 6).
- **Profile grid card:** 2-col, art `aspectRatio 1` radius 14, title 13/700, sub 11.
- **Skeleton:** same footprint; all placeholders filled `border` (`#252545`) as shimmer base.

### 12.4 Modals — ✅ Shipped

- **Scrim:** `rgba(0,0,0,0.55–0.65)`, centered, `px 24`.
- **Card:** bg `surface`, radius 20, maxWidth **360**, border 1 `border`, padding 22 h / 24 top / 18 bottom.
- **Icon circle:** 56×56, radius 28, `purpleDim` fill + 1px `purple` ring (error variant → error tints). Glyph 26–28.
- **Title** 20/700 white centered; **subtitle** 14 `textSecondary` lh 20 centered.
- **Never `Alert.alert`.** Confirm → `ConfirmActionModal` or a `NotificationPermissionModal`/`JamExitModal`-style modal. Status/errors → toast (`useToast`).

### 12.5 Bottom sheets — ✅ Shipped

- **Overlay:** `rgba(0,0,0,0.55–0.6)`, `justifyContent: flex-end`.
- **Sheet:** bg `surface` (or `bg` for tall content), **top corners radius 20**, padding 12 top / `16 + insets.bottom` bottom. Tall → `maxHeight 80–90%`.
- **Drag handle:** 36–40 × 4, radius 2, `border`, centered, `mb 12–16`.
- **Action row:** 14 v, gap 14, 24px fixed icon column, label 15/500 white (destructive → `error`).

### 12.6 Chips, badges, avatars — ✅ Shipped

- **Pill chip:** radius 999, `purpleDim` fill + `purple` border (accent) or bordered transparent (neutral). Text 13/700.
- **Status container:** `{hue}Bg` + `{hue}Border`, radius 999, micro-label 9/900 `+1.2`.
- **Count badge:** `purple` bg, radius 8–10, min 16–20 square, 9–11/700–800 white. **⚠️ Jam unread badge is `#EF4444`** (red) not purple — see rule below.
- **Avatars:** circular, `purpleDim` fill + 1px `purple` border, `purpleLight` bold initials. Sizes **28** (chat), **32** (jam/mentions), **42** (feed header), **52** (inbox), **74** (story ring). Presence dot 9–12px `#22C55E`, `bg` border, bottom-right.

**✅ Go-forward badge rule (resolves the ⚠️ split):** **purple** badge = counts/messages;
**red (`live`)** badge = real-time/urgent (active jam). Apply consistently.

### 12.7 Lists — ✅ Shipped

Rows: `row`, gap 10–12, 12–16 h / 10–14 v, `activeOpacity 0.7–0.75`, hairline `border`
bottom divider. Leading avatar/thumb → flex-1 text column → trailing time/badge. Titles
14–15/600–700 white; subtitles 12–13 `textSecondary`; unread bumps preview to white/600.

---

## §13 Component Anatomy

🔵 Labeled anatomy of the two hero components, so a new designer can rebuild them exactly.

### 13.1 Post card — [`PostCard.tsx`](../src/components/PostCard.tsx)

```
┌─ card: surface · radius 20 · border 1 #252545 · padding 14 ──────────┐
│  [repost banner]  ⟲ 12/muted "X reposted"        (only if repost)    │
│                                                                       │
│  ┌avatar 42⟳21┐  Display Name           15/800 −0.2 white   ⟲  ⋯     │
│  │ purpleDim  │  @handle · 3h            12 muted           32px btns │
│  └ 1px purple ┘                                              card bg  │
│                                                                       │
│  Track Title                            17/800 −0.3 white (2 lines)   │
│  Caption text…                          14/lh20 secondary (4 lines)   │
│                                                                       │
│  ┌─ media: aspectRatio 1 · radius 18 · card bg ──────────┐          │
│  │            (cover art / video / blob-duo)              │  [VIDEO]  │
│  └────────────────────────────────────────────────────────┘          │
│                                                                       │
│  ┌play 46⟳23┐   ♡ 12    💬 4    ⟲ 2        16px icons · 13/600 counts │
│  │ purple    │   liked → #FF4D6D                                      │
│  └ glowL     ┘                                                        │
└───────────────────────────────────────────────────────────────────────┘
mx 16 · mb 14 between cards
```

### 13.2 Floating player — [`FloatingPlayer.tsx`](../src/components/FloatingPlayer.tsx)

```
Three morph states (spring, bounciness 12):

RESTING     ───────  2px line, 30% screen wide (wave visualizer draws it)
                     transparent bg/border

EXPANDED    (⇄) ●●● (↻)   pill h36 · radius 18 · bg rgba(10,10,15,0.9)
                          border 1px rgba(124,58,237,0.5) · pad 10h/4gap

CIRCLE       ◜◝  60px · 4px ring: textMuted track + purple/purpleLight arc
            ◟◞  inner disc bg · center flash play/pause glyph rgba(255,255,255,0.92)

Position: bottom = max(10% screen, tabBarH + 56) · width 82% · centered
Jam mode adds: 28px avatar + pulsing 8px #FF4444 live dot + "↑ Jam" chip
```

---

## §14 Empty, Loading & Error States

🔵 A doctrine, not a component. **Every list, feed, and async surface must define all three.**
Today only some do (feed skeleton, feed-end message); make it universal.

| State | Treatment | As-built reference |
|---|---|---|
| **Loading (list)** | Skeleton with the real layout's footprint; placeholder shapes in `border` color. Never a bare spinner for lists. | `PostCardSkeleton` |
| **Loading (action)** | In-place spinner or disabled+dimmed button (0.6). Keep the button's size. | send/CTA disabled state |
| **Empty** | Centered, calm: a small purple-tinted icon or the equalizer motif, a 15/600 white title, a 13 `textSecondary` line, optional single purple CTA. | `FeedEndMessage` (animated 5-bar purple equalizer) |
| **End-of-list** | The equalizer motif + "you're all caught up"-style line. | `FeedEndMessage` |
| **Error (surface)** | `errorBg`+`errorBorder` banner, radius 14, with a pill retry button (`purple`). | HomeScreen error banner |
| **Error (transient)** | Toast `useToast({kind:'error'})`. Never `Alert.alert`. | ToastContext |

**✅ Go-forward rules:**
- Loading a list → skeleton of that list, not a spinner.
- Empty ≠ error. Empty is friendly and invites action; error explains + offers retry.
- Every empty state gets **at most one** primary action. Don't crowd it.
- Reuse the **purple equalizer bars** motif as LiViL's signature empty/end illustration.

---

## §15 Player UI

Single-engine system — `GlobalAudioPlayer` is the only MediaSession owner (see `CLAUDE.md`). Three surfaces:

### 15.1 Floating mini-player — ✅ Shipped
See anatomy [§13.2](#132-floating-player--floatingplayertsx). Morphing pill above the tab bar;
resting = 2px wave line, expanded = 36px pill, circle = 60px progress ring (`textMuted` track +
`purpleLight`/`purple` arc). Wave (`WaveVisualizer.tsx`): white SVG `<Path>`, `strokeWidth 2.5`,
round caps, 40-point, 30px tall, beat-reactive from `waveform_peaks`.

### 15.2 Full-screen player — ✅ Shipped
Bg `#000` with media (muted video slaved to engine) or blurred cover; fallback = blob-duo. Dark
gradient scrims top+bottom; white text carries `textShadow rgba(0,0,0,0.9)`. **Seek bar** (`SeekBar.tsx`):
4px track `rgba(255,255,255,0.12)`, fill `purpleLight`, 14px white thumb + purple glow, 12px hit-slop.
Liked heart `#FF4D6D`; stat pills on `rgba(255,255,255,0.10)` + `0.15` white border.

### 15.3 Clip editor & queue — ✅ Shipped
`ClipRangeSlider`: 6px track, `rgba(255,255,255,0.25)` disabled / `0.88` lookahead, purple progress,
18px white handles. `QueueList`: 64px rows, 44px thumb (radius 8), current title `purpleLight` + 8px
purple dot; swipe-delete = red (`#E53935` → 🔵 `error`) bg; drag scales to 1.04.

---

## §16 Feed UI

The feed (`HomeScreen`) is the heart of the app. — ✅ Shipped

- **Top bar:** fixed, translucent `rgba(10,10,15,0.90)`, hairline `rgba(124,58,237,0.25)` bottom
  border, `zIndex 10`. Logo mark (32px purple square, radius 10, glowL, "L" 16/800), wordmark
  (22/800 −0.5), inbox button (38px `surface`, purple count badge), upload + (38px purple, glowL).
- **Stories row:** 74px purple-ringed avatars (glow), 14px gaps, heading 17/800 −0.2.
- **Feed heading:** 22/900 −0.4 + 13 muted subheading.
- **Post card:** see [§13.1](#131-post-card--postcardtsx).
- **"VIDEO" badge:** `rgba(0,0,0,0.65)`, radius 6, 10/800 `+1` white.
- **End message:** animated 5-bar purple equalizer + 15/600 title + 13 subtitle, centered.

---

## §17 Chat Screens

`ConversationScreen` (DMs) + `InboxScreen` (list). — ✅ Shipped

- **Bubbles:** max-width **75%**, radius **18** + **4px tail** on the sender-side bottom corner.
  Padding 14 h / 9 v, text 15 lh 21.
  - **Sent (me):** bg `purple`, text **white**.
  - **Received (them):** bg `surface`, text `textSecondary` → **🔵 white** (see [§3.4](#34-accessibility--contrast)).
- **Quoted reply strip:** 3px left border, radius 4; me = `rgba(0,0,0,0.30)` + white border; them = `rgba(255,255,255,0.10)` + `purpleLight` border.
- **Reaction pills:** absolute `bottom:-12`, radius 14, `rgba(255,255,255,0.10)` (or `rgba(124,58,237,0.35)` reacted-by-me), emoji 14 + count 11/600 white.
- **Reaction picker (long-press):** scrim `rgba(0,0,0,0.5)`, card `card` radius 24, quick emoji 26px, expandable 10-col grid (22px).
- **Send bar:** translucent `rgba(10,10,15,0.90)`, hairline purple top, `FormInput` + 38px circular send (purple / `border` disabled, glowM).
- **Time separator:** centered 11/600 `+0.2` `textSecondary`, no divider lines.
- **Read receipts:** right-aligned 11/500 `textSecondary` ("Seen"/"Delivered"/"Sending…").
- **System messages:** centered 12 italic `textMuted`.
- **Inbox row:** 52px avatar (green online dot), name 15/600, preview 13 (white/600 unread), time 12, purple unread badge (radius 10).
- **Swipe-to-reply:** 32px `purpleDim` circle + `purpleLight` reply arrow fades/scales in at threshold.

---

## §18 Jam Rooms

`JamRoomScreen` — real-time listen-together. — ✅ Shipped

- **Header:** "Jam Room" 16/700 + "👑 host…" 11 `textSecondary`. **End/Leave button:** error-tinted (`rgba(239,68,68,0.12)` + `0.35` border), radius 8, `error` text 13/700.
- **Player panel:** 110×110 art (radius 12), title 15/700 + artist 12 centered, seek bar, **52px circular purple** play/pause.
- **Presence row:** 32px avatars, 9px `#22C55E` online dots, host crown AddBadge (top-right), "+N" overflow chip past 5.
- **Tabs (Player/Chat):** segmented control in a `surface` pill (radius 10, 3px inset), active = purple fill, label 13/600. Chat unread badge = **red `#EF4444`** (per [§12.6](#126-chips-badges-avatars--shipped) rule).
- **Jam chat bubbles:** simplified — 75%, radius 14 + 4px tail, sent purple / received `surface`, group sender name 11/700 `purpleLight`, text 14 white.
- **JamBanner** (global): top-center pill, `purple` fill, radius 20, purple glow, "Return" chip (`rgba(255,255,255,0.2)`), `zIndex 9999`.

---

## §19 Navigation & Bottom Tabs

— ✅ Shipped

- **Navigator:** `createNativeStackNavigator` only. Auth screens `gestureEnabled: false`; predictive back disabled in manifest.
- **Bottom tab bar** (`AppNavigator`): **floats** and **auto-hides on scroll** (`ChromeVisibilityContext`, 200ms hide / 110ms show). Bg `rgba(10,10,15,0.90)`, hairline `rgba(124,58,237,0.25)` top border. Height iOS 84 / Android 64+insets+16. Icons **26px**; active `purpleLight` (`fill`) / inactive `textMuted` (`regular`). Labels 11/600 `+0.3`. Tabs: **Home · Search · Library · Profile**.
- **Profile sub-tabs** (`ProfileTabBar`): horizontal 999-radius pills; active = purple fill + glowM + white, inactive = bordered transparent.
- Stacking: see [§8.1](#81-as-built-stacking-order--shipped).

---

## §20 Layout Principles

— ✅ Shipped conventions, 🔵 go-forward rules

- **Gutters:** 16 content · 20 headers · 24 focused screens (see [§5.2](#52--spacing-scale--go-forward-rules)).
- **Whitespace:** 12–14 above/below headings; cards breathe on 14 internal + 14 inter-card.
- **Grid:** 2-col profile/library (16 outer, 12 gutter), computed once at module load (no rotation). Emoji pickers 10-col.
- **Alignment:** left-aligned content; centered modals/sheets/empty-states; chat bubbles hug sender edge (≤75%).
- **Content density:** medium-low — **one clear focal item per row**. Chrome recedes.
- **Safe areas:** always respect `insets`; tab bar, send bar, sheets, JamBanner add `insets.bottom`/`top`.
- **Responsive:** phones are primary. Layout is fluid (`%`, `flex`, screen-width math) — grid/card sizes derive from `Dimensions` at module load. 🔵 No tablet layout exists; on large screens content stretches full-width. If tablets are targeted, cap content width ~640 and center. Very small phones (<360dp) rely on `flexShrink`/`numberOfLines` truncation already present.

---

## §21 Motion

**Philosophy:** motion is **smooth, purposeful, responsive, and never distracting**. It
confirms state and guides the eye; it never performs. Springs for anything a finger touches, short timing curves for chrome.

### 21.1 As-built vocabulary — ✅ Shipped

| Motion | Type | Spec |
|---|---|---|
| Floating-player morph | Spring | bounciness 12, speed 10; collapse 220ms cubic-in |
| Full-screen open / close | Spring / Sequence | scale 0.02→1 b12 / 80ms+350ms quad |
| Play/pause glyph pop | Spring | scale 0.7→1, b12, speed 18 |
| Tab bar hide / show | Timing | 200 / 110ms, native driver |
| Chrome auto-hide | Shared value | one `Animated` value across tab bar + player |
| Keyboard player slide | Timing | 180 / 200ms |
| Progress poll | Interval | ~250ms (4Hz) |
| Wave visualizer | Interval | ~30Hz; 360ms amp easing |
| Jam live-dot pulse | Loop | opacity 0.2↔1, 650ms |
| Queue drag | Spring | scale→1.04, damping 15, zIndex 999 |

**Engine:** `react-native-reanimated 4.4.0` + `react-native-worklets`. Prefer native-driver/worklet.
**Never** animate layout in a way that remounts inputs (Android 15 Fabric keyboard trap).

### 21.2 🔵 Standardize + reduced-motion

- **Durations:** fast **120ms** (chrome show), base **200ms** (chrome hide, fades), slow **350ms** (screen transitions). One spring preset for touch: `bounciness 12, speed 12`.
- **Reduced motion:** 🔵 honor `AccessibilityInfo.isReduceMotionEnabled()` — swap springs/pulses for instant or short fades. Not implemented today; add before scale-up. The live-dot pulse and wave should quiet under reduce-motion.

---

## §22 Accessibility

🔵 Mostly aspirational today — this section is the target bar, not a claim of compliance.

- **Contrast:** the rules in [§3.4](#34-accessibility--contrast). Muted text only for large/non-essential; small accent text → `purpleLight`; received bubble → white.
- **Touch targets:** **≥ 44×44pt.** Small visuals (16–20px icons, seek thumb, close buttons) already extend reach with **`hitSlop` 6–8** in code — keep this on every sub-44 touchable.
- **Font scaling:** system font respects OS Dynamic Type by default. 🔵 Test headers with tight tracking at 130%+ scale; avoid fixed heights on text containers so they can grow.
- **Screen readers:** 🔵 audit for `accessibilityLabel` on icon-only buttons (play, like, send, overflow), `accessibilityRole="button"`, and state (`accessibilityState={{selected}}`) on tabs/toggles. Reaction counts and timestamps need readable labels.
- **Reduced motion:** see [§21.2](#212--standardize--reduced-motion).
- **Color is never the only signal:** liked = fill + color (not color alone); active tab = fill + color + label. Keep pairing shape/weight changes with color changes.
- **Hit-slop convention:** `hitSlop={{top:8,bottom:8,left:8,right:8}}` for icon buttons; `6` for tight chip rows.

---

## §23 Voice & Tone

🔵 Not previously documented; inferred from existing copy. Codified so new microcopy matches.

**Personality:** a friend who's into music — warm, low-key, confident, never corporate or shouty.

- **Wordmark:** always lowercase **"livil"**. Heavy weight, tight tracking.
- **Tagline:** _"Your music, your world."_ · Micro-tag: _"Live · Vibe · Link"_.
- **Casing:** sentence case for UI copy and buttons ("Add a comment…", "Create Account" is the one Title-Case CTA — 🔵 consider normalizing to "Create account"). Never ALL-CAPS except the 9–12px micro-labels ("VIDEO").
- **Buttons:** short verb-first — "Play", "Send", "Return", "Save". No "Click here".
- **Empty/end states:** friendly and encouraging, first-or-second person — the equalizer + a warm line beats a cold "No results."
- **Errors:** plain, blame-free, actionable — "Couldn't load your feed. Tap to retry." Not "Error 500."
- **Placeholders:** conversational with an ellipsis — "Message…", "Add a comment…".
- **Emoji:** allowed in _copy_ (🎵, 🎉, 👑) as accent, never as a UI control (that's `Icon`'s job). One emoji max per string.
- **Numbers:** abbreviate large counts (1.2k) and keep them `tabular-nums`.

---

## §24 Phone Mockups

🔵 **LiViL standard: floating 3D angled device.** (No mockup tooling in the repo — this
defines the house style for all screenshot presentation.)

| Attribute | Spec |
|---|---|
| **Device** | Modern bezel-less phone, dark/graphite frame (never white — it fights the dark UI). |
| **Angle** | ~15–20° Y-axis rotation, ~2–4° Z-tilt for life. |
| **Perspective** | Subtle 3D (vanishing point off-frame); no fisheye. |
| **Shadow** | Soft **purple glow** (`#7C3AED` @ ~30%, blur ~60–80px) pooled behind & below — the device emits the app's light. |
| **Layering** | Device floats above the bg with a clear gap; optional second phone (angled, behind, ~60% opacity/blurred) for depth. |
| **Background** | Obsidian→purple gradient (`#0A0A0F → #1A1A2E → #3B1E6E`) or flat `#0A0A0F` with one off-center radial purple glow. |
| **Screen content** | Real screens — **feed**, **full-screen player**, or **Jam Room** are the heroes. Clean dark status bar. |
| **Motion (video/web)** | Gentle vertical bob (±8px, ~3s ease-in-out). |

**Approved alternates:** _flat straight-on_ (App Store listing, max legibility) and _duo
overlap_ (feed + player, for carousels/hero). Both keep the purple glow.

---

## §25 Marketing Assets

All share the **obsidian + purple-glow + floating-angled-device** language.

| Channel | Format & treatment |
|---|---|
| **Instagram (post)** | 1080×1350 (4:5). Angled device on obsidian→purple gradient; wordmark top-left; one-line hook in `textSecondary`; purple glow behind device. |
| **Instagram (story/reel)** | 1080×1920. Full-bleed dark, device bobbing, tagline bottom third. |
| **Twitter / X** | 1600×900. Duo-overlap phones (feed + player), left-weighted, copy right. Keep it dark. |
| **LinkedIn** | 1200×627. Restrained: single flat-ish device, one feature/metric callout, subtle accents. |
| **Portfolio / case study** | Large hero (angled floating device, strong glow on `#0A0A0F`) + a flat-lay grid of individual screens, each in a 20-radius frame. |
| **Landing page** | Hero = angled floating device (Royal-gradient glow) + wordmark + purple CTA (glowXl). Feature sections alternate device angle L/R on `#0A0A0F`. |

**Brand constants (every asset):**
- Background **always dark** (`#0A0A0F`). Never LiViL UI on white.
- Accent **always** `#7C3AED` (glow) / `#A78BFA` (highlight).
- Wordmark lowercase **"livil"**, weight 800, tracking −0.5 to −3 at display size.
- Tagline **"Your music, your world."** · micro-tag **"Live · Vibe · Link"**.
- Real screenshots, real cover art/gradients — never grey placeholder boxes.

---

## §26 Do's & Don'ts

### Do's ✅
- Import `COLORS`; use `Icon`; use `FormInput` — always.
- Give purple CTAs a purple **glow** shadow; build depth by **lightening the surface**.
- Keep type heavy & tight (700–900, negative tracking on headers).
- Use pills (999) for chips/toggles/tags; `tabular-nums` on changing numbers.
- Declare a **pressed** state on every touchable (0.85 filled / 0.7 ghost).
- Give every list a **skeleton + empty + error** state.
- Respect safe-area insets; keep touch targets ≥44pt (pad with `hitSlop`).
- Use the purple+pink **blob-duo** when cover art is missing; the **equalizer** motif for empty/end.
- Confirm with `ConfirmActionModal`; report with `useToast`.

### Don'ts ❌
- **No light mode.** No white/light backgrounds — in-app or marketing UI shots.
- **Never `Alert.alert`.**
- Never hard-code a hex that already has a `COLORS` token; never invent a 4th red.
- Never nest `<Icon>` inside `<Text>`; never use an emoji/glyph as a UI control.
- Never lift `TextInput` focus state to a parent (Fabric keyboard trap).
- Never add `react-native-linear-gradient` (use `react-native-svg`).
- Don't shadow feed cards; don't gradient-ify chrome (tabs/cards/inputs).
- Don't use `purple` for small body text (use `purpleLight`), or `textMuted` for must-read text.
- Don't invent ad-hoc `zIndex` — use the layering scale.
- Don't add a custom `fontFamily` to body UI.

---

## §27 Governance & Changelog

**Owner:** Design, jointly with whoever last edited `src/theme/`. **Cadence:** review on
every PR that touches `src/theme/`, `src/components/`, or adds a screen.

### Update protocol
1. Change a **color** → edit `colors.ts` **and** [§3](#3-color-system) in the same PR.
2. Introduce a **new component pattern** → add it to [§12](#12-components) (+ anatomy in [§13](#13-component-anatomy) if it's a hero surface).
3. Resolve an **⚠️ Inconsistency** → move it from [Appendix A](#appendix-a-known-inconsistencies) into the shipped tables and delete the ⚠️ tag.
4. Bump the **version** (top of file) and add a changelog row below.
5. When you adopt a 🔵 recommendation into code, **retag it ✅** and update the reference.

### Changelog
| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-05 | Initial system: extracted as-built colors/type/radius/shadow/components from the codebase. |
| 1.1 | 2026-07-05 | Added Quick Reference, status legend + go-forward defaults, Interaction States, Z-index scale, Empty/Loading/Error doctrine, Accessibility, Voice & Tone, component anatomy, governance + changelog. Merged glowS/glowM. |

---

## Appendix A: Known Inconsistencies

⚠️ Real drifts found in the audit. **Reconcile — don't copy.** Each has a go-forward default above.

1. **Untokenized brand colors** — `#EC4899 · #FF4D6D · #00BFFF · #00C853 · #22C55E · #FF4444 · #E53935` recur as literals → promote to `COLORS` ([§3.3](#33-colors-used-in-code-but-not-yet-tokenized----inconsistency---recommendation)).
2. **Four reds** — collapse to `error` / `like` / `live` ([§3.3](#33-colors-used-in-code-but-not-yet-tokenized----inconsistency---recommendation)).
3. **Radius drift** — card 20 / skeleton 18; cover 18 / grid 14; input 13 / button 14 / modal-btn 12 → [§6.2](#62--unified-scale--go-forward-defaults).
4. **Spacing outliers** — 7, 9, 15, 18, 22 break the grid → snap to `SPACING` ([§5.2](#52--spacing-scale--go-forward-rules)).
5. **Header weight mixing** — 700/800/900 boundary arbitrary → [§4.2](#42-type-ramp--shipped-consolidated).
6. **Received chat contrast** — `textSecondary` on `surface` borderline AA → white ([§3.4](#34-accessibility--contrast)).
7. **Unread badge color split** — DM purple vs jam red → resolved rule in [§12.6](#126-chips-badges-avatars--shipped).
8. **No central token files** — only `colors.ts` exists → add the files in [Appendix B](#appendix-b-recommended-token-files).
9. **`glowS`≈`glowM`** — perceptually identical presets → merged to one `glowM` ([§7.1](#71-the-shadow-ladder--shipped)).

## Appendix B: Recommended Token Files

🔵 A single `src/theme/tokens.ts` (or split) to end per-component re-derivation.

```ts
// src/theme/tokens.ts   [RECOMMENDATION — not yet in repo]
import { COLORS } from './colors';

export const SPACING = { xxs:2, xs:4, sm:6, md:8, lg:12, xl:16, xxl:20, xxxl:24, huge:32 } as const;

export const RADIUS = {
  xs:4, sm:8, md:12, lg:18, xl:20, xxl:24, pill:999,
  round: (s: number) => s / 2,
} as const;

export const TYPE = {
  display: { fontSize:34, fontWeight:'800', letterSpacing:-0.5 },
  h1:      { fontSize:22, fontWeight:'900', letterSpacing:-0.4 },
  h2:      { fontSize:17, fontWeight:'800', letterSpacing:-0.2 },
  title:   { fontSize:15, fontWeight:'800', letterSpacing:-0.2 },
  body:    { fontSize:15, fontWeight:'400', lineHeight:21 },
  bodySm:  { fontSize:14, fontWeight:'400', lineHeight:20 },
  label:   { fontSize:13, fontWeight:'700' },
  meta:    { fontSize:12, fontWeight:'400' },
  caption: { fontSize:11, fontWeight:'600', letterSpacing:0.2 },
} as const;

export const SHADOW = {
  glowXl: { shadowColor:COLORS.purple, shadowOffset:{width:0,height:8}, shadowOpacity:0.45, shadowRadius:18, elevation:8 },
  glowL:  { shadowColor:COLORS.purple, shadowOffset:{width:0,height:4}, shadowOpacity:0.5,  shadowRadius:10, elevation:6 },
  glowM:  { shadowColor:COLORS.purple, shadowOffset:{width:0,height:2}, shadowOpacity:0.4,  shadowRadius:6,  elevation:4 },
  lift:   { shadowColor:'#000',        shadowOffset:{width:0,height:4}, shadowOpacity:0.3,  shadowRadius:8,  elevation:8 },
} as const;

export const Z = { base:0, sticky:10, chrome:20, overlayScrim:100, overlayContent:110, banner:9999, splash:10000 } as const;

// Fold into COLORS:
export const BRAND = { pink:'#EC4899', like:'#FF4D6D', blue:'#00BFFF', success:'#00C853', online:'#22C55E', live:'#FF4444' } as const;

export const GRADIENTS = {
  brand:['#7C3AED','#A78BFA'], hero:['#0A0A0F','#1A1A2E','#3B1E6E'],
  energetic:['#EC4899','#7C3AED'], sunset:['#F59E0B','#FF4D6D'],
} as const;
```

## Appendix C: Source-of-Truth Map

When you touch the left, re-check the right.

| Source file | Governs doc section |
|---|---|
| `src/theme/colors.ts` | [§3](#3-color-system), [§0](#0-quick-reference) |
| `src/components/Icon.tsx` | [§11](#11-icons) |
| `src/components/FormInput.tsx` | [§12.2](#122-inputs--forminput--shipped), [§10](#10-interaction-states) |
| `src/components/PostCard.tsx` | [§13.1](#131-post-card--postcardtsx), [§16](#16-feed-ui) |
| `src/components/FloatingPlayer.tsx` · `FullScreenPlayer.tsx` · `SeekBar.tsx` | [§13.2](#132-floating-player--floatingplayertsx), [§15](#15-player-ui) |
| `src/screens/main/HomeScreen.tsx` | [§16](#16-feed-ui) |
| `src/screens/main/ConversationScreen.tsx` · `InboxScreen.tsx` | [§17](#17-chat-screens) |
| `src/screens/main/JamRoomScreen.tsx` · `JamBanner.tsx` | [§18](#18-jam-rooms) |
| `src/navigation/*` | [§8](#8-z-index--layering), [§19](#19-navigation--bottom-tabs) |
| `src/components/PlaylistCoverPicker.tsx` · `EmojiCoverArt.tsx` | [§9](#9-gradients) |
| `src/components/ConfirmActionModal.tsx` · `*Sheet.tsx` · `contexts/ToastContext.tsx` | [§12.4](#124-modals--shipped)–[§12.5](#125-bottom-sheets--shipped), [§14](#14-empty-loading--error-states) |

---

_Sections tagged **✅ Shipped** are law (code proves them). **🔵 Recommendation** and
**⚠️ Inconsistency** are the roadmap. Keep them tagged honestly — the day everything is ✅
is the day LiViL's design system is fully realized in code._
