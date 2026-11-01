---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-30
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [ADR-0001, ADR-0002, ADR-0003, ADR-0035, ADR-0036]
---

# ADR-0034 — Let Livil Studio own audio exclusively while it is open, never alongside GlobalAudioPlayer

| | |
|---|---|
| **Status** | **Proposed** — awaiting human ratification. Project length cap **resolved by the owner 2026-10-30** (15:00, see Escalated) |
| **Date** | 2026-10-30 |
| **Domain** | playback |
| **Decided by** | board debate — principal-playback, principal-platform, principal-client; adversarial-critic. Human ratifies |

---

## Context

**Livil Studio** is a proposed third "+ Post" tile: record a vocal take (one at a time),
optionally pitch-correct it on the device after recording ([ADR-0035](0035-studio-pitch-correction-route.md)),
arrange takes on a timeline with a bundled drum machine (pads + a 16-step grid playing over the
project's own transport), and end by rendering **one ordinary audio file** that goes through
the existing Upload path ([ADR-0036](0036-studio-publishing-path.md)). The feed,
GlobalAudioPlayer (GAP) and the lock screen never know a Studio exists. The post page, FLAC
and video export are out of scope.

A live multitrack transport, a recorder and sample-accurate step scheduling cannot be built on
patched `react-native-video` (RNV). The installed `react-native-audio-api` 0.12.2 (MIT, used
today only for `decodeAudioData`, ADR-0003) can do them. That puts the feature against three
standing rules:

- **[ADR-0001](0001-single-audio-engine.md)**: one component plays every post and is the sole
  media-session owner. The incident behind it (INC-0001) was **two engines that both talked to
  the OS**, tearing a media session down and rebuilding it at every audio↔video boundary.
- **CLAUDE.md**: "Never wire `react-native-audio-api` as a player — that would be a second
  engine." ADR-0003, "Revisit when": "Do not revisit by wiring the audio library in as a player."
- The iOS rule that FullScreenPlayer must never set `disableAudioSessionManagement`, because
  the audio session is a process-wide singleton.

Facts the debate rests on. **Verified by reading code. Nothing was run on a device.**

| Fact | Evidence |
|---|---|
| Nothing mechanically restricts `react-native-audio-api` imports. The only lint guard is `no-second-media-session`, which covers `showNotificationControls`. | `.eslintrc.js`, `eslint-rules/no-second-media-session.js` |
| audio-api's Android MediaSession/notification/foreground-service code exists, but is reached only through its JS notification API. The service is declared only by its Expo plugin, which this bare-RN app never runs. The merged release manifest has no audio-api entries. | `PlaybackNotification.kt:77`, `NotificationRegistry.kt:49-68`, `src/plugin/withAudioAPI.ts:78-80`, merged manifest |
| **Already live in production at import:** Android creates an "Audio manager" notification channel and a MEDIA_BUTTON receiver. iOS creates an AVAudioEngine and four AVAudioSession observers, and on a media-services reset re-applies its *desired* category. | `AudioAPIModule.kt:81`, `MediaSessionManager.kt:54,68`, iOS `AudioAPIModule.mm:71-75`, `AudioSessionManager.mm` |
| audio-api on iOS defaults to `.playback`, calls `setCategory` on the shared session, and deactivates it with `notifyOthers` on cleanup. `disableSessionManagement()` is one-way. | `AudioSessionManager.mm:34-36,74,204`, `AudioEngine.mm:125,389` |
| RNV iOS: an `RCTVideo` registers with `AudioSessionManager` from `init` and unregisters only in `removeFromSuperview`/`deinit`, whether paused or playing. While **any** view is registered, a `.categoryChange`/`.newDeviceAvailable` route change re-runs `configureAudioSession` and returns `.playback`. Studio's own `setCategory(.playAndRecord)` fires `.categoryChange`. | `RCTVideo.swift:209,293,1494`, `AudioSessionManager.swift:12-24,356-367` |
| RNV Android: a headset/notification PLAY goes through media3 to `ExoPlayer.play()` natively and is audible before JS hears `isPlaying=true`. `requestAudioFocus()` fires on play. | patched `VideoPlaybackService.kt`, `ReactExoplayerView.java:1339`, `GlobalAudioPlayer.tsx:394-410` |
| `VideoPlaybackService` is `exported="false"` and there is no `MediaButtonReceiver`, so Android media resumption cannot restart it. | `AndroidManifest.xml` |
| GAP already renders `null` when `engineDriving` is true (a jam seam no code sets) or when `!nowPlaying` (exercised in production via `clearNowPlaying`). `unregisterHandlers` has zero callers. | `GlobalAudioPlayer.tsx:609-611`, `ListeningStatusReporter.tsx:23`, `PostCard.tsx:170` |
| Jam sync drives `handlersRef.current.seek/play/pause` from host events, including a ~2 s heartbeat. | `JamRealtimeContext.tsx:319-336` |
| Memory: a 15:00 mono float32 take at 48 kHz is 172.8 MB per in-memory copy; raw + tuned is 346 MB per voice. | arithmetic |
| audio-api 0.12.2 exposes no input/output latency; both Oboe streams use `PerformanceMode::None`. | `AudioPlayer.cpp:31`, `AndroidAudioRecorder.cpp:101` |

## Decision

**Studio may run `react-native-audio-api` as a live engine (transport, pads, recorder) only
under mutually exclusive ownership.** At any instant exactly one of GAP or Studio owns audio.
They never run concurrently. Studio never touches an OS media surface.

ADR-0001 is **not superseded**. Its decision (every *post* plays through GAP, which is the only
media-session owner) stands unchanged. This ADR narrows CLAUDE.md's "never a second engine" to
**"never a second engine that plays posts, touches the OS media session, or runs at the same
time as GAP"**. On ratification, CLAUDE.md's rule and ADR-0003's "Do not revisit" line must be
amended **in the same change**, or `kb/` and CLAUDE.md will contradict each other. The board
cannot edit CLAUDE.md.

### Invariants

1. **Ownership is an explicit state machine**: `audioOwner: 'gap' | 'transition' | 'studio'`,
   in a small standalone module. It is not the jam meaning of `engineDriving`; it may drive the
   same null-render, renamed or re-commented as "foreign audio owner".
2. **Zero RNV views registered app-wide while the owner is not `'gap'`.** Unmounting GAP's
   `<Video>` is necessary but not sufficient: a MediaPlayer, FullScreenFrame or StoryViewer on a
   screen *below* Studio stays registered (UIKit does not call `removeFromSuperview` on covered
   screens), and on iOS one registered view flips the session back to `.playback`. Therefore:
   - Studio is entered **only from the "+ Post" chooser**, never over Upload-with-a-file,
     Repost, a story or full screen.
   - FullScreenPlayer keeps gating on the owner.
3. **Open order:**
   1. pause GAP through `handlersRef`;
   2. owner = `transition`; GAP renders `null` (Android `cleanup()` → `stopForeground(REMOVE)`;
      iOS RNV deactivates the session);
   3. only then create the AudioContext and recorder; category `.playAndRecord` with
      `defaultToSpeaker` and `allowBluetoothA2DP`, never HFP; request audio focus GAIN;
   4. owner = `studio`.
4. **Close order:**
   1. stop the take and transport; `await context.close()`;
   2. **reset audio-api's session options to `.playback` defaults** (its desired category
      otherwise persists and is re-applied on a media-services reset);
   3. `setAudioSessionActivity(false)`; owner = `gap`;
   4. GAP remounts **paused** at the saved position. Never auto-play.

   Handing off to Upload is an ownership transition. Close completes **before** Upload mounts
   its preview `<Video>`, using `navigation.replace`, not push.
