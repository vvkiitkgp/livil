---
tier: 3
owner: principal-playback
consumers: [P-PB, P-PF, CR, QA, FE]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Playback Architecture

The most expensive knowledge in this codebase. Every rule below is a receipt for a bug we
already paid for (Constitution P2). Before changing anything here, read the do-not-break
table at the end and make sure you can state the case *for* the rule you want to change
better than its defenders can (P54).

---

## The invariant: one engine

**`GlobalAudioPlayer` is the only audio source in the application, and the only owner of the
operating system's media session.** It is the sole `<Video>` in the tree with
`showNotificationControls` — verified: exactly one occurrence exists in `src/`.

It plays the audio of **every** post, regardless of media kind:

```
source = nowPlaying.audioUrl ?? nowPlaying.videoUrl
```

For a video post, the engine decodes the video file for its audio track on a hidden 0×0
surface. The frames are never shown from there.

### Why

The earlier design had two engines — one for audio posts, one for video — each owning a media
session. Every audio↔video boundary in the queue tore down one session and built another.
The operating system rendered that as a **swipeable carousel of duplicate media
notifications**, and `onNextTrack` events were dropped in the churn.

One engine means exactly one media session, always. There is no state in which the session is
being handed over, because it is never handed over.

### The rule

**Never add a second `<Video>` with `showNotificationControls`, and never introduce a second
audio source.** This includes well-intentioned additions like a preview player that "just
plays a few seconds."

---

## Player surfaces

Everything else that looks like a player is a follower. Surfaces read position from shared
refs; they never produce audio.

| Surface | What it is | Audio? |
|---|---|---|
| **`GlobalAudioPlayer`** | The engine. Media session owner, play tracking, queue advance, error recovery. | **yes — the only one** |
| **`FullScreenPlayer`** | A **muted** video frame for video posts. Foreground-only. Chases the engine's position. | no — muted, `volume={0}` |
| **`FloatingPlayer`** | The persistent pill/circle control and waveform. | no |
| **`PostCard`** | Cover art and a play button. Sets `nowPlaying`; requests playback. | no |

`FullScreenPlayer` decodes the *same file* the engine is decoding, purely for pictures. It
drift-corrects toward `positionRef` and takes an eager seek on paused scrubs. It carries
`playInBackground={false}` and no notification controls.

**`FullScreenPlayer` must never set `disableAudioSessionManagement`.** On iOS that flag is a
process-wide singleton; setting it would stop the engine claiming the `.playback` category,
and audio would be silenced by the ring switch and die in the background.

---

## The coordinate model: one truth, translated at the boundary

**Inside the app, time is always absolute full-track seconds.** `positionRef`, `durationRef`,
and `clipWindowRef` all speak absolute time.

**The lock screen is clip-relative.** A post can play a clipped window of a track, and the OS
should show the clip as though it were the whole song — position `absolute − clipStart`,
duration `clipEnd − clipStart`, and a scrubber seek of `p` meaning `clipStart + p`.

That translation happens in exactly one place: a `ForwardingPlayer` wrapper in the native
patch, applied only to what the media session sees. JavaScript never sees clip-relative time.

### The player always loads the full track

**Never use `ClippingConfiguration`, `cropStart`, or `cropEnd`.** Hard-clipping the media
breaks the clip-editing slider (which must scrub the whole track) and desynchronises
JavaScript's absolute view from native's relative one. Clipping is presentation, not loading.

This is Constitution P3 in concrete form: one authoritative representation, converted at the
edge. Two internal representations of time would drift, and the drift would surface as a bug
that reproduces only on someone else's device.

---

## Why parts of this live in native code

**The New Architecture (Fabric) defers view commands and prop changes while the app is
backgrounded.** `videoRef.seek()` does not land. A changed `source` prop does not apply. This
is not a bug we can work around in JavaScript — it is how the renderer schedules work.

The consequence: **JavaScript cannot advance the queue or loop a clip while the app is
backgrounded or the screen is locked** — which is exactly when a music app most needs to.

So those behaviours are native, in the patched playback service:

- **Clip-end watcher** — polls position; on reaching `clipEnd`, loops (repeat-one) or skips
- **Natural-end listener** — on `STATE_ENDED`, the same
- **`mediaQueueJson` + native skip** — notification next/previous loads the target track
  natively, bypassing prop deferral
- An `alreadyLoaded` URI guard suppresses the redundant reload when the deferred source prop
  finally lands on foreground

**JavaScript clip-end handling and `handleEnd` are gated to iOS only. Do not re-enable them on
Android — you will double-advance.**

Advance always routes through `onVideoNextTrack → playNext` so the JavaScript queue index
stays in lock-step with what native did.

---

## The patch

`patches/react-native-video+6.19.2.patch` — **1,373 lines across 16 files** (Kotlin, Java,
Swift, TypeScript). Pinned to exact `6.19.2`; the `^` is deliberately absent.

It adds: the clip-forwarding player, track-skip overrides (upstream holds one media item per
instance, so native next/previous was a silent no-op — this is what made Bluetooth and car
controls work), local repeat/shuffle state, three codegen props, four events, and the
background auto-advance machinery.

### Working on the patch

- After **any** edit under `node_modules/react-native-video/`, re-capture:
  `npx patch-package react-native-video --include '^(ios/|android/src/|src/|lib/)'`
- **A Metro reload does not pick up native changes.** Full `./gradlew` rebuild, every time.
- New native props must be mirrored in `src/specs/VideoNativeComponent.ts`, `src/types/video.ts`,
  **and** `lib/types/video.d.ts`. A missed mirror **silently drops the prop** — no error, the
  feature just does nothing.

Upgrading the underlying library means re-deriving all of it. That is the single largest
upgrade obstacle in the project, and it is a deliberate trade: `react-native-track-player` was
ruled out (V4 launch-crashes on this RN version with the New Architecture; paid V5 adds A/V
sync risk for video).

---

## Do not break

| Trap | Rule | Why |
|---|---|---|
| Second media session | Only the engine sets `showNotificationControls` | Duplicate notification carousel; dropped skip events |
| Notification id | Post/cancel with the **raw** player's `hashCode`, not the forwarding wrapper's | The wrapper changes the hash → a duplicate, uncancellable notification |
| Hard-clipping | Never `ClippingConfiguration`/`cropStart` | Breaks the editing slider; desyncs absolute vs relative |
| Background advance in JS | Native only; JS is foreground/iOS | Fabric defers commands while backgrounded |
| Live clip edit not updating | Nudge an in-place seek **only when the window actually changed** | The OS republishes playback state only on a player event |
| `disableAudioSessionManagement` on a follower | Never | iOS process-wide singleton; would silence the engine |
| Swipe-dismiss on Android 15 | Not our bug | Intentional OS behaviour; `setOngoing(isPlaying)` pins it while playing |

---

## Status and known gaps

- **iOS clip parity is not implemented.** The clip-relative timeline and native auto-advance
  are Android-only; iOS clip-end remains JavaScript-driven. Finishing it means mirroring the
  offset in the iOS now-playing manager and the existing time observer.
- **Accepted limitations:** repeat-all wrap-around at the very end of the queue while
  backgrounded, and the very first track before its queue JSON arrives, both fall back to
  JavaScript and therefore to foreground only.
- **There are no automated tests over any of this**, including the coordinate translation and
  the JavaScript↔native prop seam that this document describes as easy to silently break.
  That gap is the highest-value target in the testing roadmap (P30).

## Related

- [media-pipeline.md](media-pipeline.md) — where the media comes from
- [client.md](client.md) — the state model the surfaces read from
- [inventory.md](inventory.md) — current file sizes
