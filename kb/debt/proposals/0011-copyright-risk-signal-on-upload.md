---
tier: 4
owner: chief-architect
consumers: [CA, TR, ALL]
last_verified: 2026-09-14
verify_every: 30d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004]
---

# PROP-0011 — A copyright **risk signal** on audio upload, not a gate

| | |
|---|---|
| **Status** | **Draft** — awaiting human ratification |
| **Date** | 2026-09-14 |
| **Domain** | data, with security, platform and client |
| **Addresses** | The `'upload'` source left unbuilt in `20260907000000_terms_acceptance_log.sql`; Google Play UGC policy; DMCA §512 safe-harbour posture |
| **Jira** | — *(added on ratification)* |

---

## Problem

Livil accepts arbitrary audio and video from any signed-in user and publishes it to a public
feed, a public search index, and a public share page (`livil-music.com/p/<postId>`). Nothing in
the pipeline asks whether the uploader has the right to distribute what they uploaded.

Observable consequences today:

- **No detection.** A user can upload a commercially released recording and it is served
  indefinitely, at a public URL, with no signal anywhere in the system that this happened.
- **No record of a claim.** `terms_acceptances` records agreement to the Terms at signup, and its
  own migration comment states the intent — *"they accepted at signup and confirmed ownership on
  every upload since"* — but deliberately omits the `'upload'` source because the schema could
  not yet demonstrate the claim. So there is no per-upload assertion of rights.
- **No review surface.** `ops_reports_overview()` covers user-submitted reports of posts,
  comments and stories. Nothing covers rights complaints, and there is no queue a takedown
  request could land in.
- **No repeat-infringer record.** DMCA §512(i) conditions safe harbour on adopting *and
  reasonably implementing* a repeat-infringer termination policy. There is no table that could
  evidence implementation.

The asymmetric risk is not the first infringing upload. It is that the system cannot currently
answer, for any track, "did anyone ever look at this, and what did they conclude?"

## Why now

Three things make this the right moment and not an arbitrary one:

1. **The app is live in production** (Play Store, full rollout, 176 countries). The population of
   uploaders is no longer people the maintainer knows.
2. **`terms_acceptances` already reserved the slot.** The per-upload attestation is a two-column
   change to a table written eight days ago, whose own comment specifies exactly what it needs:
   the `'upload'` value, a `track_id`, a `(user_id, version, track_id)` index, and an explicit
   ruling on deletion. That work is cheap now and gets more expensive as the table accumulates
   rows.
3. **Detection creates a duty, so it must ship with the review queue.** A platform with *actual
   knowledge* of specific infringing material and no process for acting on it is in a worse
   position than one with no detection at all. This is the single strongest argument for building
   the queue and the signal in the same change, and against shipping a detector alone.
   **This point needs a lawyer's read, not an engineer's** — see *Risk*.

---

## Vendor evaluation

### What was actually verified, and what was not

Pricing for both incumbent vendors is **behind a login or a sales call**. The figures below are
the best public evidence available on 2026-09-14 and are explicitly *not* a quote. Confirming
them is Phase 0 work, not an assumption to build on (Constitution §8, *Evidence before opinion*).

