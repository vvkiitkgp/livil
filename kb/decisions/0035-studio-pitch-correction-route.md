---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-30
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [ADR-0002, ADR-0003, ADR-0033, ADR-0034, ADR-0036]
---

# ADR-0035 — Fix the licensing and quality constraints for Studio pitch correction now; choose the implementation route by a spike, zero-native first

| | |
|---|---|
| **Status** | **Proposed** (constraints and invariants) · **Deferred** (implementation route, until the spike reports) · first-slice order **Escalated** |
| **Date** | 2026-10-30 |
| **Domain** | playback |
| **Decided by** | board debate — principal-playback, principal-platform; adversarial-critic. Human ratifies |

---

## Context

The owner calls pitch correction ("Auto-Tune my voice") **the** selling point of Livil Studio
([ADR-0034](0034-studio-exclusive-audio-ownership.md)). The owner explicitly chose to process
**on the device, after the take**:

- not server-side, which gives no instant preview;
- not live while singing, which is out of scope for v1.

The UX:

- progress is shown in place;
- hold-to-compare raw vs tuned;
- choose a key or detect it;
- a Natural→Robot strength slider;
- an AUTO-TUNED/RAW switch per voice in the editor that flips instantly.

Both copies are kept. The technique is pitch detection (for example YIN), then snapping to the
key, then a monophonic pitch shift.

Constraints of the team: a solo maintainer with a front-end background; about 1% coverage in
`src/`; iOS testable only on a physical iPhone; a Mac disk near full.

Facts. **Verified by reading code unless marked. No DSP was run.**

| Fact | Evidence |
|---|---|
| **audio-api 0.12.2 already pitch-shifts natively.** `createBufferSource({ pitchCorrection: true })` builds a signalsmith-stretch instance. The source's `detune` AudioParam is read once per 128-frame render quantum (k-rate), clamped to ±12 semitones, and fed to `setTransposeSemitones()`. `AudioParam` supports `setValueCurveAtTime`/`setTargetAtTime`, so a per-note correction curve can be scheduled as automation, live or in an `OfflineAudioContext` | `types.d.ts:105-118`, `AudioBufferBaseSourceNode.d.ts:8`, `common/cpp/audioapi/core/sources/AudioBufferBaseSourceNode.cpp:97-150`, `HostObjects/sources/AudioBufferBaseSourceNodeHostObject.cpp:93-106` |
| **Latent audio-api bug:** `setTransposeSemitones` is called only `if (detune != 0.0f)`. A curve that returns to exactly 0 cents keeps the last non-zero shift, so the voice plays at the wrong pitch with no error | `AudioBufferBaseSourceNode.cpp:144` |
| The internal stretcher uses `presetDefault`: 120 ms blocks, 30 ms hops. The shift changes at most once per hop, so hard "Robot" steps are expected to smear (inferred) | `libs/signalsmith-stretch/signalsmith-stretch.h:63-64` |
| **No public API writes a rendered buffer to a file.** `AudioFileUtils` exports only `concatAudioFiles`. `AudioStretcher` exports only `changePlaybackSpeed`. `RecorderAdapterNode` feeds the mic *into* a graph, not the other way. The recorder writes only microphone input | `lib/typescript/core/{AudioFileUtils,AudioStretcher,AudioRecorder,RecorderAdapterNode}.d.ts` (checked by the moderator) |
| Worklets run on an `'AudioRuntime' \| 'UIRuntime'`, a separate JS runtime that is very likely still Hermes (no JIT, inferred) | `src/core/BaseAudioContext.ts:75` |
| The repo contains **zero** app-owned C++, ObjC++ or CMake. App-owned native code today is small Kotlin/ObjC modules (`SplashScreenModule.kt`, `LivilPasteboard.m`, `LivilAuthSession.m`) | `find android/app/src ios` |
| audio-api's vendored signalsmith copy has rewritten include paths and no licence header | `common/cpp/audioapi/libs/signalsmith-stretch/*.h` |
| **LGPL FFmpeg already ships** in the app via audio-api: `libavcodec`/`libavformat`/`libavutil`/`libswresample` for all four Android ABIs and as dynamic xcframeworks on iOS. `libavutil` reports "LGPL version 2.1 or later". There is **no open-source notice of any kind** in `src/`, `docs/` or `web/`. audio-api's README points to a `THIRD_PARTY.md` that is absent from the installed package | 2026-10-26 AAB contents, `ffmpeg_ios/*.xcframework`, `relinking.md`, grep |

**One consequence affects the whole Studio, not just tuning.** Any output that is not a
single raw take (drums, more than one voice, or a tuned render) needs a buffer→file encoder,
and audio-api 0.12.2 does not provide one publicly. Some app-owned native encode step is
therefore required beyond the very first slice, whichever pitch route wins. That step could be
a Kotlin/ObjC module using MediaCodec / AVAudioFile, not necessarily C++.