5. **Refusal lives in PlaybackContext's entry points**: `setNowPlaying`, `setQueue`,
   `playTrackAtIndex`, `requestPlay`, and the registered handlers. Guarding only GAP's handlers is
   the wrong layer: GAP's `nowPlaying` effect calls `setPaused(false)` without consulting the
   owner, so any `setNowPlaying` would make GAP remount unpaused and auto-play when Studio
   closes. Programmatic callers (the jam heartbeat) are refused silently. User gestures get a
   toast.
6. **Studio never touches OS media surfaces.** It never uses audio-api's notification or
   lock-screen APIs, never creates a MediaSession or starts a foreground service, never calls
   `disableSessionManagement()` or `activelyReclaimSession`, and never adds
   `FOREGROUND_SERVICE_MICROPHONE`.
7. **Recording is foreground-only on both platforms, and our code owns the stop.** minSdk is 24.
   Android 7–8 do not restrict background mic capture, and 9–10 treat our `mediaPlayback`
   service as foreground. iOS keeps recording because `UIBackgroundModes` contains `audio`.
   Stop and **keep** the take on any of:
   - `AppState` leaving `active`;
   - an interruption beginning;
   - audio-focus loss;
   - **Studio losing navigation focus** (a push tap can navigate over a live Studio without
     backgrounding the app).

   iOS `inactive` (Control Center, notification shade) does not stop the take.
8. **Studio entry is blocked during a Jam**, with an on-screen reason (never `Alert.alert`).
   With GAP unmounted, jam sync would hit stale handlers and silence the room for that user.