| | ACRCloud | Audible Magic | Pex (Vobile) | AudD | AcoustID / Chromaprint |
|---|---|---|---|---|---|
| **Self-serve signup** | **Yes** — 14-day trial, no card | **No** — sales contact only | No — contact required | **Yes** — free quota | Yes, open source |
| **API shape** | HMAC-SHA1 Identification API (sample *or* precomputed fingerprint); bearer-token File Scanning + Console APIs | Enterprise identification + Fulfillment Content API | SDK submits fingerprint hashes; match returned in ≤5 s | REST, file or URL | Local fingerprint + free lookup API |
| **Whole-file scan** | **Yes** — File Scanning, traverse or points policy, results by **callback** | Yes | Yes | Yes | No (whole-file hash) |
| **Rights metadata** | ISRC, UPC, Spotify/Deezer/YouTube IDs via *3rd Party ID Integration* (opt-in) | **Strongest** — licensed directly from rightsholders | Recording **and composition**, plus AI-generated-music detection | Basic metadata + ISRC | MusicBrainz IDs only — **no ownership data** |
| **Catalogue** | Claims **150 M+** tracks | Industry reference set; labels register directly | Large; indexes 40+ platforms | Smaller than ACRCloud | MusicBrainz — poor current-commercial coverage |
| **Covers / modified audio** | Cover identification offered | Yes | **Melody matching**; matches segments ≥1 s, survives crop/compression | Limited | **No** — near-exact only |
| **Published price** | Package-based, CNY-denominated: ~¥320 / 10 k recognitions (≈ US$0.0045 each), ¥3 200 / 100 k, ¥30 000 / 1 M. **File scanning priced separately, not public.** | **None published.** Quote by phone | Historically free to platforms with a licensing revenue share; post-acquisition tracking quoted "from $1 per file per month" | **$5 / 1 000**, ≈$2 / 1 000 at volume; 300 free requests; streams $45/mo | Free |
| **Rate limits** | Not published; region endpoints (`identify-eu-west-1`, `api-v2`) | Not published | Not published | Not published | Courtesy limits |
| **Verdict** | **Recommended for v1** | Right answer at a later scale | **Strategic option** — revisit when licensing/monetisation is on the roadmap | **Fallback / second opinion** | **Not a copyright signal** |

### Why ACRCloud for v1

- It is the only credible vendor a solo maintainer can **evaluate without a sales cycle**: trial,
  no card, full API access. Everything else requires committing before measuring, which inverts
  the order this organisation works in.
- The **File Scanning API takes the whole file and returns matches by callback**, which fits the
  architecture below with no client change and no audio slicing on our side.
- **3rd Party ID Integration returns ISRC**, which is the hinge of the whole design: an ISRC is
  what lets an uploader's "this is *my* release" claim be checked mechanically rather than by a
  human squinting at two waveforms.
- Per-recognition cost is low enough that the decision is not cost-driven at our volume.

### Why not Audible Magic *yet*

Audible Magic is the higher-accuracy, higher-trust option — its database is registered directly by
rightsholders, which is precisely the data ACRCloud has to infer. That is the right vendor for a
platform with licensing deals and a legal team. It is the wrong vendor for a product that cannot
get a price without a phone call, and whose commercial terms are enterprise-shaped. **Revisit when
any of these becomes true:** a label or distributor relationship exists; a rightsholder disputes a
decision we made on ACRCloud data; or monthly uploads exceed ~50 k.

### Why not build our own

The hard part of copyright detection is not the fingerprint algorithm — open implementations exist
and are well understood. The hard part is **the reference database and its rights metadata**, which
is a licensing business, not an engineering one. AcoustID demonstrates the failure mode exactly: it
will happily tell you a file is MusicBrainz recording `x`, and cannot tell you who owns it.

---

## Proposal

### The core commitment

**Detection produces a signal attached to a track. It never blocks a publish, and it never
deletes anything.** The only actor that can suppress or remove content is a human in the review
queue, or a valid legal notice.

This is not timidity. Livil's core use case is *musicians uploading their own music* — and a
musician's own released track **will match**, because it is in the vendor's database under their
own ISRC. A system that auto-blocked on match would be broken for exactly the users it exists to
serve. The match is evidence, not a verdict.

### Status model

One column on `tracks` carries the state, and the set of legal values is small enough to reason
about (Constitution §15, *illegal states unrepresentable where you can, detectable where you
cannot*):

| `copyright_status` | Meaning | Who writes it | User-visible effect |
|---|---|---|---|
| `pending` | Uploaded, not yet scanned | default | none |
| `scanning` | Sent to provider, awaiting result | edge function | none |
| `clear` | Scanned, no match above threshold | edge function | none |
| `review` | Match found; awaiting a human | edge function | **Out of Search and Home candidates.** Still visible to the uploader and on their profile. Uploader sees why, and can claim rights. |
| `allowed` | A human, or a verified ISRC self-claim, cleared it | review RPC only | none — full distribution restored |
| `blocked` | A human upheld the match, or a valid notice landed | review RPC only | Post hidden everywhere except the uploader's own view; media unpublished; strike recorded |
| `error` | Provider failed after retries | edge function | none — **fails open** |

