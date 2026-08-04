---
tier: 4
owner: chief-architect
consumers: [CA, TR, ALL]
last_verified: 2026-08-04
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [15]
---

# PROP-0009 — Give mobile the same cover-art cropping the web dashboard has

| | |
|---|---|
| **Status** | **Draft** |
| **Date** | 2026-08-04 |
| **Domain** | client |
| **Addresses** | ADR-0015 |
| **Jira** | *(added on ratification)* |

---

## Problem

Cover art is **stored at whatever aspect ratio the artist picked, and displayed square**.

- `src/screens/main/UploadScreen.tsx:173` picks the cover with `pick({ type: [slot.accept] })`
  — a plain document picker. There is no crop step and no dimension constraint. (The
  512×512 crop in `src/services/profileService.ts:15` is the *avatar* flow, not this one.)
- `src/components/PostCard.tsx` renders it at `aspectRatio: 1` with `resizeMode="cover"`
  (styles at :1027, :1039, :1045).

So a 16:9 cover uploaded from the phone is **centre-cropped at display time**, and the
artist never sees that happen or gets a say in it. Whatever is at the centre survives;
anything at the edges — often the title text on designed artwork — is silently discarded.

The web dashboard now crops at upload (ADR-0015), offering fill-the-square or
fit-the-whole-image-with-padding. Mobile has neither, so the same artwork uploaded from the
two clients produces different stored images and different results on the card.

## Why now

Cheap and self-contained, and the gap only just opened. Before ADR-0015 both clients behaved
identically (no crop); now they diverge, and divergence between two clients writing one
database is the failure mode that repository layout decision was made to avoid.

It is also the kind of defect that is invisible until an artist complains, because nothing
errors — the picture is simply wrong.

## Proposal

Add a crop step to the mobile cover/thumbnail picker so the artist chooses the square, with
the same two options the web offers: fill, or fit with padding.

`react-native-image-crop-picker` is **already a dependency** (`^0.51.1`) and already used for
avatars, so this needs no new package and no native rebuild.

## Implementation plan

1. Extract the avatar picker's crop options in `profileService.ts` into a shared helper
   parameterised by output size, so the avatar and cover paths cannot drift.
2. Route the cover and thumbnail slots in `UploadScreen.tsx` through the cropper at 1024×1024
   (matching the web output), `cropping: true`, `compressImageQuality: 0.9`.
3. Offer the fit-with-padding option, or record explicitly that mobile is fill-only and why.
4. Confirm the crop applies to the `thumbnail` slot for video posts, not only `cover`.

## Scope boundaries

Does **not** include:

- Changing how existing covers render. `PostCard`'s `aspectRatio: 1` stays. Making the feed
  show true aspect ratios is a product decision about the look of the feed, not part of this.
- Re-cropping or migrating covers already uploaded.
- Album or playlist artwork, which have their own pickers.
- Any change to the web dashboard.

## Risk

Low, and confined to one screen. `react-native-image-crop-picker` is already shipping in the
avatar flow, so the native surface is exercised.

The realistic bad outcome is the cropper failing to open on some device and blocking upload
entirely. It must fall back to the uncropped file — the current behaviour — rather than
refusing, exactly as the web cropper does when canvas export fails.

Note that `src/screens/**` is agent-writable only on a maintainer-authorised basis ahead of
tests (`.claude/autonomy-config.yml`), and `UploadScreen.tsx` has no tests.

## Verification

- Upload a deliberately wide (16:9) cover from the phone; confirm the stored object is
  square and matches the chosen region, not a centre crop.
- Upload the same file from the web dashboard; confirm both produce the same framing.
- Cancel the cropper mid-flow; confirm the upload still completes with the original file.
- Repeat for a video post's thumbnail slot.

## Alternatives

| Alternative | Why set aside |
|---|---|
| **Render true aspect ratio in the feed instead** | Removes the need to crop anywhere, but changes the look of every card and the grid alignment on profiles. A product decision, and a much larger blast radius than a picker option. |
| **Crop server-side on upload** | There is no API tier (ADR-0004), and Supabase edge has a 2 s CPU cap with no image tooling — the same wall ADR-0003 hit for audio decode. |
| **Leave mobile as-is** | Viable, and the honest fallback if the divergence is judged acceptable. It leaves two clients producing different artwork from the same file, which is worth stating out loud rather than drifting into. |

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
