---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-11-01
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [ADR-0001, ADR-0033, ADR-0034, ADR-0035, ADR-0036]
---

# ADR-0037 — Master a Studio render in JS with a true-peak limiter; the WaveShaper is a live safety net only

| | |
|---|---|
| **Status** | **Proposed**, awaiting human ratification. The two escalated questions were answered by the owner on 2026-11-02 (see Escalated) |
| **Date** | 2026-11-01 |
| **Domain** | playback (the app-side DSP has no owner in `board-routing.yml`; that gap is a known defect) |
| **Decided by** | Board debate: principal-playback, principal-platform, principal-client, plus the adversarial-critic. A human ratifies |

---

## Context

The Editor (`src/screens/studio/`, `__DEV__`-only) sums voices, drums and synths into a master `GainNode`, then a
`WaveShaperNode` "limiter" (`softLimitCurve`, `src/utils/audioFx/effects.ts:68-86`), then the destination.
`renderMix.ts` repeats that chain offline. Its output is encoded to 16-bit FLAC, which becomes the post's only master
(ADR-0036). The transcoder then derives AAC 256k (ADR-0033), and listeners hear that copy at fixed volume. Nothing
normalises loudness anywhere.

The owner reported crackle when raising whole-song volume (up to 300%). The board found the following, verified by
simulating the real code and the library's own source on synthetic signals. Nothing was run on a device.

- **The curve is a static clipper.** It is unity to 0.8, has a tanh knee, and is flat at about 1.5×. Distortion vs
  signal: about −35 dB at 200%, about −16 dB at 300%.
- **The default drum presets already drive it.** They peak at +3.8 to +5.3 dBFS pre-shaper.
- **Oversampling can't help.** Aliasing is negligible; the damage is saturation.
- **`react-native-audio-api` 0.12.2 has no compressor node.** It normalises every 128-frame block that exceeds 1.0, both
  live and offline (`AudioDestinationNode.cpp:44`, `AudioBuffer.hpp:302-321`, `OfflineAudioContext.cpp:72`).
- **The `WaveShaperNode` constructor ignores `oversample`** (`WaveShaperNode.cpp:13-17`).
  - Through the property setter, the r8brain path passes about 26 blocks dry and then adds about 68–71 ms of latency.
    Nothing reports that latency.
- **Current mixes overshoot after AAC 256k**, reaching +1.3 to +4.3 dBFS (local ffmpeg 7.1.1; production runs 6.1.1).

## Decision

1. **The posted render contains no WaveShaper.** It renders at a fixed −18 dB master gain, so no block reaches the
   destination normaliser. The level is restored in float JS.
2. **A JS mastering pass runs between render and `encodeFlac`.** In order:
   - a 30 Hz high-pass (native `BiquadFilterNode`, inside the render);
   - BS.1770-4 integrated loudness measurement;
   - gain toward a loudness target, with limiter gain reduction capped at about 4–5 dB;
   - a stereo-linked look-ahead **true-peak** limiter. Detection is the 4× BS.1770 Annex 2 FIR, run sparsely near the
     ceiling. The ceiling is **−1.0 dBTP**, or −1.5 if the louder target is chosen.
   - Then: fades, one shared TPDF dither sequence to 16-bit, and left/side FLAC coding.
   - Measured LUFS and dBTP are logged, and stored for later feed normalisation in an add-only nullable column. That
     column needs its own data and security review.
3. **"Your song" plays the mastered result**, both channels, at the context rate.
4. **The live Editor keeps a WaveShaper only as a safety net:** ceiling ≤ 0.89, `oversample` `'none'`, and gain staging
   that keeps signals under its knee. The live Editor is a preview; "Your song" is the reference.
5. **The transcoder's audio stays unchanged.** It may only measure and log (`ebur128`).
6. **Feed loudness normalisation, if adopted later, is never applied through `GlobalAudioPlayer`'s `volume` prop.**

**Preconditions before this ships:**
- device timing of the full post pass on a mid-range Android;
- memory tracking through a 15-minute post on a 4 GB Android (an out-of-memory kill is silent);
- the AAC overshoot re-measured on the production ffmpeg 6.1.1, or that ffmpeg pinned.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Widen the soft-limit curve's input range to HEADROOM² | No effect. Output is identical to 4 dp from 0.5–9×, because the curve already saturates at about 1.5× |
| `oversample: '4x'` on the shaper (live and/or offline) | The constructor option is ignored. Through the setter it adds a start glitch and about 70 ms of unreported latency (the metronome and pads, which bypass master, land early). Band-limiting a clipped signal overshoots 1.0 and trips the block normaliser. It reduces aliasing, which was not the problem |
| Keep the shaper offline and add the JS limiter after it | The limiter would only see already-clipped audio that never exceeds 1.0, so it does nothing |
| Native `DynamicsCompressorNode` or a compressor via a library patch | It doesn't exist in 0.12.2. Patching a second native media library is an upgrade obligation (P13) for something JS does in seconds offline |
| Loudness-normalise in the transcoder (`loudnorm`) or apply gain when the true peak is high | It would silently change creators' lossless masters, while the same master uploaded as a ≤ 400 kbit/s mp3 skips the transcoder (`transcode-media.mjs:104-133`). Inconsistent; measure and log only |
| Normalise at playback via GAP `volume` | Fabric defers prop changes while backgrounded, so native auto-advance would play the next track at the previous track's gain. That is a lock-screen-only, silent failure |
| A live JS limiter in `WorkletProcessingNode` (live == posted) | Unproven. Audio-thread GC pauses or underruns would cause exactly the crackle being fixed, and it is untested in the offline context. Deferred, not rejected |
| Sample-peak ceiling (−0.1 / 0 dBFS) | Inter-sample and post-AAC peaks overshoot. A −1.5 dBFS sample-peak ceiling still measured +0.31 dBTP |
| 24-bit FLAC without dither | About 2× the upload of 16-bit + left/side for no audible gain after AAC 256k. Pre-transcode stalls on cellular are already a risk |

