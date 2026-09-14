---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-25
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0001, 0002, 0009]
---

# ADR-0013 — Story playback is a declared JS-owned clip session over the single engine

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-07-25 |
| **Domain** | playback (with client) |
| **Decided by** | human owner, ratifying a principal-playback assessment (proposal-only) |

---

## Context

Stories reuse the single `GlobalAudioPlayer` (GAP) engine per ADR-0001. ADR-0009 Decision 4 examined the story viewer's second (muted, picture-only) `<Video>` and correctly concluded it is **not** a single-engine violation — no second `showNotificationControls`, one audio source. That decision was right about the *invariant*.

It under-weighted a second cost. GAP is built for **queue playback with OS lock-screen ownership**: advance authority lives in native code (the patch's clip-end watcher + `naturalEndListener`, because Fabric defers `seek()`/prop changes while backgrounded — ADR-0002), and presentation authority lives in a persistent MediaSession. The story workload is the opposite: **foreground-only, ephemeral, ≤10s clips, rapid tap-through, JS-driven advance, no queue, and no genuine need for a MediaSession.**

The story viewer bridged that gap by reaching into GAP's shared refs and *neutralizing each of its assumptions one lever at a time* — snapshot/restore of the whole engine, force repeat/shuffle off, override the queue to one item, and (added reactively across five commits) a `playNext` guard, a `startPosition`, a same-source progress-start, a stale-position band guard, and a presentation-nonce latch. Every neutralization is a seam where two advance authorities can disagree. The **same-track case** (two clips of one song) tripped all of them at once: the native watcher still held the previous clip's end, and the forward seek to the new clip's start fired `onNextTrack → playNext`, deactivating the one-item queue and cutting the clip to <1s.

The five fixes were not five bugs. They were **one architectural mismatch — advance/presentation authority in the wrong layer — surfacing in three places** (native-owns-advance, one-persistent-session, load-once-keep-source). A principal-playback assessment framed this and the human asked to correct the architecture rather than keep patching.

**Facts established (verified by reading code + the patch, not by running):**
1. ADR-0001's real invariant is two-part: (i) exactly one component owns the MediaSession / `showNotificationControls`; (ii) exactly one component produces audio at a time. INC-0001 (the "carousel") is caused by *two sessions churning* — it is about session ownership and audio-source count, **not** code paths or queues.
2. A story needs **no MediaSession** — lock-screen transport for a 10s clip is meaningless, and today a story actively evicts the user's real music from the lock screen (unfixed; see Consequences).
3. The reason to route story *audio* through GAP is invariant part (ii) — one audio source — which is sound. But GAP's **queue + native-advance machinery is separable from its audio source.** Separating them is the fix.
4. `buildCurrentClipJson(null, …)` yields `active:false`; the patch's `checkClipEnd` early-returns on `!currentClipActive`. So sending an inactive clip **disarms the native watcher at the source.**

## Decision

**Model story playback as a first-class, declared `clipSession` over the single engine — not as an ad-hoc override of it.**

- `PlaybackContext` gains `enterClipSession(prevNowPlaying) → sourceUrl` and `exitClipSession()`. Enter snapshots the engine (the user's music), pauses it, forces repeat/shuffle off, sets `clipSessionRef`, and raises the reactive `isStoryViewerOpen` signal. Exit restores track/position/queue/repeat/shuffle. This **replaces** the story viewer's manual snapshot-and-neutralize block with one declared state.
- **The JS progress clock is the SOLE advance authority in a clip session.** The former "`pos >= clipEnd`" backstop (which read the muted picture frame's stale position) is deleted.
- **The native clip-end watcher is disarmed at the source:** while `isStoryViewerOpen`, GAP emits `currentClipJson` as an inactive clip (`buildCurrentClipJson(null, …)`), so `checkClipEnd` never fires for a story. `playNext` is inert during a clip session (keyed on `clipSessionRef`) as belt-and-suspenders for the `naturalEndListener` (a clip that is the whole short track still hits `STATE_ENDED`).
- **GAP stays the sole engine and sole audio source** — ADR-0001 fully intact. `positionRef` is still GAP-driven, so the beat-synced visualizer is unaffected.
- **No `patches/**` change.** The disarm rides the existing `currentClipJson` path.

This makes the illegal state — "native advances a story" — **unrepresentable** rather than **suppressed**.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Status quo** — keep the five interlocking guards | They are ~5 undocumented, order-dependent guards in one file whose correctness requires understanding GAP's entire native advance model — the "clever solution only its author can maintain" anti-pattern, taken as silent debt across five commits and hardened into architecture. Records nothing for the next maintainer. |
| **Dedicated foreground-only story audio surface** (a second audible `<Video>`, GAP stays session owner) | Satisfies invariant part (i) but **breaks part (ii)** unless GAP's silence is proven every frame; re-introduces the exact "second audio source" shape ADR-0001 warns against; walks into the iOS `disableAudioSessionManagement` process-wide singleton; and moves `positionRef` ownership, breaking the visualizer/play-tracker wiring. Highest risk, lowest marginal benefit. |
| **Native patch change** (a `clipSessionActive` prop in the patch) | Overkill — Option A disarms the watcher through the *existing* `currentClipJson=null` path with no patch edit. Spending risk on the largest upgrade obstacle in the project (ADR-0002) for a foreground feature is rigor pointed the wrong way (P4). |

## Consequences

**What this makes easy:** the story bug *classes* (native-advances-a-story, dual-clock early-advance, same-track false clip-end) are removed at the source, not suppressed. New story playback behaviour is expressed by entering/exiting one declared mode. ADR-0001 and the visualizer are untouched.

**What it costs / does not settle:**
- The JS timer is now the sole advance clock, so a mid-clip network stall advances on JS time rather than audio position. Accepted for short foreground clips (the audio-accurate backstop it replaces was itself the source of the stale-position early-advance).
- **Unfixed (Phase 2, deferred):** a clip session still leaves GAP's `showNotificationControls` active, so viewing a 10s story replaces the user's real lock-screen now-playing, and background behaviour mid-story is undefined. Whether toggling that prop churns the MediaSession needs **on-device** verification, and "should a story own the lock screen" is partly a product call. Left for a follow-up; the inert session stays in Phase 1.
- The `currentClipJson=null`-disarms-native claim and the `naturalEndListener`-only-at-`STATE_ENDED` claim are **verified by reading the patch, not by running it.** Mitigated by the `playNext` clip-session guard (covers the whole-short-track edge either way) and by the new `PlaybackContext.clipSession` tests — the first tests over this seam, which previously had none.

## Dissent

*None recorded.* The principal-playback assessment considered "status quo is actually right" (the feature works, the invariant holds, Stories is human-gated and foreground) and rejected it on maintainability grounds; no principal argued to keep the ad-hoc overrides.

## Revisit when

- iOS story playback is enabled — re-verify the disarm path and the `startPosition` behaviour on AVPlayer, which has no native clip-end watcher.
- The lock-screen eviction (Phase 2) is taken up — decide whether a clip session suppresses `showNotificationControls`, gated on a device test that toggling it doesn't churn the session.
- Any other ephemeral clip surface (e.g. previews) appears — it should reuse `enterClipSession/exitClipSession` rather than re-derive the overrides.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
