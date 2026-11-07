---
tier: 3
owner: principal-playback
consumers: [P-PB, P-DA, BE, P-SE]
last_verified: 2026-11-02
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Media Pipeline

Upload to storage to playback, end to end — **as it actually is**, including what it does not
do. There is no adaptive streaming here, and this document does not describe one.

---

## The pipeline

```
pick file → resolve to a real local path → stream upload (XHR)
   → Supabase Storage bucket → public URL stored on the track row
   → engine plays from that URL (progressive download)
   → audio-only: decode on device for the waveform envelope
```

---

## Upload

The most carefully engineered part of the data layer. Every decision below fixed a specific
failure.

**Streamed via raw `XMLHttpRequest`, not the client library.** Two reasons: the library does
not expose upload progress, and it wants the file in memory. React Native streams the file
from disk. **Reading a large video into an `ArrayBuffer` produced "Network request failed" on
real devices** — an out-of-memory failure wearing a networking error's clothes.

**Android `content://` URIs are materialised to a real file first.** Cloud-backed providers
(Drive and similar) are not reliably readable as streams, and there is dedicated error copy for
that case.

**Multipart field order matters.** The `cacheControl` field is written before the file part,
mirroring what the storage API's streaming parser expects.

**Size cap: 500 MB**, enforced client-side, with size and 413 responses mapped to
human-readable messages.

**Uploads are not resumable.** `tus`-style resumable clients buffer whole files in memory in
React Native, which is the problem we were avoiding. A dropped connection means restarting from
zero. This is a known limitation, accepted deliberately.

### When the connection fails mid-upload

React Native's Android networking has **no time limits at all** (connect, read and write
timeouts are 0 in its OkHttp client) and supabase-js sets none — so any request over a dead
connection can wait for many minutes. Every network step of an upload is therefore bounded:

| Step | Limit | Where |
|---|---|---|
| The file itself | **idle** 45 s (`STALL_TIMEOUT_MS`), re-armed on every progress event; 15 s (`NETWORK_CHANGE_STALL_MS`) right after a Wi-Fi ↔ mobile-data switch | `uploads.ts` |
| Storage's answer after the last byte | 120 s (`RESPONSE_TIMEOUT_MS`), entered from the progress event that reaches the total — **React Native never fires `xhr.upload.onloadend`** | `uploads.ts` |
| Sign-in check, track-row insert, saving the URL | 20 s each (`NETWORK_STEP_TIMEOUT_MS`); a row that lands after the time-out is deleted | `tracks.ts` |
| Clean-up after a failure | 10 s (`CLEANUP_TIMEOUT_MS`); what is unfinished stays remembered for `sweepStagedUploads` | `tracks.ts` |

The clean-up limit is the subtle one: the failure path used to `await` the delete and the
storage removal **before** rethrowing, over the same dead connection — so the screen kept
showing "Uploading · 0%" after the stall watchdog had already given up.

A failure the connection caused is an `UploadNetworkError` (`src/utils/uploadRecovery.ts`);
a server refusal (too big, wrong format) is a plain `Error`. Only the first is retried: once,
automatically, 3 s after the phone is online (at once if it still is, else when NetInfo says it
is back), then by a **Try again** button. The screen shows "Waiting for connection…" /
"Upload interrupted" instead of a frozen percentage. Post owns retrying once tapped, so the
early upload and Post never both re-send the file. Each retry starts from 0% under a new track
id, so a request whose file did land cannot collide with it.

Every stage logs a `[LIVIL][upload]` line (start, first bytes out, all bytes sent, stall,
network switch, each bounded step with its duration, retry, success/failure with the stage
name), so a freeze on a device shows where it stopped.

**A true resume needs a new native module.** Supabase's resumable (TUS) endpoint takes the file
in 6 MB chunks, and nothing installed can read a byte range of a file without loading the whole
file: React Native's `fetch(file://)` → `Blob.slice()` holds the entire file in native memory
(a 500 MB video would be killed for memory), and none of the installed native modules slices
files. The cheapest safe route is a ~100-line in-repo native module (Kotlin + Swift) that
copies one byte range to a temp file, sent with an XHR `{ uri }` body — a native rebuild and a
store release, no backend change. Until then, retry-from-zero is what happens.

---

## Storage

