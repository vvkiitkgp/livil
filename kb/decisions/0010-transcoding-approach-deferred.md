---
tier: 4
owner: principal-platform
consumers: [ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [3, 4, 7]
---

# ADR-0010 — Defer the transcoding choice pending a measurement and a spike; direction is on-device, unbundle R2

| | |
|---|---|
| **Status** | **Deferred** — with a directional recommendation |
| **Date** | 2026-07-24 |
| **Domain** | platform (with data) |
| **Decided by** | Architecture Board — LIV-35 debate |
| **Participants** | principal-platform, principal-data, adversarial-critic |

> **Board recommendation — PENDING FOUNDER RATIFICATION (2026-07-24).** The go/no-go and cost
> trade are the founder's (Constitution P63).

---

## Context

LIV-35 asks the board to choose a transcoding approach. Candidate A (LIV-36): on-device
pre-upload compression/transcode, keep Supabase Storage. Candidate B (LIV-37): an external
transcode worker plus migrating storage to Cloudflare R2.

Facts from the current pipeline (`kb/architecture/media-pipeline.md`, verified 2026-07-21):
there is NO transcoding today, no CDN, no adaptive bitrate; the player always loads the full
file; uploads are streamed (not buffered) specifically because reading a whole file into an
`ArrayBuffer` caused OOM ("Network request failed"); uploads are non-resumable; media URLs are
public (policies gate writes, not reads); 500MB cap; `tracks-media` has a server-side 500MB
limit + 17-entry MIME allowlist. 23 objects exist, all dated 2026-07-07 (the Sydney→Mumbai
migration).

ADR-0004: no API tier of our own; RLS is the only authorization boundary; but "partial exits
are available and cheaper than a rewrite — a thin service for specific operations (signing
URLs, rate-limited endpoints)." A transcode worker is exactly such a partial exit.

ADR-0003: on-device one-shot decode is already a proven, fail-safe pattern here — but it also
produced a silent OOM process-kill when misapplied to video. Full transcode (decode + re-encode)
is strictly heavier than that decode.

`kb/operations/scaling-assumptions.md`: NO instrumentation exists to measure egress or
stalling; the doc names egress as a future dominant-cost cliff but its trigger is "when it
becomes material," and states an agent weighing a performance concern with no measurement must
escalate (P63). `media-pipeline.md`'s own "revisit when" names the two triggers: bandwidth cost
becomes material, OR users on poor connections report stalling.

No on-device transcode dependency exists in `package.json` today (verified: no
ffmpeg/compressor/transcode). `ffmpeg-kit` is archived/retired (inferred, general knowledge).
`react-native-compressor` may use native platform encoders but its RN 0.85.3 + New Architecture
(Fabric) compatibility, native-rebuild footprint, and whole-file-vs-streaming memory behavior
are UNVERIFIED. `patches/**` (react-native-video) is closed to every agent and must not be
touched.

## Decision

1. **DEFER a firm commitment to either candidate.** Two prerequisites are unmet and both are
   cheap relative to the work they gate: (a) NO measurement establishes that transcoding is
   needed — `media-pipeline.md` says it is not needed now, and there is no egress/stalling
   instrumentation to show a trigger has fired; (b) NO spike has confirmed a viable on-device
   transcode library exists for RN 0.85.3 + Fabric without touching the patch. Recommending
   "build A" now would state a conclusion the board lacks the evidence for (Constitution P6,
   P8).
2. **DIRECTIONAL RECOMMENDATION for when this is picked up:** prefer Candidate A (on-device)
   over Candidate B as scoped. Reasons: A composes with the proven ADR-0003 on-device pattern,
   adds no vendor and no operational surface, keeps the RLS perimeter intact, and has
   near-zero data-model churn and zero migration of existing objects. B as scoped reopens
   ADR-0004 (a server to build/deploy/monitor/secure for a solo maintainer, with no CI/monitoring
   scaffolding today), forces a from-scratch R2 access-control model (R2 has no Postgres RLS),
   requires migrating 23 objects + rewriting every media URL, and introduces an async state
   machine the schema lacks (status/original_url/transcoded_url, retry, orphan GC).
3. **UNBUNDLE R2 from transcoding.** B conflates two decisions. The transcode-worker half may
   become necessary later independent of storage (it is the only way to produce an
   adaptive-bitrate ladder or reprocess the existing catalog — neither of which on-device
   single-shot compression can do). The R2 storage migration is a separate decision with its
   own trigger (egress becomes the dominant cost line) and its own ADR, and it strands the
   in-flight PROP-0002 storage-policy versioning. If a server-side transcode worker is ever
   proposed, point it at the existing Supabase Storage (S3-compatible), not at a bundled R2
   move.
4. **Two honesty caveats the founder must carry:** (a) on-device transcode is
   client-controlled — a modified or un-updated client skips it, so A delivers NO
   server-enforced guarantee about what lands in storage (same class as `x-upsert: false` being
   a client header, ADR-0007). If the actual goal is a guaranteed size/codec ceiling rather than
   typical-case reduction, A does not deliver it and a server-side worker is required. (b) A is
   not "~$0 cost" — it spends device CPU/battery/time and adds a silent-failure surface (OOM) in
   front of the already-fragile non-resumable upload, worse on low-end Android. Constitution
   P42: the experience is the requirement.

## Alternatives considered

| Alternative | Why rejected / deferred |
|---|---|
| Recommend Candidate A now, unconditionally | Overstates certainty the board does not have — no library is verified to exist for this stack, and no measurement shows transcoding is needed (P6, P8) |
| Recommend Candidate B (worker + R2) now | Bundles two decisions; the R2 migration is unjustified at current scale, strands PROP-0002, rewrites the storage security model, and migrates 23 live objects — cost with no measured trigger (P23) |
| External transcode worker WITHOUT R2 (point at Supabase Storage) | Legitimate future partial exit (ADR-0004) and the named fallback if on-device proves unviable or a server-enforced guarantee is required — but premature until the measurement + on-device spike are done |
| Do nothing, ever | The two revisit triggers (egress material; stalling reports) are real; when one fires this must be reopened |

## Consequences

**Good:** no vendor is onboarded, no server is stood up, and no storage migration is started on
speculation; PROP-0002 proceeds undisturbed; the RLS perimeter is unchanged.

**Cost / made-hard:** the answer is deferred, so if a trigger fires suddenly the work starts
cold; the founder must fund the (cheap) egress instrumentation and the (small, timeboxed)
on-device spike before a real choice exists.

**Balance note:** if the founder has independent evidence that growth is imminent, front-loading
the transcode-worker half of B is defensible — that is a business bet only the founder can make.

## Dissent

Both principals independently recommended Candidate A; neither re-verified that a viable
on-device library exists (both explicitly flagged it as needing a spike). Recorded as the
shared blind spot the critic surfaced (P10): the board converged on WHICH candidate before
checking WHETHER a decision is due at all.

The adversarial critic's strongest unrefuted point: the debate may be premature — with no
egress/stalling measurement, choosing between A and B speculates about a problem not shown to
exist, and Round 4's honest output is Deferred/Escalate, not Accepted. The board adopts this.

The critic also could not refute that the R2 migration specifically is unjustified today (R2 is
confirmed unused).

## Revisit when

- Egress cost becomes material OR users on poor connections report stalling
  (`media-pipeline.md`'s own triggers) — establish this by instrumenting egress, the cheap
  first step.
- A timeboxed on-device transcode spike confirms (or refutes) a viable RN 0.85.3 + Fabric
  library that streams rather than buffering whole files.
- The founder decides the cost trade and states which problem LIV-35 solves: typical-case
  reduction (A suffices) vs a guaranteed ceiling / adaptive bitrate (needs a server-side
  worker).

## Follow-on work

No implementation proposal is written now — that would presume the deferred choice. The two
cheap prerequisites (instrument egress; timeboxed on-device spike) are the next actions and
belong to the founder's scheduling. LIV-36/37/32 remain gated by this ADR and are NOT
unblocked.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