`error` **fails open by design.** A vendor outage must not silently stop a musician publishing
their own work. The failure is visible in the ops queue, not to the user.

### Flow

```
UploadScreen / web Upload
  │  user ticks the rights attestation  ─────────────► terms_acceptances (source='upload', track_id)
  │  createTrack()
  ▼
tracks row  (copyright_status = 'pending')
  │
  │  AFTER INSERT trigger  (pure SQL — no outbound HTTP; pg_net is NOT installed on this project)
  ▼
track_copyright_scans  (state = 'queued')
  │
  │  drained by: (a) best-effort client invoke right after upload — fast path
  │              (b) a scheduled sweep — the guaranteed path
  ▼
Supabase Edge Function  `copyright-scan`     [holds the provider secret — Constitution §18]
  │   POST provider File Scanning: { url: <public media url>, callback_url: … }
  ▼
provider fetches the media, fingerprints, matches
  │
  ▼
Supabase Edge Function  `copyright-scan-callback`   [shared-secret authenticated]
  │   writes track_copyright_matches, derives risk, sets tracks.copyright_status
  ▼
'clear'  ──► nothing happens, which is the common case
'review' ──► ops_copyright_queue()  +  uploader notified in-app
```

**The queue row is the source of truth, not the client call.** A client that skips the fast-path
invoke loses nothing: the sweep picks the row up. This matters because the client cannot be
trusted to volunteer itself for inspection (Constitution §16, *the perimeter is the database, not
the client*).

### Why the media URL and not an on-device fingerprint

The brief asked for fingerprints on the wire. Two options were weighed:

| | **A — provider fetches our URL** *(recommended for v1)* | **B — on-device fingerprint/PCM probe** |
|---|---|---|
| Client change | **None** | Native SDK, or reuse of the existing `decodeAudioData` path |
| Native rebuild | No | **Yes** |
| Risk to the patched playback engine | **None** | Non-trivial — a second audio-side native dependency next to `react-native-video@6.19.2` and the OOM-sensitive decode path |
| Bandwidth | Provider pulls tens of MB | A few KB |
| Cost shape | Per duration scanned | **Fixed per upload** |
| Coverage | **Whole file**, traverse scanning | Only the sampled windows |

**A is recommended** because the media already sits at a public URL (a documented consequence of
ADR-0004: *"Storage objects are public URLs"*), so sending the URL discloses nothing that is not
already disclosed, and it needs zero native work. `react-native-video` is pinned, patched, and
hard-won; putting a fingerprinting SDK next to it to save bandwidth we are not short of is a bad
trade today.

**B becomes the right answer when** the provider's duration-based scanning bill exceeds roughly
US$100/month, *or* uploads exceed ~10 k/month — at which point a fixed per-upload cost wins and
the native work pays for itself. Record the measurement before doing the work.

### Deriving the risk signal

Not "score > N". The rule reads the whole context:

```
match_score          -- provider confidence, 0..100
matched_seconds      -- how much of OUR audio matched
coverage             -- matched_seconds / track duration
attested             -- did the uploader tick the rights attestation
claimed_isrc         -- did they claim an ISRC, and does it EQUAL the matched ISRC
```

- **`clear`** — no match, or `match_score` below threshold, or `matched_seconds` below a floor
  (a two-second incidental match is noise).
- **`allowed` (automatic)** — the uploader claimed an ISRC at upload **and it equals the ISRC the
  provider returned**. This is the single highest-value rule in the design: it clears the
  "musician uploads their own released track" case without a human ever being involved. It is
  *not* proof — an ISRC is guessable — so the auto-clear is recorded, auditable, and revocable.
- **`review`** — everything else above threshold.

Thresholds are **configuration, not code**, and start deliberately conservative (few flags, high
precision) because the cost of a false positive here is a musician being told their own song is
stolen.

---

## Database changes

All migrations land in `supabase/migrations/**`, which `.claude/autonomy-config.yml` marks
writable **with mandatory `security-reviewer` review**.

