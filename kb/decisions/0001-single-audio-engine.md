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

# ADR-0001 — One audio engine owns the media session

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | ~2026-06 (backfilled 2026-07-21 from code and commit history) |
| **Domain** | playback |
| **Decided by** | Human, during the lock-screen media controls work |

---

## Context

Livil plays two kinds of post — audio tracks and videos — and both must play through the lock
screen, notification shade, and car controls.

The natural implementation gave each its own player: an audio component for audio posts, and
the full-screen video component for video posts. Both needed OS media controls, so both
declared `showNotificationControls`.

This worked for a single post and failed the moment a queue mixed the two. Every audio↔video
boundary tore down one media session and created another. The operating system does not model
that as continuation; it models it as two apps playing media.

The observable failure: **a swipeable carousel of duplicate media notifications**, and
`onNextTrack` events dropped during the churn — so the lock-screen skip button intermittently
did nothing.

## Decision

**Exactly one component is the audio source for every post, and the only owner of the media
session.**

`GlobalAudioPlayer` plays `audioUrl ?? videoUrl`. For a video post it decodes the video file
for its audio track on a hidden 0×0 surface.

Every other player-like surface is a follower. `FullScreenPlayer` renders a **muted** video
frame that chases the engine's position for pictures only. The floating player and post cards
read shared refs and render controls. **None of them produce audio, and none declare
notification controls.**

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Two engines with careful handoff | This was the failing design. There is no correct handoff — the OS sees session teardown regardless of how carefully it is sequenced |
| One engine per media kind, session owned by whichever is active | Same problem: ownership transfer *is* the teardown |
| `react-native-track-player` | See [ADR-0002](0002-patched-video-library.md) |
| Native audio service of our own | Enormous scope; would have to reimplement buffering, formats, and streaming |

## Consequences

**Good:** exactly one media session, always — there is no state in which one is being handed
over, because it is never handed over. Lock-screen, Bluetooth, and car controls behave
consistently. Queue advance across mixed media is seamless.

**Costs:**

- A video post **decodes twice** while full-screen is open — once by the engine for audio, once
  by the muted frame for pictures. Wasteful, and accepted deliberately.
- The muted frame must **chase** the engine's position, requiring drift correction and an eager
  seek on paused scrubs. This is a real source of complexity.
- Any new playback surface must be designed as a follower. **This constrains every future
  feature in this area.**
- The full-screen player must never set `disableAudioSessionManagement` — on iOS that flag is a
  process-wide singleton and would silence the engine.

## Dissent

*None recorded.* The failure was reproducible and the fix removed it entirely; there was no
serious argument for keeping two engines.

## Revisit when

The platform gains a way to transfer media session ownership without teardown, or if we move
off the current playback library entirely — in which case this ADR's *reasoning* survives even
if its implementation does not.

**Do not revisit merely because the double decode looks wasteful.** That cost is known and was
accepted; the notification carousel is what the alternative buys.
