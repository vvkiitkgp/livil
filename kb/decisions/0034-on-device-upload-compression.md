---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-26
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0002, 0003, 0006, 0033]
---

# ADR-0034 — Compress uploads on the device, not on a server

| | |
|---|---|
| **Status** | **Accepted** — owner-directed 2026-10-26; `src/services/mediaCompression.ts`, `patches/react-native-compressor+2.0.4.patch`. Complements ADR-0033 (server-side backstop) |
| **Date** | 2026-10-26 |
| **Domain** | playback (media pipeline) + platform (a new native dependency) |
| **Decided by** | owner |

---

## Context

The pipeline stored exactly what the phone recorded and played it back as-is
([media-pipeline.md](../architecture/media-pipeline.md): no transcoding, no adaptive
bitrate). Real uploads measured on 2026-10-26:

| Upload | Encoding | Bitrate | Size |
|---|---|---|---|
| 27 s phone video | 3840×2160, 60 fps, HEVC `.mov` | ~38 Mbps | 127 MB |
| 37 s phone video | 1320×2868, HEVC | ~15 Mbps | 70 MB |
| Songs | 16-/24-bit WAV | 1.4–2.3 Mbps | 34–64 MB |

A listener on 4G gets 5–20 Mbps. Anything above that buffers constantly, and the
database was idle (5 % CPU) — the bytes were the whole problem.

The same day, [ADR-0033](0033-transcode-uploads-server-side.md) put a **server-side
transcoder** on GitHub Actions that repairs files *after* they are uploaded (and repaired the
ones already there). That lands without a store release but has a lag of up to a few minutes
per file, re-downloads and re-uploads every heavy file, and leaves the listener who taps a
fresh post inside that window with the raw recording. This ADR is the other half: stop the
heavy file from being uploaded in the first place. It needs **no backend change** — production
is instant and serves every app version at once, while the app reaches phones a week or more
later (CLAUDE.md, *Production compatibility*) — so the two layers can ship independently.

## Decision

**The uploading phone compresses the song or video before it is uploaded**, so what reaches
storage is already streaming-friendly:

- **Video → H.264** (never HEVC — web browsers and older Androids decode it everywhere),
  longest side ≤ 1920 (1080×1920 for portrait), ≤ 30 fps, ~3.5 Mbps, AAC audio, MP4 with
  the `moov` atom at the front so playback starts before the download ends.
- **Audio → AAC-LC 256 kbps** in an `.m4a` (MP4) container.
- **Already-fine files pass through untouched:** an MP4 at ≤ 1080p and ≤ 4 Mbps, and any
  lossy song (MP3 cannot exceed 320 kbps by spec; M4A/AAC/Ogg/Opus are small by
  construction). Re-encoding those only loses quality.
- **Fail-safe, always.** The native module missing, a codec refusing the file, a probe
  timing out, an output that is not smaller — every one of these uploads the original,
  exactly as before. Compression is an optimisation of *what* is uploaded, never a gate on
  *whether* it is. The only non-fallback is the artist's own abort (another file picked,
  the screen left).
- The 500 MB pick-time cap stays on the **original** file. The waveform envelope
  (ADR-0003) is computed from the file that was actually uploaded.

Implementation: `react-native-compressor` 2.0.4 (a Nitro module; `react-native-nitro-modules`
0.35.10), both **pinned exact** like the other sensitive native dependencies, loaded lazily
so a build without the native side degrades to "upload the original". It is **patched**
(`patches/react-native-compressor+2.0.4.patch`) in two places, both Android:

1. **Audio is re-done as AAC/M4A through `MediaExtractor` + `MediaCodec` + `MediaMuxer`.**
   Upstream encodes MP3 through LAME behind a WAV reader that only understands 16-bit PCM
   (a 24-bit master decodes as noise), rejects `WAVE_FORMAT_EXTENSIBLE` (most DAW exports),
   decodes nothing but MP3 for other inputs, and has an indexing bug in its stereo read.
   For a music platform that is a silent-corruption risk, not a quality trade-off. The
   platform codecs take 8/16/24/32-bit and float WAV, FLAC, MP3, AAC, Ogg and Opus; AIFF
   has no Android extractor and falls back to the original.