### 1. Status on `tracks`

```sql
alter table public.tracks
  add column if not exists copyright_status text not null default 'pending'
    check (copyright_status in
      ('pending','scanning','clear','review','allowed','blocked','error')),
  add column if not exists copyright_checked_at timestamptz;

-- The queue view and the feed filter both want "not clear", which is the small set.
create index if not exists tracks_copyright_open_idx
  on public.tracks (copyright_status, copyright_checked_at desc)
  where copyright_status in ('review','error');
```

**No client may write this column.** The existing `tracks` update policy must be narrowed to
exclude it (a column-level `GRANT`, or a trigger that rejects a client-originated change), or the
status is decorative.

### 2. `track_copyright_scans` — one attempt per provider per track

```sql
create table if not exists public.track_copyright_scans (
  id              uuid primary key default gen_random_uuid(),
  track_id        uuid not null references public.tracks(id) on delete cascade,
  provider        text not null check (provider in ('acrcloud','audd')),
  state           text not null default 'queued'
                    check (state in ('queued','sent','returned','failed')),
  provider_job_id text,                -- vendor's file id; what a support ticket quotes
  attempts        smallint not null default 0 check (attempts <= 5),
  requested_at    timestamptz,
  responded_at    timestamptz,
  error_code      text,
  raw             jsonb,               -- vendor payload, pruned after 90 days
  created_at      timestamptz not null default now()
);

create unique index if not exists track_copyright_scans_one_live
  on public.track_copyright_scans (track_id, provider)
  where state <> 'failed';

create index if not exists track_copyright_scans_drain_idx
  on public.track_copyright_scans (created_at)
  where state = 'queued';
```

`attempts <= 5` is the bound (Constitution §22, *bounded by default*) — a track that fails five
times goes to `error` and the ops queue, not into a retry loop with a vendor bill attached.

### 3. `track_copyright_matches` — what was matched

```sql
create table if not exists public.track_copyright_matches (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references public.track_copyright_scans(id) on delete cascade,
  track_id          uuid not null references public.tracks(id) on delete cascade,
  title             text,
  artist            text,
  album             text,
  label             text,
  isrc              text,
  upc               text,
  score             numeric(5,2) not null check (score between 0 and 100),
  matched_seconds   numeric(10,3),
  our_offset_sec    numeric(10,3),
  their_offset_sec  numeric(10,3),
  created_at        timestamptz not null default now()
);
```

`track_id` is denormalised so RLS and the queue do not need a join through `scans`.

**Every text column here is untrusted third-party input** (Constitution §19). It is rendered in
`/studio/ops` and must be escaped there exactly as `web/api/share.ts` escapes user-authored
titles and captions.

### 4. Proof of rights — `track_rights_claims`

```sql
create table if not exists public.track_rights_claims (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid not null references public.tracks(id) on delete cascade,
  claimant_id  uuid not null references public.profiles(id) on delete cascade,
  basis        text not null check (basis in
                 ('original_work','own_release','licence','permission','public_domain','other')),
  isrc         text check (isrc is null or isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  statement    text check (char_length(statement) <= 2000),
  evidence_path text,          -- object key in a PRIVATE bucket. Never a public URL.
  state        text not null default 'submitted'
                 check (state in ('submitted','accepted','rejected','withdrawn')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles(id) on delete set null
);
```

> **`evidence_path` must point at a PRIVATE bucket, read through a signed URL.** ADR-0004 records
> that storage objects in the existing buckets are public URLs — policies gate writes, not reads.
> A distribution contract or a label's permission email placed in `tracks-media` would be
> world-readable to anyone who guessed the path. This is the single most likely way to turn a
> copyright feature into a data-protection incident.

### 5. The per-upload attestation — closing the TODO in `terms_acceptances`

The migration comment specifies what is required; this supplies all four parts.