## Decision

### Fixed now (Proposed)

1. **Pitch correction runs on-device, after the take.** No server path and no live correction
   while singing in v1. This is the owner's choice, and the board found no technical reason to
   overturn it.
2. **Licensing.** Only code we write, or MIT / BSD / Apache-2.0 code.
   - No GPL/AGPL in the binary: Autotalent, Rubber Band GPL and aubio are out.
   - No statically linked LGPL: SoundTouch is out.
   - Anything vendored comes from upstream at a pinned commit, with its licence text committed.
   - We never `#include` audio-api's internal headers and never link its private `.so`. Either
     would let every audio-api upgrade silently break our build (P52).
   - *Inferred, not legal advice.*
3. **Invariants, whichever route wins:**
   - The tuned output is **sample-exactly the same length and alignment** as the raw take, or
     the instant switch and overdub alignment break. This is enforced by a test, not by the
     choice of algorithm.
   - In-key input passes through as a no-op, within a stated cents tolerance.
   - If the detune route is used: never schedule exactly 0 cents. Use an epsilon such as 0.01
     cents, pinned by a golden test, because of the `!= 0` bug above.
   - Any native code that parses audio files accepts WAV/PCM only. Sizes come from the file
     length, never the header. Every chunk is bounds-checked. Compressed input goes through the
     platform decoder, never a hand-rolled parser. If the code is C++, a libFuzzer target runs on
     the ubuntu CMake job. Crash-leftover and backup-restored files are untrusted input, and a
     document picker already exists (`mediaPicks.ts`), so "import a beat" is one wire away.
4. **Acceptance bar**, defined before any build:
   - cents error on synthetic vibrato and stepped-note signals;
   - an ABX listening test by the owner on a corpus we own;
   - processing time on a **named** low-to-mid Android phone and the owner's iPhone. The board's
     starting bar of 0.1× real time or less is an **estimate**. The binding bar is derived from
     how long "progress in place" may take before the UX fails, and that is the owner's call;
   - peak memory, within ADR-0034's budget.

### Implementation route (Deferred until a time-boxed spike reports)

| | **Route A: zero-C++ (try first)** | **Route B: app-owned C++ module** |
|---|---|---|
| Detection | YIN in JS on `getChannelData()` of the raw take | YIN in C++ |
| Shift | audio-api `pitchCorrection` source plus `detune` automation. `setTargetAtTime`'s time constant acts as the retune speed, so Natural→Robot maps directly | Vendored upstream signalsmith-stretch (MIT) with a tuned block size and formant control. TD-PSOLA fallback for "Robot" only if the bar fails |
| Strength slider | Can be a live preview: recompute the curve and reschedule it | A re-render taking seconds |
| Memory for the instant switch | One raw buffer; tuned audio is computed live | Two rendered files/buffers |
| Final render to a file | Needs an encoder (see Context) | Same module can own mixdown and encode |
| Cost | Detune is k-rate with no formant control and is capped at `presetDefault`. JS YIN cost on Hermes is unmeasured. Real-time CPU with three voices through stretchers is unmeasured | The **first** app-owned C++ in the repo: JNI plus ObjC++ glue, a CMake CI job, fuzzing, and a permanent upgrade obligation on every RN bump (P13). Constitution P57 names the native layer as a place where debt is never acceptable, and Part II warns against the solution only its author can maintain |

**Route B is chosen only if Route A fails the measured bar.** The first app-owned C++ module
needs a receipt. The spike compares both routes on the owner's real takes, with the same YIN and
the same tests, and measures CPU with three overdubbed voices (`dumpsys cpuinfo`) and JS YIN time
for a 3-minute take.

## Alternatives considered

| Alternative | Why rejected or not chosen |
|---|---|
| **Per-sample DSP in a `WorkletProcessingNode`** | 128-frame callbacks on a separate JS runtime (very likely Hermes, no JIT) for whole-take analysis and shifting. The "no JIT" reason is **inferred, not measured**. The decisive point is that Route A moves the shift into native code, so per-sample JS is unnecessary. This option still lacks an encoder |
| **Server-side via the GitHub transcoder (ADR-0033)** | Owner rejected it: no instant preview. The GitHub schedule is also best-effort over hours, and the doorbell gives about a minute |
| **Live correction while singing** | Owner rejected it for v1. Needs measured round-trip latency the platform does not expose (ADR-0034) |
| **Autotalent, Rubber Band (GPL), aubio** | GPL in an App Store binary (App Store terms conflict with GPL; the 2011 VLC removal is the precedent). Inferred, not legal advice |
| **Rubber Band commercial licence** | Not evaluated. Recurring cost. Reconsider only if both routes fail the quality bar |
| **SoundTouch (LGPL)** | Relinking obligations are awkward when statically linked on iOS |
| **Reuse audio-api's internal signalsmith copy** | No licence header, and include paths internal to audio-api, so every upgrade can break the build |
| **Patch audio-api to expose more DSP or an encoder** | Creates a second patched native library (ADR-0002) |
| **Platform-native shifters**: iOS `AVAudioUnitTimePitch` in offline manual rendering (writes files natively via `AVAudioFile`); Android Sonic inside media3 (Apache-2.0, presence inferred) | **Not evaluated in depth.** Recorded so they are not rediscovered as new. Risks: they are oriented to constant-ratio shifting, and the two platforms would sound different |
| **WORLD vocoder (BSD)** for the "Robot" end | Not evaluated. A candidate if signalsmith smears hard steps |

