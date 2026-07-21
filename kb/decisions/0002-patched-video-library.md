---
tier: 4
owner: principal-playback
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# ADR-0002 — Patch the video library rather than adopt a track player

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | ~2026-06 (backfilled 2026-07-21) |
| **Domain** | playback |
| **Decided by** | Human |

---

## Context

Livil needed behaviour the media library does not provide:

1. **Clip-relative lock screen.** A post can play a window of a track. The lock screen should
   present that window as a self-contained song — while the app keeps absolute time so the clip
   editor can scrub the whole track.
2. **Native track skipping.** The library holds one media item per instance, so next/previous
   from the notification, Bluetooth, or a car head unit was a silent no-op.
3. **Background auto-advance.** The New Architecture defers view commands and prop changes while
   backgrounded, so JavaScript cannot advance a queue or loop a clip with the screen locked —
   exactly when a music app needs it most.

None of this is achievable from JavaScript. The choice was: change the library, or change
libraries.

## Decision

**Patch the video library in place**, pinned to an exact version, with the patch committed and
applied on install.

The patch is **1,373 lines across 16 files** (Kotlin, Java, Swift, TypeScript). It adds a
forwarding player that presents clip-relative time to the media session only, track-skip
overrides, local repeat/shuffle state, three codegen props, four events, and a native clip-end
watcher.

Every hunk is prefixed with a comment explaining why it exists.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **`react-native-track-player` v4** | **Launch-crashes** on this React Native version with the New Architecture. Not a bug we could work around from outside |
| **`react-native-track-player` v5** (paid) | Introduces audio/video sync risk for video posts — and video is half the content model, so that risk is not marginal |
| Fork the library | Same maintenance burden as a patch, plus publishing and dependency management. A patch is a fork with less ceremony |
| Contribute upstream | Livil-specific behaviour (clip windows) is unlikely to be accepted, and we would still need it before any release lands |
| Native module of our own | Reimplementing buffering, format support, and streaming is out of proportion to the problem |
| Accept the limitations | Lock-screen controls that half-work are worse than none, and clipped reposts are a core product feature |

## Consequences

**Good:** all three behaviours work. Bluetooth and car controls function. The clip model is
possible at all.

**Costs — these are significant and should not be understated:**

- **This is the largest upgrade obstacle in the project.** A library upgrade means re-deriving
  1,373 lines of diff across four languages.
- **Native changes require a full rebuild.** A Metro reload silently keeps the old native code —
  a build that appears to work and is wrong.
- **The prop seam is fragile.** New native props must be mirrored in three type locations; a
  missed mirror silently drops the prop.
- **The version is pinned exactly.** A caret here would be a landmine.
- Security patches in the upstream library are not automatic.

The per-hunk comments are the mitigation. They make the patch re-derivable rather than
archaeological, and they are the reason this is maintainable at all.

## Dissent

*None recorded at the time.* Recorded now for the future reader: **the maintenance cost is real
and compounding**, and a future decision to move to a maintained track player — once one works
on this stack — would be defensible. This ADR should not be read as "patching is better," only
as "patching was better than the options available in mid-2026."

## Revisit when

- A track player library supports this React Native version with the New Architecture **and**
  handles video without sync risk — verify by building, not by reading release notes
- The upstream library adds clip presentation or native queue support
- A security advisory affects the pinned version
- The patch fails to apply after a dependency change

**Do not revisit** because the patch merely looks large. Size is the cost that was accepted;
the alternatives were a crash or a broken feature.