```sql
alter table public.terms_acceptances
  add column if not exists track_id uuid references public.tracks(id) on delete cascade;

alter table public.terms_acceptances drop constraint terms_acceptances_source_check;
alter table public.terms_acceptances add constraint terms_acceptances_source_check
  check (source in ('signup','reaccept','upload'));

-- The value and the column cannot drift apart: an 'upload' row names an upload, and
-- a non-upload row never does.
alter table public.terms_acceptances add constraint terms_acceptances_upload_shape_check
  check ((source = 'upload') = (track_id is not null));

-- Bounds the new row type, as the original migration required before admitting it.
create unique index if not exists terms_acceptances_one_per_upload
  on public.terms_acceptances (user_id, version, track_id)
  where source = 'upload';
```

**Ruling on the open question the original migration left** — *should deleting a track destroy its
ownership confirmation?*

**It should not, and the schema is arranged so the question rarely arises: a takedown is a status
change, never a `DELETE`.** `blocked` unpublishes the media and hides the post; the `tracks` row
survives, so the attestation survives with it. `on delete cascade` therefore only fires when the
*uploader* deletes their own track — where the existing posture already holds, and where deletion
is the user's own act rather than ours. The alternative, `on delete set null`, was rejected: it
would leave `'upload'` rows that name no upload, which is exactly the unbounded, unprovable row
the original author refused to admit.

### 6. Repeat-infringer record — `copyright_strikes`

```sql
create table if not exists public.copyright_strikes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  track_id   uuid references public.tracks(id) on delete set null,
  reason     text not null check (reason in ('review_upheld','rights_notice')),
  notice_ref text,
  issued_at  timestamptz not null default now(),
  expires_at timestamptz,          -- strikes age out; 12 months is the proposed default
  issued_by  uuid references public.profiles(id) on delete set null
);
```

This table exists to make "we reasonably implement a repeat-infringer policy" a statement the
database can support rather than a sentence in the Terms. No automatic termination in v1 — the
threshold reaching alerts a human.

### 7. Row-level security

| Table | `select` | `insert` | `update` / `delete` |
|---|---|---|---|
| `track_copyright_scans` | uploader of the track, **own rows only**; ops via definer RPC | none (trigger writes it) | none for clients |
| `track_copyright_matches` | uploader of the track; ops via definer RPC | none | none |
| `track_rights_claims` | claimant's own; ops via definer RPC | own, `claimant_id = auth.uid()`, and only for a track they uploaded | claimant may `withdraw` only; state transitions otherwise ops-only |
| `copyright_strikes` | **own only** | none | none |

The uploader **must** be able to read their own matches. A flag they cannot see the reason for is
not a signal, it is an accusation.

Service-role writes happen only inside the two edge functions.

### 8. Feed and search integration

`public.fetch_home_feed(...)` and the search path must drop posts whose track is `review` or
`blocked` — with the uploader's own posts exempt, so a musician always sees their own work.
Verified by an addition to `supabase/tests/rls/feed-candidates.test.sql`.

---

## Manual review flow

### The queue

A new definer RPC mirroring the shape `ops_reports_overview()` already established — definer
because the tables are deny-all, `is_ops()` checked **inside** the body because definer rights
bypass RLS, returning **empty** rather than raising so `/studio/ops` needs no route guard:

```sql
public.ops_copyright_queue(p_include_reviewed boolean default false)
  returns table (
    track_id, title, uploader_id, uploader_username, uploaded_at,
    copyright_status, top_match_artist, top_match_title, top_match_isrc,
    top_match_score, matched_seconds, coverage,
    attested boolean, claim_basis text, claim_isrc text, claim_statement text,
    reviewed_at, reviewed_by, reviewer_username
  )
```

Deliberately carrying **more state than `ops_reports_overview()`**, whose migration argued against
a status enum until a second moderator made the distinction real. That argument does not transfer:
a copyright review has an *outcome that changes what users see*, so "was it looked at" is not
sufficient — `allowed` and `blocked` must be distinguishable by the system, not just by a person's
memory. Recorded here because it is a deliberate departure from a documented precedent.

### The decision

```sql
public.ops_copyright_decide(
  p_track_id uuid,
  p_decision text,   -- 'allow' | 'block' | 'need_info'
  p_note     text
)
```