2. **A `maxFrameRate` option on the manual video path.** Upstream caps at the source rate
   (up to 60); iOS already renders through a 30 fps video composition, so this makes the
   two platforms agree and halves the encoder's work on a 60 fps source.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Server-side transcoding only** | Adopted too, as ADR-0033 — but as the backstop, not the fix. It costs a round trip through GitHub Actions per heavy file (download, encode, upload, repoint), runs minutes after the post exists, and cannot help the uploader's own first play. Compressing at the source removes the heavy file; the server pipeline then has nothing to do for app uploads and keeps covering web uploads, old app versions and any on-device failure. |
| **HLS/DASH (adaptive bitrate)** | The durable answer at scale, and still the plan when scale demands it: a manifest-aware player path on three clients plus rendition storage, for a problem that is entirely "the files are too big at the source". Deferred — see *Revisit when*. |
| **Supabase edge function transcode** | Ruled out already for waveform decode (ADR-0003): a hard 2 s CPU limit and no ffmpeg. A video is orders of magnitude more work than an audio decode. |
| **A hand-written native module (MediaCodec / AVAssetExportSession)** | Offered as the fallback if the library did not fit. The library fits for video on both platforms and for iOS audio; only its Android audio path was unusable, and replacing one Kotlin file inside a patch is smaller and better-contained than a second module with its own spec, codegen and iOS half. |
| **Upstream's LAME → MP3 audio path, unpatched** | A 24-bit WAV would upload as noise (see above). MP3 at 256–320 kbps would otherwise have been acceptable. |
| **Pass through HEVC when it is already ≤ 4 Mbps and ≤ 1080p** | Adopted for MP4 containers, with the HEVC caveat accepted: the library exposes no codec probe, and a small HEVC MP4 is not a bandwidth problem — it is a browser-compatibility one the web already has today. A `.mov` is always re-encoded (container and, on phones, usually HEVC). |
| **`react-native-video`'s own export / `react-native-image-crop-picker`'s `compressVideoPreset`** | The picker's iOS presets re-encode at a fixed quality with no bitrate control and nothing on Android; the engine must not be touched (ADR-0002, ADR-0006). |

## Consequences

- A 4K/60 phone video uploads as ~1080p H.264 at ~3.5 Mbps — roughly a tenth of the bytes —
  and a WAV master as a ~9× smaller AAC. **The server transcoder (ADR-0033) skips both** — its
  rule is H.264, ≤ 1920, ≤ 31 fps, ≤ 6 Mbit/s for video and lossy ≤ 400 kbit/s for audio — so
  nothing is encoded twice, and it stays the backstop for web uploads, older apps and failures. Egress, storage and listener buffering all drop
  with it. **The artist waits for the re-encode** (on the order of a minute for a long 4K
  clip, with a percentage) before the early upload starts; the song's re-encode takes
  seconds.
- **The web studio is unchanged.** It still uploads what it is given; a browser cannot
  re-encode a video without a large WASM toolchain. Masters uploaded from the desktop stay
  large until server-side transcoding exists.
- **Existing objects are untouched.** Nothing is re-written; only new uploads shrink.
- A second patched native dependency (after `react-native-video`). Upgrading
  `react-native-compressor` means re-basing the patch, and the Kotlin transcoder has no
  test that runs in CI — it is verified on a device (the PR that introduced it records the
  before/after numbers).
- **iOS lock-screen and engine behaviour do not change**: H.264 MP4 and AAC M4A are both
  formats the engine and the web played before this ADR.

## Dissent

*None recorded.*

## Revisit when

- Upload compression stops being enough: listeners on poor connections still report
  buffering on compressed files, or desktop (web) masters become a material share of plays
  → server-side transcoding and adaptive bitrate, as [media-pipeline.md](../architecture/media-pipeline.md)
  already anticipates.
- `react-native-compressor` upstream fixes its Android audio path (AAC output, a
  bit-depth-correct WAV reader) → drop that half of the patch.
- Codec detection becomes available on the client → re-encode small HEVC MP4s too, for the
  web.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