Two Supabase Storage buckets. **Cloudflare R2 is not used** — it appears in older docs as a
plan and was never built.

| Bucket | Holds | Path shape |
|---|---|---|
| `avatars` | Profile images, and album covers | `{userId}/…` |
| `tracks-media` | Audio, video, cover art | `{userId}/{trackId}/{kind}.{ext}` |

**Objects are served from public URLs.** Storage policies gate *writes*; reads are open to
anyone holding the URL. That is a real property of the system, not an oversight to be
discovered later — see limitations below.

Two gaps worth naming:

- **`tracks-media` has no policy migration in this repository.** The `avatars` bucket has one
  scoping writes to a per-user folder prefix; the media bucket's configuration exists only in
  the hosted project and cannot be reviewed from source (Constitution P51).
- **The `avatars` bucket does double duty** — it also holds album covers, which do not follow
  the same per-user path convention its policies are written around.

---

## Playback consumption

The engine plays directly from the stored URL. See [playback.md](playback.md) for the engine
itself.

Relevant here: **the player always loads the full file.** Clipping is presentational. A post
that plays ten seconds of a four-minute track still fetches the four-minute track.

---

## Waveform analysis

The floating player's wave follows the song's actual loudness and frequency content, from a
precomputed envelope stored on the track row and indexed by absolute position.

**Decoding happens on the device**, using the platform's hardware decoder as a one-shot decode
utility — no audio context, no playback, no media session. It therefore **never touches the
playback engine**, and it must stay that way: wiring an audio library in as a player would
create a second engine and break the single-engine invariant.

### Analysis is audio-only. Never analyse video.

Decoding a video pulls the **entire file** into memory through the networking layer. On a
video of any real size this is an out-of-memory kill: **the operating system terminates the
process with no JavaScript error, no log line, and the debugger simply drops.** It presents as
a mysterious crash rather than as an error.

Analysis is gated on media kind at every call site. Video posts get the decorative wave
instead. **Do not remove that gate to "add video support"** — it needs server-side or
streaming extraction, not a client-side download.

**Why not do this on the server?** Edge functions have a hard CPU limit and no media tooling;
full-song decode routinely exceeds it. Ruled out deliberately; do not revisit unless those
limits change.

Analysis runs at upload against the **local** file (no re-download). Older tracks backfill
lazily on first play. All of it is fail-safe — any failure falls back to the decorative wave
and never surfaces an error.

---

## What this pipeline does not do

Stated plainly so nobody assumes capabilities that are not here.

| Not present | Consequence |
|---|---|
| **Adaptive bitrate (HLS/DASH)** | One rendition per upload. Quality does not adapt to connection |
| **Transcoding** | Whatever was uploaded is what plays. No normalised codecs, bitrates, or containers |
| **Signed or expiring URLs** | Anyone with a URL can fetch the media indefinitely, regardless of app-level visibility |
| **A CDN we control** | Caching and geography are whatever the storage provider does |
| **Resumable upload** | A dropped connection restarts from zero — automatically once, then via Try again (see [When the connection fails mid-upload](#when-the-connection-fails-mid-upload)) |
| **Server-side media validation** | Content type comes from the client picker; no server-side allowlist is declared in this repo |
| **Thumbnail/preview generation** | Cover art is uploaded, not derived |

**The visibility gap is the one to understand.** A playlist marked private restricts the
*database rows*. It does not restrict the media object — that URL remains publicly fetchable.
For a social music app this is a meaningful difference between "private" as the product
implies it and "private" as implemented.

### When to revisit

Not now — this is adequate at current scale and the alternatives are expensive. Revisit when
any of these become true:

- Bandwidth cost becomes material, or users on poor connections report stalling → adaptive
  bitrate and transcoding
- Content visibility becomes a product promise rather than a listing filter → signed URLs
- Upload failure rate on large files becomes a real complaint → resumable upload
- Storage egress becomes the dominant cost line → a controlled CDN

Each of those is an architectural decision deserving an ADR, not an incremental change.

## Related

- [playback.md](playback.md) — the engine
- [backend.md](backend.md) — services and error modes
- [../security/model.md](../security/model.md) — what storage policies do and do not cover
- [../operations/scaling-assumptions.md](../operations/scaling-assumptions.md)
