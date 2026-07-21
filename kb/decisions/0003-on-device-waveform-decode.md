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

# ADR-0003 — Compute waveform data on the device, for audio only

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | ~2026-06 (backfilled 2026-07-21) |
| **Domain** | playback |
| **Decided by** | Human |

---

## Context

The floating player's wave should follow the song's actual loudness and frequency content
rather than animate decoratively. That needs a loudness envelope for the whole track, indexed
by position.

Three ways to get one: analyse audio in real time as it plays, compute it server-side at
upload, or compute it on the device once and store it.

## Decision

**Compute once, on the device, and store the envelope on the track row.**

Analysis uses the platform's hardware decoder as a **one-shot decode utility** — no audio
context, no playback, no media session — so it never touches the playback engine. Buckets are
computed at roughly ten per second across the full track in absolute seconds, so clipped
reposts index correctly.

At upload, the **local** file is analysed (no re-download). Older tracks backfill lazily on
first play. Every step is fail-safe: any failure falls back to the decorative wave.

**Analysis is gated to audio. Video is never analysed.**

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Real-time analysis** via player audio taps | Would require touching the patched playback engine and would diverge per platform. The engine is the most fragile component in the app; adding a tap to it trades a decorative feature against the core promise |
| **Server-side at upload** (edge function) | **Hard CPU limit and no media tooling.** A full-song decode in WebAssembly routinely exceeds the limit — a four-minute track needs multiple seconds of CPU against a budget measured in low single digits. Ruled out on measurement, not preference |
| Dedicated transcoding service | Disproportionate infrastructure for a visual flourish |
| Ship precomputed data with uploads from a desktop tool | No desktop uploader exists |

## Consequences

**Good:** no server round trip, no infrastructure, and the hardware decoder handles every format
the engine can play — so format support is automatically consistent. Computed once per track,
cached in memory and in the database.

**Costs:**

- First play of an un-analysed track does decode work on the user's device
- **Video posts have no synced wave**, only the decorative one
- The device does work the server could, on a slower and less predictable processor
- One more library in the dependency graph, used for a single function

### The video prohibition is not a preference

`decodeAudioData` on a video URL pulls the **entire file** into memory through the networking
layer. An audio track is a few megabytes; a video is tens to hundreds.

The result is an out-of-memory kill: **the operating system terminates the process with no
JavaScript error, no log line, and the debugger drops.** It presents as a mysterious crash, not
as an error — which is what made it expensive to diagnose.

The gate exists at every call site. **Removing it to "add video support" reintroduces a crash
that produces no diagnostic.**

## Dissent

*None recorded.* The edge-function path was attempted and hit the CPU ceiling, so the decision
was settled by evidence rather than argument (Constitution P8).

## Revisit when

- **Edge compute limits change materially**, or media tooling becomes available there — that is
  the specific condition that ruled the server path out
- A server-side media pipeline is built for another reason (transcoding, adaptive bitrate) — at
  which point waveform extraction is nearly free alongside it
- Video waves become a product requirement — requiring **server-side or streaming-demux
  extraction**, never a client-side download

**Do not revisit** by wiring the audio library in as a player. That would create a second audio
engine and violate [ADR-0001](0001-single-audio-engine.md).