- **`allow`** → `copyright_status = 'allowed'`, `reviewed_at/by` stamped, distribution restored.
  The common outcome, because the common case is a musician uploading their own work.
- **`block`** → `copyright_status = 'blocked'`, post hidden, media unpublished, **strike issued**,
  uploader notified with the matched title/artist and the appeal path. **The track row is not
  deleted** — see §5 above.
- **`need_info`** → uploader is asked for a rights claim; the item stays open, clock paused.

### What the reviewer sees

In `/studio/ops`, one row expands to: our audio and the matched recording playable side by side,
the matched offsets, the uploader's attestation and any claim with its evidence (via signed URL),
the uploader's strike history, and the raw provider payload behind a disclosure.

### Edge cases the flow must handle by design

| Case | Handling |
|---|---|
| **Musician uploads their own released track** | Auto-`allowed` on ISRC self-claim match; otherwise the commonest `allow` in the queue. **This is the majority case, not an edge case.** |
| **Cover version** | Matches the original recording. Recording rights are not composition rights — a human decision, flagged as such in the queue. |
| **DJ mix / live set** | Many partial matches. Coverage-based, not count-based, so it lands in `review` once rather than fifty times. |
| **Sample or interpolation** | Short `matched_seconds` — below the floor it is `clear` by design. A sample-clearance regime is explicitly out of scope. |
| **Public-domain recording** | Claim basis `public_domain`; human decision. |
| **Provider false positive** | `allow`, and the case joins the labelled corpus so the threshold can be re-tuned against it. |
| **Rightsholder complaint on a `clear` track** | Arrives through the notice path, not the scanner. Lands in the same queue with `reason = 'rights_notice'`. |
| **Vendor outage** | `error`, fails open, visible to ops only. |

### Service levels and appeal

- Review within **72 hours** of entering `review`; a track sitting longer escalates in the queue.
- A `blocked` decision is appealable by submitting a rights claim, which reopens the item.
- Formal counter-notification under §512(g) is **out of scope for v1** and handled by hand.

---

## Implementation plan

Each phase is independently verifiable, and **Phase 0 can kill the whole proposal**.

1. **Phase 0 — Measure before building.** Trial accounts with ACRCloud and AudD. Assemble a
   **60-track labelled corpus**: 20 commercial releases, 20 original/unreleased tracks from
   consenting users, 10 covers, 10 hard cases (live, remix, pitch/tempo-shifted, spoken word over
   a music bed). Measure precision, recall and per-scan cost per vendor. **Gate: precision on
   `review` ≥ 0.95 on the corpus, and a confirmed price.** No production code. No schema change.
2. **Phase 1 — Schema.** Migrations 1–7 above, plus the RLS tests. Ships behind no user-visible
   behaviour. Mandatory `security-reviewer` review.
3. **Phase 2 — Shadow mode.** Edge functions live; every new audio upload is scanned and scored;
   **nothing is suppressed and no user is told anything.** Run 2–4 weeks. Compare the signal with
   reality on real uploads. **Gate: measured false-positive rate on real traffic.**
4. **Phase 3 — Attestation.** The rights checkbox and optional ISRC in `UploadScreen` and the web
   `Upload` screen, writing `terms_acceptances(source='upload')`. Still no suppression.
5. **Phase 4 — Ops queue.** `ops_copyright_queue()` / `ops_copyright_decide()` and the
   `/studio/ops` tab. **The queue ships before the signal has any effect.**
6. **Phase 5 — Signal live.** `review` suppresses discovery; uploader sees status and can claim
   rights; strikes recorded.
7. **Phase 6 — Backfill.** Existing catalogue scanned oldest-first at a rate-limited trickle.

Order is deliberate: **the ability to review precedes the ability to flag.**

## Scope boundaries

Explicitly **not** included:

- **No automatic blocking, deletion, or account termination.** Ever, in this proposal.
- **No monetisation, licensing, or revenue-share.** That is the Pex conversation, later.
- **No video-specific handling beyond passing the file to the provider.** No client-side video
  decode — the `OutOfMemoryError` lesson in the visualizer stands, and nothing here downloads
  media on device.