9. **Silent-take guard.** If input is digital silence for about 2 s while recording, stop and
   fail loudly. The most expensive failure in this design is a 4-minute vocal recorded as
   silence on iOS, where the platform reports no error (P15).
10. **Memory budget**: native-heap growth of at most 200 MB over baseline on a named 4 GB
    Android phone, measured with `adb shell dumpsys meminfo com.livil` at open, after a take
    loads, and at peak render, and with the Xcode gauge on iPhone. Over budget means refuse
    loudly, never a silent low-memory kill. The project length cap that follows from this is
    **Escalated** (below).
11. **Overdub (later slice).**
    - Project time is the single truth.
    - A per-route latency offset (calibration plus a manual nudge) is stored on the take, never
      baked into the audio.
    - Pad taps subtract output latency before snapping to the grid.
    - Headphones are advised; this is guidance, never described as a control.
    - No live monitoring in v1.
    - No patching audio-api for low latency; that would be a second ADR-0002.
12. **`react-native-audio-api` stays pinned exactly at `0.12.2`.** Every upgrade is a
    playback-risk upgrade (P52). This pin is not enforced today
    (`check-version-sync.mjs` checks only versionCode/versionName).

### Enforcement (Constitution P1), with what CI can and cannot reach

| Guard | Runs in CI? |
|---|---|
| ESLint: `react-native-audio-api` importable only from `src/studio/engine/**` and (only `decodeAudioData`) `src/services/waveform.ts`; ban its notification exports, `disableSessionManagement`, `activelyReclaimSession`; ban `registerHandlers`/`setNowPlaying`/`setQueue` in `src/studio/**` | Yes (`ci.yml` lint) |
| Jest on the state machine: no AudioContext while owner is `gap`; GAP never remounts before `close()` resolves; background or blur → `recorder.stop()` + `setAudioSessionActivity(false)`; refusal at PlaybackContext entry points; "Studio open → jam `play()` → close → GAP remounts paused" | Yes (`ci.yml` test) |
| `scripts/check-native-surface.mjs`: allowlist permissions, services and FGS types in our manifest and `node_modules/*/android/src/main/AndroidManifest*.xml`; `UIBackgroundModes` unchanged | Yes, **source only.** Library manifests merge at build time and CI has no Gradle/Xcode job, so the release checklist must inspect the **built** AAB's merged manifest |
| A CI check that native dependencies are pinned exactly | Yes (new) |
| "No RCTVideo registered" on iOS | **No.** Jest mocks RNV. Device protocol per release: open Studio from Home, log `AVAudioSession.category` after `setCategory`, record, confirm the take is not silent |
| Android media session count | **No.** Device: `dumpsys media_session` shows 0 Livil sessions while Studio is open, 1 after close |
| Background stop | **No.** Device: API 26 emulator, Android 14, iPhone. Record, press Home, wait 30 s, return. The take is no longer than the pre-Home time + 1 s; the mic indicator is off within 1 s; `dumpsys media.audio_policy` shows no active record client |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Pause GAP and add a `studioHoldRef` checked in GAP's native-PLAY branch** (principal-client, Round 1; withdrawn in Round 2) | On Android a headset/notification PLAY is audible natively before JS can react, so the guard only fixes it *after* a blip has leaked into the take, and on a speaker that blip is someone else's recording. On iOS a registered paused RNV view still flips the category back to `.playback` on the route change Studio's own `setCategory` causes, so the mic goes dead. It also fails silently, because every future play path must remember to check the hold |
| **Concurrent engines** (GAP keeps playing a feed song while Studio records over it) | The INC-0001 shape (two engines talking to the OS), plus speaker bleed of a commercial recording into the take |
| **Build the Studio transport on RNV** (several `<Video>`s as stems) | RNV cannot mix multiple sources sample-accurately or record. Multiple RNV views are exactly what ADR-0001 forbids |
| **Our own native audio engine** | Enormous scope for a solo maintainer. Reimplements what audio-api already ships |
| **Patch audio-api for low latency / expose latency** | A second ADR-0002 (a second patched native library) |
| **Server-side mixing/preview** | No instant feedback while editing. The owner rejected it for tuning in the same session |
| **Live monitoring in v1** | Unmeasured round-trip latency on `PerformanceMode::None` streams. Deferred, not rejected |

## Consequences

**Makes possible:** a live Studio with a recorder and transport while preserving the reasoning
of ADR-0001. At every moment there is exactly one audio owner, and only GAP ever owns a media
session.

**Costs, stated plainly:**