## Consequences

**Good:** licensing risk is closed off before any code is written. The invariants (alignment,
no-op, the epsilon, file-parsing hygiene) are testable whichever route wins. If Route A passes,
the feature ships without the project's first C++ module, and the strength slider can preview
live.

**Costs:**

- Commitment is delayed until a spike, which is days of work before any tuning ships.
- Route A rides on audio-api internals (k-rate detune, `presetDefault`, the `!= 0` bug). An
  upgrade can change the *sound* of every tuned voice. This is another reason for ADR-0034's
  exact pin.
- Quality headroom (block size, formants, PSOLA) exists only in Route B.
- An encoder is needed for anything beyond a single raw take, whichever route wins.

## Dissent

- **principal-platform and principal-playback (Rounds 1–2)** favoured the C++ module from the
  start, on the grounds of performance and memory (whole buffers in `OfflineAudioContext`) and
  quality control. The critic answered that it is **not proven**: the zero-native path was never
  tested, and "audio-api has no pitch API" (platform, Round 2, accepted by everyone) is false.
  The moderator verified the critic's citation. Recorded because if Route A's quality fails,
  this dissent was right.
- **principal-playback (Round 1): own TD-PSOLA as primary.** Conceded in Round 2 to signalsmith as
  primary (latency API plus pre-roll make exact alignment achievable offline), keeping PSOLA as
  the Robot fallback. principal-platform conceded the alignment argument. Both now say the spike
  decides.
- **adversarial-critic:** quality headroom is the *only* real argument for Route B, and it is
  conditional. Adopted as the Route B trigger.

## Escalated (owner decisions, not technical deadlocks)

> **Question:** Is the first public Studio release a recorder without tuning ("1a"), or does
> tuning have to be in it?
> **Position A** (principal-platform, principal-playback): ship 1a (record → play back the file →
> post) first. It lands the permission, ownership and native-file risk with no DSP or C++, and
> tuning follows once the spike reports.
> **Position B** (adversarial-critic): run the tuning spike **first** and keep 1a behind a flag.
> Shipping an untuned recorder publicly works against "THE selling point" (P41), and the riskiest
> unknown should be tested before the cheapest slice ships.
> **Precise point of divergence:** whether release order follows risk (land the platform risk
> early) or value (no public release without the feature that justifies it).
> **What would resolve it:** the owner's product call. If Route A passes the bar within the
> spike, the cost of the split mostly disappears.

**Owner resolution (2026-10-30), naming:** the feature is called **"Magic Tune"** and the
surface is called **"Editor"** in all UI and store text. The word "Auto-Tune" is never shown to
users. "Studio" remains the internal code name in these ADRs and in code identifiers only, so it
does not collide with the web creator dashboard in anything a user, support or ops reads.

**Still open:** the first-slice order question above (recorder-only "1a" vs tuning first). The
owner asked to *see* recording, Magic Tune and the Editor working together, which favours running
the tuning spike in the first prototype, but has not ruled on what ships publicly first.

- **Naming.** "Auto-Tune" is an Antares trademark. Whether to use the word in UI or store text
  is the owner's call, with counsel if needed (P63). Separately, "Studio" already names the web
  creator dashboard (`livil-music.com/studio`), which will cause confusion in support, ops and
  the knowledge base.
- **Open-source notices (a pre-existing gap, not created by Studio).** LGPL FFmpeg ships with no
  notice, there is no notices screen at all, and any MIT code Studio vendors adds to the same
  duty. Dynamic linking probably satisfies LGPL relinking; it does not satisfy the obligation to
  ship notices and licence texts. Owner and counsel.

## Revisit when

- The spike reports. Then write the route decision as its own short ADR referencing this one.
- audio-api changes its pitch-correction source, the `!= 0` behaviour, or its stretcher preset.
- The owner wants live correction while singing.
- A permissive, maintained pitch-correction library appears that meets the bar.
