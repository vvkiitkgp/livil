---
tier: 2
owner: principal-client
consumers: [FE, RF, CR, P-CL]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Design System

Dark theme only. No light mode, and none is planned — the product's visual identity depends on
it.

---

## Tokens

`src/theme/colors.ts` is the single source of truth. **Import `COLORS`; never write a colour
literal.**

| Token | Value | Use |
|---|---|---|
| `bg` | `#0A0A0F` | App background |
| `surface` | `#12121C` | Raised surfaces |
| `card` | `#1A1A2E` | Cards |
| `inputBg` | `#1C1C30` | Inputs |
| **`purple`** | **`#8B3DFF`** | **Primary accent** — CTAs, play button, active states, links, sent bubbles |
| `purpleNeon` | `#A855F7` | Glows, highlights |
| `purpleRoyal` | `#6D28D9` | Gradient midpoint |
| `purpleDeep` / `purpleDeepest` | `#4C1D95` / `#3A1180` | Gradient floor |
| `purpleLight` | `#C9B6FF` | Accent text on dark |
| `purpleDim` / `purpleGlow` | `rgba(139,61,255,0.15)` / `0.3` | Tints, shadows |
| `white` | `#FFFFFF` | Primary text |
| `textSecondary` / `textMuted` | `#8B90A7` / `#4B5268` | Secondary text |
| `border` | `#252545` | Dividers |
| `error` / `warning` / `info` | `#EF4444` / `#F59E0B` / `#22D3EE` | Status, each with `Bg` and `Border` variants |

Signature gradients: hero `purpleRoyal → purpleNeon`; deep background `bg → purpleDeep → purple`.

Purple CTAs carry a glow shadow (`shadowColor: COLORS.purple`), and inputs animate a purple
border on focus.

---

## ⚠️ Token discipline is the weakest standard here

Measured today:

| | Count |
|---|---:|
| Tokens defined | 25 |
| **Hex literals outside the theme** | **161** |
| **`rgb()` / `rgba()` literals** | **104** |

The most-repeated literal is **`#8B3DFF`, 27 times — which is exactly `COLORS.purple`.** Those
27 are pure duplication of a token that already exists.

Beyond duplication, several colours are in circulation that **have no token at all**:

| Literal | Count | Status |
|---|---:|---|
| `#EC4899` | 17 | Pink — no token |
| `#FF4D6D` | 11 | A **second red** — no token |
| `#3B1E6E` | 11 | Deep purple — no token |
| `#3B82F6` | 10 | Blue — no token |
| `#F59E0B` · `#22D3EE` · `#EF4444` | 15 · 14 · 11 | Duplicates of `warning` / `info` / `error` |

**The problem is not tidiness. It is that a palette exists which nobody decided on.** Multiple
unnamed reds mean "error" renders differently depending on which file you are in.

### What to do

1. **Replace duplicates with their token** — mechanical, no design decision needed
2. **Promote or eliminate the unnamed colours** — a design decision, one ADR
3. Then add the lint rule, so it cannot regress

Doing (3) before (1) and (2) would fail the build everywhere and get disabled.

**Legitimate exception:** a user-facing colour-swatch picker genuinely needs literal values —
those are data, not styling.

---

## What the theme does not have

**There are no non-colour tokens.** No spacing scale, no typography scale, no radius scale, no
shadow scale, no z-index scale.

Every `padding: 16`, `borderRadius: 12`, and `fontSize: 13` is a bare literal, across more than
a hundred style blocks. There is no way to answer "what is our standard card padding?" except
by grepping and taking a vote.

This is a real gap and is worth closing **before** the colour cleanup, because it is additive
(no existing code breaks) whereas the colour work is a migration.

Suggested shape, to be decided by ADR rather than by whoever writes it first:

```
spacing:  xs 4 · sm 8 · md 16 · lg 24 · xl 32
radius:   sm 8 · md 12 · lg 20 · pill 999
```

---

## Iconography

**`src/components/Icon.tsx` is the only icon surface.** Backed by Phosphor, plus one Lucide
icon for a shape Phosphor lacks. Both are pure-JS SVG riding the existing SVG library — **adding
an icon needs no native rebuild.**

```tsx
<Icon name={IconName} size={20} color={COLORS.white} weight="regular" />
```

To add an icon, map a **Livil-semantic name** in the registry — `name="repost"`, not
`name="arrows-clockwise"`. The semantic layer is the point: it means an icon can be swapped
without touching call sites.

**Never nest `<Icon>` inside `<Text>`.** It is an SVG. Wrap it in a `View` row.

---

## Components before custom styling

Reach for the existing component before writing new styles:

| Need | Component |
|---|---|
| Text input | `FormInput` |
| Confirmation or destructive decision | `ConfirmActionModal` |
| Error, success, status | `useToast()` |
| Album or playlist detail screen | `DetailView` with `kind` |
| Loading state | The existing skeleton components |
| Progressive image load | `ProgressiveImage` |
| Gradient border or glow | `GradientBorder` |

`DetailView` is the model to copy: one component, a `kind` prop, two screens under 260 lines
each. The two profile screens are the standing counter-example.

---

## Enforcement status

| Rule | Enforcement |
|---|---|
| Import `COLORS`, no hex literals | `ADVISORY` — lint rule planned; would fail on 161 sites today |
| Use `Icon` for icons | `ADVISORY` |
| No `<Icon>` inside `<Text>` | `ADVISORY` |
| Dark theme only | `ADVISORY` — structural; no light-mode code exists |
| Spacing / typography scales | **Not defined** |

Current counts are regenerated into [../architecture/inventory.md](../architecture/inventory.md).

## Related

- [coding.md](coding.md) · [../architecture/client.md](../architecture/client.md)