- **No sample-clearance regime.**
- **No AI-generated-music detection**, though the chosen vendor path keeps it reachable.
- **No formal DMCA counter-notice automation.**
- **No on-device fingerprinting in v1** — deferred with a named trigger.
- **No change to playback, the native patch, or `react-native-video`.**

## Risk

| Risk | Detection | Reversibility |
|---|---|---|
| **False positives on musicians' own music** — the dominant risk | Shadow mode measures it before any user sees a flag; ISRC self-claim auto-clears the common case | Fully — thresholds are config; `allow` restores instantly |
| **Detection creates a duty we cannot meet** — knowing about infringement and not acting is worse than not knowing. **Needs counsel, not an engineer's judgement.** | Queue age monitoring | Reversible only before launch — hence Phase 0 |
| Vendor price shock or shutdown | Cost measured per 100 uploads from Phase 2 | `provider` column and retained `raw` payloads keep the schema vendor-neutral |
| Evidence documents in a public bucket | Caught in security review of migration 4 | **Not reversible after exposure** — this is why it is called out twice |
| Scan abuse (using Livil as a free music-recognition service) | Per-user daily scan cap | Reversible |
| Vendor callback spoofing | Shared-secret auth + the job id must map to a `sent` scan row | Reversible |
| Schema churn on `tracks` | Migration review | `tracks` is hot; the added column is nullable-by-default and indexed partially |

## Verification

- **Phase 0:** precision/recall per vendor on the labelled corpus, published in this document
  before Phase 1 starts.
- **Phase 2:** measured false-positive rate on real uploads. A rate above the Phase 0 gate stops
  the rollout rather than proceeding with a caveat.
- **RLS tests** in `supabase/tests/rls/` (new `copyright-signal.test.sql`): uploader reads own
  scan and matches; a second user reads neither; a non-ops caller gets an **empty** queue, not an
  error; a client `update` of `tracks.copyright_status` **fails**; evidence objects are not
  publicly readable.
- **Feed test** in `feed-candidates.test.sql`: a `review` track is absent from `fetch_home_feed`
  for other users and **present** for its uploader.
- **Cost:** provider spend per 100 uploads, recorded in `kb/operations/third-party.md`.
- **Queue health:** no item older than 72 hours.

## Alternatives

| Alternative | Why set aside |
|---|---|
| **Do nothing — notice-and-takedown only** | Genuinely defensible: DMCA §512 does not require proactive filtering, and the EU DSM Art. 17 lighter regime covers services under three years old with revenue under €10 M and fewer than 5 M monthly users — which describes Livil today. **This is the honest baseline, and if Phase 0 fails its gate, this is the outcome.** It loses the ability to answer "did anyone look at this?" |
| **Auto-block on match** | Breaks the core use case — a musician's own released track matches. Converts a vendor's confidence score into a product decision about somebody's livelihood. |
| **Block only above a very high score** | Same failure, narrower. A high score on a musician's own release is the *expected* result, not an anomaly. |
| **Build our own fingerprinting** | The algorithm is the easy half; the reference database with rights metadata is a licensing business. AcoustID shows the failure mode — it identifies a recording and cannot say who owns it. |
| **Audible Magic first** | Best data, no self-serve price, enterprise contract shape. Evaluating it costs a sales cycle before a single measurement. Named as the upgrade path with explicit triggers. |
| **Pex / Vobile Attribution Engine first** | Strategically the most interesting — composition *and* recording, melody matching, and a licensing story rather than only a blocking story. Set aside for v1 because its post-acquisition commercial terms need confirming and it is aimed at platforms that license, which Livil does not yet do. |
| **Scan on play instead of on upload** | Cost scales with plays rather than uploads — strictly worse — and delays the signal past the moment it is useful. |
| **Client-side fingerprinting in v1** | Native rebuild and a new audio-side dependency beside the patched playback engine, to save bandwidth we are not short of. Deferred with a named cost trigger. |

---

> **This proposal requires human ratification before becoming work.** Phase 0 is a measurement
> exercise whose result may be "do nothing", and that outcome is a success, not a failure.
