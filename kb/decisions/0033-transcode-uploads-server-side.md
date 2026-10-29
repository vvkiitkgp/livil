---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-26
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [ADR-0004]
---

# ADR-0033 — Transcode heavy uploads server-side, on GitHub Actions, into a sibling rendition

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-10-26 |
| **Domain** | platform |
| **Decided by** | human (owner) |

---

## Context

The app plays uploads exactly as the phone recorded them. On 2026-10-26 the newest video
was 2160×3840, 60 fps, HEVC at **38 Mbit/s** (127 MB for 27 seconds); three more were
15 Mbit/s; five songs were uncompressed WAV at 1.4–2.3 Mbit/s. A phone on 4G sees
5–20 Mbit/s. Those posts buffered endlessly for everyone, and each play of the 4K video
cost 127 MB of egress.

The database was never involved: CPU 5 %, 19 of 60 connections, all idle; media is served
by Supabase Storage behind Cloudflare (range requests `cf-cache-status: HIT`). Upgrading the
compute tier would have changed nothing. The owner needed a fix that lands **without a store
release** — backend changes are instant, the app takes a week or more (CLAUDE.md,
"Production compatibility") — and that also repairs the files already uploaded.

Two constraints shaped where the work could run:

- **Supabase edge functions cannot transcode** — 2 s CPU cap, no ffmpeg (already ruled
  out for the waveform decode, CLAUDE.md "Beat-Synced Visualizer").
- **`tracks.audio_url` / `tracks.video_url` are frozen once real**
  (`tracks_freeze_media`, 20260922100000): the served file must be the file the copyright
  scan looked at.

Test encode on the owner's Mac: the 127 MB video → **7.5 MB** (1080×1920, 30 fps,
2.1 Mbit/s) in 26 s, sound track copied byte-for-byte.

## Decision

1. **A worker on GitHub Actions** (`.github/workflows/transcode-media.yml` →
   `scripts/transcode-media.mjs`), every 5 minutes plus `workflow_dispatch` /
   `repository_dispatch`, with the service-role key as a repository secret. The repository
   is public, so minutes are free; ffmpeg ships on the runner image; there is no server to
   keep alive. One run at a time (`concurrency`).
2. **Renditions, not overwrites.** The job uploads the light copy *next to* the original
   (`<uploader>/<track>/video.h264.mp4` or `audio.aac.m4a`) and points the row at it.
   The original is never deleted; `tracks.original_media_url` records it, so undo is a
   service-role write back. The CDN never serves a stale half-swapped file, and a device
   that cached the old URL keeps playing.
3. **Encode targets:** video → H.264, longest edge ≤ 1920, 30 fps, CRF 23 capped at
   4 Mbit/s, `+faststart`, **sound track copied untouched** whenever mp4 can carry it
   (AAC/MP3/AC-3/ALAC; otherwise AAC 192k). Audio → AAC 256 kbit/s in m4a. A file that is
   already H.264 ≤ 1080p ≤ 30 fps ≤ 6 Mbit/s, or lossy audio ≤ 400 kbit/s, is marked
   `skipped` and left alone. A rendition that is not smaller, or not the same length
   (±1.5 s), is refused.
4. **The database names the one permitted swap** (20261115000000): `tracks_freeze_media`
   lets *only* the service role replace a real URL with one in the **same bucket folder**,
   and *only* while writing `original_media_url`. Clients remain fully frozen. Four
   nullable ledger columns (`transcode_status`, `transcoded_at`, `transcode_error`,
   `original_media_url`) are the service role's; a client's values are ignored by trigger.
   Pinned by `supabase/tests/rls/transcode-renditions.test.sql`.
5. **Coordinates are unchanged.** Duration, `waveform_peaks`, clip windows (absolute
   seconds) and thumbnails all describe the same timeline, so nothing downstream moves.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Bigger Supabase compute (more RAM/CPU) | The database is idle and not in the media path. Pure cost. |
| Overwrite the original object in place (same URL) | Destroys the file the copyright scan saw; up to an hour of CDN staleness; a phone mid-playback can read mismatched bytes across the swap. Reversibility only by keeping a copy anyway. |
| Compress on the phone before upload | Right long-term and in progress as a separate change, but it needs a native module plus a store release and never repairs what is already uploaded. Complementary, not a substitute. |
| Supabase edge function | 2 s CPU cap, no ffmpeg. Already ruled out for decode. |
| Cloudflare Stream / Mux (managed adaptive HLS) | Best at real scale: per-minute billing, a new account, video-only (audio still needs a path), and an HLS playback path the shipped apps have never exercised. Revisit when traffic justifies it. |
| A long-lived ffmpeg worker (Fly.io / Railway / VPS) | A server to pay for and keep patched for a job that runs a few minutes a day. Same shape as the Actions worker; adopt it if GitHub's scheduling becomes the bottleneck. |
| A new `stream_url` column the app prefers | Shipped apps do not know the column, so current users keep buffering — the exact problem. |
| Widening `tracks_freeze_media` to "service role may do anything" | The service role already can (it could drop the trigger). Naming the one intended shape — same folder, original recorded — makes an accidental or compromised swap to arbitrary media fail loudly instead of silently succeeding. |

## Consequences

- Every upload plays as the heavy original for ~5–10 minutes (GitHub's schedule floor plus
  queue delay), then switches on the next feed load — when the schedule fires. GitHub runs a `schedule`
  best-effort (observed here: every 4–7 hours, not 5 minutes), so since 20261117000000 an
  upload post rings the doorbell itself: an AFTER INSERT trigger on `posts` sends a
  `workflow_dispatch` (`ref: main`) through pg_net with a Vault token, at most once a minute
  (a burst of uploads collapses to one call; a pg_cron flush sends the held one next minute)
  (`github_transcode_dispatch_token`, fine-grained, "Actions: write" only — not
  `repository_dispatch`, whose `contents: write` token could push to this public repo).
  The schedule stays as the backstop; a missing secret or a failed call is a WARNING and
  never fails the upload.
- Storage holds two copies of each heavy upload. Originals could be pruned later; today
  nothing deletes them, by design.
- Production now depends on a GitHub repository secret (`SUPABASE_SERVICE_ROLE_KEY`). The
  workflow must never gain a `pull_request` trigger — a PR's copy of the script would run
  with the production key.
- `file_size_bytes` is updated to the rendition's size (the creator dashboard shows it).
  `track_copyright_scans.scanned_media_url` still names the original, which still exists.
- A scheduled workflow is disabled by GitHub after 60 days without repository activity.
  This repository is active; if that ever changes, the job silently stops.

## Dissent

*None recorded.*

## Revisit when

- Traffic makes the 5-minute lag or the per-run batch (20 tracks) a visible problem →
  add the dispatch trigger, then consider Cloudflare Stream.
- Phones routinely sit on connections where even ~2–4 Mbit/s buffers → adaptive HLS.
- The on-device compression ships and the job is marking nearly everything `skipped` →
  it can drop to hourly.
- GitHub changes Actions pricing for public repositories.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