- **The lock-screen/notification card disappears while Studio is open**, and the feed track
  rebuffers when Studio closes.
- First edits to GAP and PlaybackContext. Both are propose-only, high-blast-radius files at
  roughly 1% coverage. The owner state machine sits on the most fragile seam in the app.
  Unmounting GAP while `nowPlaying` and handlers stay live has never run in production.
- Each owner flip re-renders every PlaybackContext consumer once (`engineDriving` is `useState`
  in the god context). Two flips per session is acceptable; a frequently changing flag would not be.
- `react-native-audio-api` changes from a decode utility into a playback-risk dependency. Each
  upgrade now needs the device protocol.
- **The central iOS invariant cannot be tested in CI.** It depends on a manual device protocol
  on a physical iPhone every release.
- `StudioProvider` duplicates transport concepts outside PlaybackContext. This is deliberate:
  merging them would be the wrong abstraction.
- The `isRepostOpen` flag that hides FloatingPlayer is a boolean owned by another feature. It
  must become a reference count before Studio relies on it.

**Forecloses:** singing along to a feed song in the Studio, and any background recording.

## Dissent

- **principal-client (Round 1), pause + hold.** Withdrawn after the Android native-PLAY path and
  the iOS route-change behaviour were read. Recorded because it is the cheaper design and will be
  proposed again. The evidence against it is in the table above.
- **principal-playback and principal-platform (Round 1) said Android silences background mic
  capture.** principal-security corrected this: that holds only from Android 11, and minSdk is
  24. Invariant 7 adopts the correction.
- **principal-platform: "restore `.playback` the way RNV expects" on close.** principal-playback
  answered that RNV reconfigures the session itself on `registerView`. The critic answered that
  audio-api's own *desired* category persists regardless. Both were adopted: ordering, plus an
  explicit reset of audio-api's options.
- **adversarial-critic, framing.** This contradicts CLAUDE.md's wording even if it honours
  ADR-0001's decision text, and should be read as a partial narrowing, not a mere
  clarification. Adopted in the Decision text.
- **adversarial-critic, the 5:00 cap.** The cap is a consequence of choosing two in-memory
  buffers per voice, not physics. audio-api ships `StreamerNode` (FFmpeg-backed),
  `AudioBufferQueueSourceNode`, and a development-only file-backed source, any of which bound
  memory by buffer size. All of them are unproven for seek accuracy. Not resolved; see Escalated.

## Escalated

**Owner resolution (2026-10-30): 15:00, the same cap as uploads (`MAX_TRACK_SECONDS` in
`shared/constants/media.ts`).** Position B is adopted, so its premise becomes a condition: takes
must play from streaming/file-backed sources, never as whole in-memory float32 buffers, and the
named-4 GB-Android spike (native heap + seek alignment, two streamed 15:00 takes flipping via
gain) must pass before the cap ships. If it fails, the fallback is to come back to the owner, not
to silently ship 5:00.

> **Question:** What is the Studio's maximum project length in v1: 15:00 (same as uploads, as the
> owner specified) or 5:00?
> **Position A** (principal-playback): Cap the project at 5:00 until measured. The instant
> raw/tuned switch as designed holds two float32 buffers per voice (346 MB per voice at 15:00,
> over 1 GB with overdubs). That ends in a low-memory kill with no JS log, the same signature as
> ADR-0003's video crash.
> **Position B** (adversarial-critic, aligned with the owner's spec): 15:00 is achievable if
> takes play from streaming/file-backed sources rather than whole in-memory buffers. The first
> slice has no raw/tuned pair at all, so the cap's own reasoning does not apply to it.
> **Precise point of divergence:** whether audio-api 0.12.2's streaming sources can serve
> sample-aligned clip playback and an instant raw/tuned flip with acceptable seek accuracy.
> **What would resolve it:** a spike on a named 4 GB Android phone measuring native heap and seek
> alignment for two streamed 15:00 takes flipping via gain. Also the owner saying whether a
> 5:00 Studio cap is acceptable as a product limit in the meantime. Upload's 15:00 clamp is
> unaffected either way (ADR-0036).

## Revisit when

- A device run contradicts any "verified by reading" row above, especially the iOS route-change
  behaviour or the claim that audio-api's notification paths stay dormant.
- `react-native-audio-api` is upgraded. Re-verify the dormant paths, the session behaviour, and the
  merged manifest.
- RNV gains multi-source mixing or recording, or the platforms offer media-session ownership
  transfer without teardown.
- Measured memory headroom at 15:00 reaches 2x or more. Then raise the cap.
- Anyone proposes background recording or singing over a feed song. Either one reopens the
  INC-0001 shape and needs a new debate, not an edit.