## Consequences

**Gains:**
- Posted Editor songs stop carrying baked-in clipping.
- They survive AAC without overs.
- They become consistent with each other.

**Costs:**
- Post time rises by an estimated ~30% over today's FLAC encode. That figure is inferred from a Mac, and on a mid-range
  phone it may mean minutes for long songs.
- One more stage holds full-length float data in memory.
- The live Editor no longer sounds identical to the post (it is unmastered), so "Your song" becomes the reference the user
  must hear before posting.
- Limiting baked into the only master is **permanent**. The gain-reduction cap exists for that reason.

**Forecloses:** using the shaper as the loudness tool.

**Leaves open:** feed-wide normalisation, using the stored LUFS.

## Escalated

The **loudness target** is open: −12 LUFS as a ceiling (principal-client, principal-platform) vs −14 LUFS (principal-playback).

So is **the meaning of the user's "Song volume"**: a ±6 dB trim around the target vs replacing it with a Clean / Balanced
/ Loud limiter-cap choice.

Escalated to the owner in the board's standard format. It needs:
- the owner's call on loud vs dynamic (P63; there is no `kb/product/`);
- an `ebur128` measurement of about 20 real feed tracks.

**Owner decision, 2026-11-02:**
- **Target −14 LUFS integrated, −1.0 dBTP, limiting capped at 4 dB** (`TARGET_LUFS` / `CEILING_DBTP` /
  `MAX_LIMIT_DB` in `src/utils/audioFx/master.ts`). Dynamics over loudness; feed-level matching stays a separate decision.
- **"Song volume" stays a slider, for listening in the Editor only, capped at 200 %.** The posted render ignores it and
  is always mastered to the target.

**Implemented on `feat/editor-prototype` (uncommitted, not device-measured):** render at −18 dB with no shaper + 30 Hz
high-pass; BS.1770-4 meter; stereo-linked look-ahead true-peak limiter (3 ms / 10 ms hold / 100 ms release; inter-sample
peaks interpolated only at local maxima within 3 dB of the ceiling); loudness search on a 32-frame block summary, one
full-rate limiting pass; 5 ms fade-in, ≤1 s tail with a 50 ms raised-cosine fade-out; shared TPDF dither at 16-bit.
Also: auto take level (non-destructive `VoiceLane.level`), drum/synth peak trims, volume caps at 200 %, live safety
curve ceiling 0.89, metronome and pads through the master, gain glides, 4 ms segment ramps, one source per voice,
speaker-take latency compensation from the click remover's `lagMs`, draft takes resampled to the context rate,
PolyBLEP synth oscillators with a 2-pole filter. **Not yet done:** stereo/reverb (#11), Magic Tune grit (#5), left/side
FLAC (#15), headphone latency (#2), the LUFS/dBTP column, and the critic's device timing and 15-minute memory checks.

## Dissent

- **adversarial-critic:** that the shaper causes *the owner's* crackle is not proven. Live-only candidates remain:
  - a duplicate signalsmith stretcher per pitched voice;
  - JS scheduler stalls starting segments mid-waveform;
  - 60 Hz re-renders while dragging;
  - slider zipper noise.

  The discriminator is whether "Your song" crackles too. The decision above stands regardless, because the measured
  distortion exists either way.
- **adversarial-critic:** AAC true-peak is hygiene, not a top issue. With a correct BS.1770 meter, a −1.0 dBTP ceiling
  measured zero overs (worst −0.43 dBFS) after AAC. principal-platform's case for −1.5 dBTP rested on a 4-tap estimator.
- **principal-platform:** a glue compressor stage is speculative (P25), and it was left out.

## Revisit when

- `react-native-audio-api` is upgraded: re-check the destination `normalize()`, WaveShaper oversampling and whether a
  compressor node exists.
- A live worklet limiter is proven on a device without underruns.
- Feed loudness normalisation is decided.
- Production ffmpeg changes.
- Device measurements show the post pass or its memory is unacceptable for 15-minute songs.
