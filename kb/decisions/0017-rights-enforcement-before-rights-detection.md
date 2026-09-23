---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-22
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0003, 0004, 0007, 0008, 0012, 0015]
---

# ADR-0017 — Build the enforcement primitives before the rights detector

| | |
|---|---|
| **Status** | **Escalated** — the board declines to decide the product question and records the engineering findings that constrain it |
| **Date** | 2026-09-22 |
| **Domain** | data + security (with platform and client) |
| **Decided by** | Board debate — principal-data, principal-security, principal-platform, principal-client, adversarial-critic. Chief Architect moderating, no technical vote. |
| **Amended in part by** | **[ADR-0018](0018-rights-enforcement-under-campaign-volume.md)** (2026-09-22) — §A, §F, §I, §J, §K and the Dissent are amended there. **Not superseded:** §C, §E's shape, §G and §H stand as written. Do not act on §F's stated argument, §J's cost framing, or §E's ratifiability without reading ADR-0018 first. |

---

## Context

The maintainer asked for a Music Rights & Copyright Verification system in the upload flow:
fingerprint against a commercial provider; on a match, offer a rights-claim path with evidence
documents rather than assuming infringement; a review state; a `/studio/ops` review queue; a
full audit trail; multiple competing claimants with append-only history; a provider-agnostic
adapter; private evidence storage with signed URLs and a retention policy; and a per-upload
ownership confirmation.

The maintainer explicitly asked that the organisation decide the architecture.

### What forced the shape of this decision

**Publication is not a step. It is the existence of a `posts` row.** There is no publish
action, no status column, and no server-side mediation. Two independent clients —
`src/services/tracks.ts::createTrack` and `shared/services/publishTrack.ts::publishTrack`
(ADR-0015) — write directly to PostgREST under row-level security. Per ADR-0004, RLS is not
one authorization layer among several; it is the only one. **Any gate written in client code
is decoration.**

**Production scale, queried live on 2026-09-22.** 38 tracks (34 audio, 4 video). **7 uploads
in the last 30 days.** 60 profiles. **2 `post_reports`, ever.** **1 `ops_users` row — the
maintainer, who also writes the code.** 12 `terms_acceptances`.

**There is no takedown capability at all.** `tracks_delete_own` and `posts_delete_own`
(`00000000000000_baseline_schema.sql:298-299, 312-313`) are the only DELETE policies on those
tables. `ops_reports_overview()` / `ops_mark_report_reviewed()` can mark a report *reviewed*
but cannot remove content. Removing an infringing track today requires the Supabase dashboard,
by hand, by one person. There is no `is_ops` predicate in **any** storage policy (verified:
zero hits across all migrations), so ops cannot delete another user's bytes either.

**The report path cannot express copyright.** All three report tables carry
`check (reason in ('spam','harassment','hate','misinformation','other'))`
(`20260607000007:12`, `20260607000004:76`, `20260808110000:40`). **A rights holder cannot file
an infringement report in-app.** There is no strike, suspension or repeat-infringer table in
any of the 101 migrations.

**Meanwhile Livil publishes three promises with no mechanism behind any of them.** `docs/terms.html`
§5 — *"Accounts that break them repeatedly, or seriously even once, are suspended or terminated."*
§6 and `docs/support.html` §3 — *"We remove infringing content and terminate accounts that
repeatedly infringe."* §6 directs complaints to email; no designated agent is named anywhere in
the repository.

**No provider sells what the brief asked for.** No fingerprinting service returns *"this
uploader is authorised"* — that is a contract between artist and label and is in nobody's
database. The most any provider returns is *"this matches registered recording X"*, plus, for
Audible Magic and Pex/Vobile only, the registrant's standing policy. **The entire rights-claim
workflow is Livil's to build under every branch.** The two providers with rights data are
sales-gated with no published price and are positioned at platforms large enough to be legally
compelled to filter; the two that are self-serve (ACRCloud, AudD — AudD publishes $5/1,000
requests) return identification only. Fingerprinting also misses the dominant social-music
formats: matching degrades sharply past ~±10% pitch/tempo shift, covers and live performances
do not match a master, and AI sound-alikes cannot be caught at all.

**Filtering is not legally required of Livil.** DMCA §512(c) imposes no filtering duty; it
requires a designated agent ($6 filing, 3-year expiry), a published contact, an **actually
enforced** repeat-infringer policy, notice-and-takedown, and counter-notice. EU DSM Art. 17(6)
carves out providers under 3 years in the EU and under €10M turnover — Livil is comfortably
inside it. India adds a named Grievance Officer (24h acknowledge / 15d resolve) and, under
Copyright Rules Rule 75, a **21-day block-then-auto-restore** mechanic that differs in shape
from the DMCA counter-notice and that any takedown tooling must model.

**No execution substrate exists for a scan.** The edge runtime has a 2 s CPU cap (recorded
independently at ADR-0003:52, `backend.md:135`, `media-pipeline.md:112`, PROP-0009:104) and
cannot buffer a 500 MB file; it can only be a dispatcher. Client-side extraction is foreclosed
by ADR-0003's out-of-memory finding. `pg_net`, `pg_cron` and `pgmq` are available in production
but **none is installed**, and `scripts/schema-fingerprint.sql` is scoped
`where nspname = 'public'` (lines 63, 76, 95, 136), so installing any of them creates
production state our own drift detector cannot see.

---

## Decision

### A. ESCALATED — whether to integrate a fingerprinting provider at all

This is risk tolerance and product direction. `kb/product/` does not exist, so the board has no
basis to make it (Constitution P63). The board escalates it **with the engineering cost
attached**, which is what P63 asks for.

> **Question:** Should Livil integrate a commercial audio-fingerprinting provider into the
> upload flow now?
>
> **Position A — the board's unanimous engineering recommendation: no, not first.** No provider
> returns authorisation, so the claim workflow, the review queue, the strike count and the
> takedown actuator are Livil's to build under every branch; a provider shortens none of it.
> There is no tier that can compute a fingerprint (edge 2 s CPU / no ffmpeg; client OOM is
> binding per ADR-0003) and no retry substrate. Detection is supply-driven — it manufactures
> work that scales with uploads — while notice-and-takedown is demand-driven and bounded, and
> the entire moderation capacity is one person.
>
> **Position B — the maintainer's original request:** fingerprint on upload, with a claim path
> on match.
>
> **Precise point of divergence:** not whether detection is valuable, but whether it is the
> *first* increment given that its output currently terminates in a decision nobody can
> execute. The board found no path by which a provider reduces the work that must exist anyway.
>
> **What would resolve it:** a rightsholder complaint Livil cannot currently action; a label or
> distribution relationship that contractually requires filtering; Google Play or App Store
> review raising it; or EU turnover/age crossing the Art. 17(6) threshold.

**The board did not decide this and must not be read as having rejected fingerprinting.**

### B. ESCALATED — the designated agent and grievance contact

Registering a DMCA designated agent (US Copyright Office, $6, 3-year renewal) requires
publishing a **name and physical address**. All three published pages currently point at a
personal Gmail address. India requires a **named** Grievance Officer with a 24h/15d clock.
**This is the cheapest item on the entire table and the only one requiring no code — and it is
the maintainer's call, not the board's**, because it discloses personal information.

### C. DECIDED — read-side gating is rejected

A `posts.visible`-style predicate would have to be hand-copied into every `SECURITY DEFINER`
function that reads `posts`, because RLS is not consulted inside definer bodies. principal-data
counted 16 such functions in Round 1; the critic's independent scan found **18 migration files**
defining them. The one that matters most is `shared_post_public` — definer, **granted to anon**,
keyed by post UUID (`20260901000000_shared_post_public.sql`) — so a "pending" or "blocked" post
would remain fully fetchable by anyone holding the share link unless that function were
separately amended. That is a leak by omission, and omission is how this schema has failed
before.

### D. DECIDED — the converged "gate" was wrong, and the critic caught it

Round 1 produced independent convergence between principal-data and principal-security on a
write-side gate: `tracks.rights_state` plus an insert-side `WITH CHECK` on `posts_insert_own`
plus a `BEFORE UPDATE` freeze trigger. Per Constitution P10 that convergence was put to the
critic rather than to synthesis, **and it did not survive**:

> `WITH CHECK` on INSERT is evaluated **once, at insert**. Flipping `tracks.rights_state` to
> `'blocked'` afterwards has **no effect on rows already in `posts`.** The infringing post keeps
> serving, in every feed and on the share page, forever.

principal-data conceded in cross-examination, naming its own Round 1 trap: with no async
substrate the column must default `'clear'`, and a column that only ever moves clear→blocked by
hand **is a takedown mechanism, not a pre-publication gate. Any document calling it a gate is
lying.** The insert-side `WITH CHECK` survives only in a reduced role — preventing a *blocked*
track from being re-posted or reposted — not as a gate.

**Consequence the maintainer must absorb: a pre-publication hold is not buildable today at any
reasonable cost.** The honest primitive is fast takedown, not prior restraint.

### E. DECIDED — the shape of the takedown actuator (pending one blocking probe)

Hard-delete `posts`; tombstone `tracks`; remove bytes explicitly. One `is_ops()`-gated
`SECURITY DEFINER` RPC on the pattern shipped three days ago in
`20260919010000_ops_tracks_for_user.sql`, which already has an RLS test
(`supabase/tests/rls/ops-track-review.test.sql`) run by CI.

Load-bearing details the board records so they are not rediscovered:

- **The authorization check comes first, before the parameters are read.** `if not public.is_ops()
  then raise exception ... using errcode = '42501'`. Three shipped functions already made the
  opposite mistake (Constitution P17).
- **Reposts must be deleted first and explicitly.** Deleting the upload post alone fires
  `posts.original_post_id ON DELETE SET NULL`, which the freeze trigger's carve-out permits
  (`20260804030000:58-66`) — leaving live reposts still serving the infringing track. **Ordering
  is the whole correctness argument.**
- `trg_posts_freeze_counter_identity` is `BEFORE UPDATE`, so DELETE does not fire it. No conflict.
- **Two guards ship in the same migration:** a `BEFORE UPDATE` trigger freezing the tombstone
  columns against non-ops callers, and a **`BEFORE DELETE` trigger on `tracks` raising 42501 when
  `takedown_at is not null and not public.is_ops()`**. Without the second, `tracks_delete_own`
  lets the infringer delete the tombstone — **the strike ledger erased by the person it counts.**
- `shared_post_public` needs no patch: the row is gone, the function returns zero rows, the share
  page 404s. That is the payoff of deleting rather than flagging.
- **Bytes:** add `or (select public.is_ops())` to `tracks_media_delete_own`, drop-by-name then
  create, wrapped as a subselect so the planner hoists it to an InitPlan. Keep it `to
  authenticated` — `is_ops()` is revoked from `anon` (`20260806040000:39`).

### F. DECIDED — the `ops_reports_queue` precedent is UPHELD, not overruled

`20260808120000_ops_reports_queue.sql:17-22` argues that a status enum for a workflow nobody has
run is a guess. With **2 reports ever** and **1 moderator**, that argument is stronger now than
when it was written. Therefore:

- **The 7-state RightsClaim lifecycle is rejected.** Tombstone columns in the
  `reviewed_at`/`reviewed_by` shape (`takedown_at`, `takedown_by`, `takedown_reason`).
- **`rights_claims` and the append-only claim history are deferred entirely.** principal-data
  proposed them in Round 1 and **withdrew them in cross-examination**.
- **A separate strike ledger is rejected.**
  `select count(*) from tracks where uploader_id = $1 and takedown_at is not null` is the
  repeat-infringer count with zero new tables.
- **The critic's counter-notice objection is recorded and NOT resolved** (see Dissent).

### G. DECIDED — no new Postgres extension, and no new edge function

Extensions live outside the `public` schema and are invisible to `schema-fingerprint.sql`,
reintroducing the ADR-0007/0012 disease one layer down. `pg_net`'s `net._http_response`
auto-vacuums at ~6 h, so failures become observable by nobody.

`scripts/check-edge-functions.mjs` matches deployed functions **by slug only, never content** —
verified running green today (run `35702274651`). A rights-scan function is the worst possible
candidate for an unverified deploy surface, **because its failure mode is reporting "clear" when
it never ran.** **Prerequisite to any future edge function:** pin the Management API's per-slug
`version` integer, which the script already fetches, and assert equality (~15 lines, no new
secret, no new dependency).

### H. DECIDED — no evidence documents in v1

principal-security filed a formal objection in Round 1: *"Asking for a passport scan before you
can serve a signed URL is the version of this feature I would formally object to."*
principal-platform independently supported that objection **over principal-security's own
design**, on the grounds that CI's storage shim declares only `storage.buckets (id, name,
public)` (`ci.yml:170`, duplicated at `:551`) and **structurally cannot represent the property
being asserted.** Livil has **zero `createSignedUrl` callers, ever** — this would be the
first-ever use of an unexercised capability, guarded by a test harness that cannot test it.

**Two further facts make this the right call.** Retention has no enforcement (no `pg_cron`), so
a retention policy would be a sentence in a document, not a control. And DB rows cascade on
account deletion while **storage objects do not** — deleting the row leaves the passport scan
bytes in the bucket forever, silently breaking the "immediate and permanent" promise on
`delete-account.html`. principal-security called this *"the single most likely defect in this
feature."*

**This does not reopen ADR-0007/0012.** The brief's premise that storage config is unversioned
was **stale, and principal-security refuted it with evidence**:
`20260804000000_storage_policies_and_bucket_config.sql:60-101` declares both buckets including
`public`, `file_size_limit` and `allowed_mime_types`. principal-data conceded the point fully in
cross-examination. A private bucket, when it is eventually justified, is the ratified pattern.

### I. DECIDED — the per-upload ownership confirmation, and the ruling the migration deferred

`20260907000000_terms_acceptance_log.sql` explicitly handed the board one question. The board
rules:

1. **Admit `source='upload'`**, together with `track_id uuid references public.tracks(id)` and a
   partial unique index `(user_id, version, track_id) where source = 'upload'`. The existing
   index is already scoped `where source in ('signup','reaccept')` (lines 105-107), so it
   excludes `'upload'` untouched and no applied migration is edited.
2. **RULING: `ON DELETE SET NULL`. Deleting a track must NOT destroy its ownership
   confirmation.** The decisive ground is not the published-promise analogy — principal-client
   showed that analogy does not transfer, since `delete-account.html` drove the account
   precedent and nothing promises the same for a single upload, and principal-data **withdrew**
   that leg. The surviving ground is sufficient on its own: **under CASCADE the attestation is
   destroyed by the infringer, automatically, at the moment of maximum motive** — upload,
   complaint arrives, delete track. That is the worst property this table could have. NULLs are
   distinct in a Postgres unique index, so nulled rows never collide. The row still cascades
   away with the *account*; the record survives the track, not the user, and that asymmetry is
   deliberate.
3. **A hole nobody had flagged must be closed in the same migration.**
   `terms_acceptances_pin_server_fields` (lines 163-172) pins `accepted_at` and `user_id` but
   **would not touch `track_id`** — as written, a client could log an ownership confirmation
   naming a track it does not own. **Ship the pin extension with the column or do not ship the
   column.**
4. **`src/services/terms.ts:17` already types `'upload'` while the DB permits only
   `('signup','reaccept')`.** Calling it today raises Postgres `23514`; `terms.ts:74` swallows
   only `23505`, so it **throws**. Latent, because the only caller is `TermsAcceptScreen.tsx:95`
   — but it compiles, and the type system is actively inviting the bug (P15). Narrow the type
   until the DB admits the value.
5. **Placement:** a confirm step bound to the Publish action, `ConfirmActionModal`-shaped, with
   the track title interpolated — never a checkbox among twelve fields in a 1,342-line
   `UploadScreen.tsx`. **The acceptance row is written inside the same failure envelope as the
   track row**; writing it after the post is live yields a published track with no attestation,
   which is the precise state the table exists to prevent.

### J. DECIDED — the board's recommended first increment

**(b) the enforcement primitives, not (a) a provider integration.** In order:

1. `'copyright'` added to the three `reason` check constraints — one `drop constraint` /
   `add constraint` per table, and the only in-app path a rights holder will ever have.
2. The ops takedown actuator (§E).
3. Tabs in `/studio/ops`. The argument is written in the file itself at
   `web/src/screens/Ops.tsx:336` — *"the queue that gets scrolled past is the queue that rots —
   which is how `post_reports` sat unread for two months."* Tabs also buy lazy fetch.
4. The per-upload attestation (§I).
5. Designated agent and grievance contact — **escalated (§B)**, and the cheapest of all.

**Sequencing note from principal-client, which changes the order:** there is **no
over-the-air update mechanism** — no CodePush, no `expo-updates` anywhere in `package.json`.
"Pure JS" on mobile still means a `versionCode` bump, `bundleRelease`, upload and Play review.
Items 2 and 3 are `web/`-only and ship today; items 1 and 4 ride the next scheduled release.
**Build the actuator before the detector, and build it on the surface that can ship.**

### K. BLOCKING PROBES — nothing in §E may be ratified before these run

1. **Does `is_ops()` work as a `storage.objects` policy predicate, for DELETE?** With the
   predicate added in a branch database, attempt
   `DELETE /storage/v1/object/tracks-media/{another-user}/{id}/audio.mp3` with an ops JWT.
   **If storage DELETE bypasses RLS, the byte half of the actuator collapses and this ADR must
   be amended to say bytes require the dashboard.** Both principal-data and principal-security
   marked this ~90% inferred and **explicitly not probed.**
2. **Does `POST /storage/v1/object/sign/...` enforce RLS?** Deferred with the evidence UI — not
   day-one blocking, but it is the hinge on which any future evidence design turns.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Fingerprint on upload, gate publication on the result** (the original request) | No provider returns authorisation, so the expensive workflow exists under every branch. No tier can compute a fingerprint: edge is 2 s CPU with no ffmpeg, client-side is foreclosed by ADR-0003's OOM finding, and files run to 500 MB. No retry substrate exists — the only available trigger is a client call, which ADR-0008 already rejected as lossy for push. **Escalated, not rejected** — this is the human's call (§A). |
| **`tracks.rights_state` + insert-side `WITH CHECK` as a pre-publication gate** | The critic killed it: `WITH CHECK` is evaluated once at insert, so flipping the column later does nothing to rows already in `posts`. Its author conceded. It removes nothing on day one. |
| **Read-side visibility predicate on `posts`** | Must be hand-copied into 18 migration files' worth of `SECURITY DEFINER` functions, including `shared_post_public`, which is granted to **anon**. A leak by omission. |
| **Soft-hide posts instead of deleting them** | Same 18-function problem. Deleting is what makes the anon share page 404 for free. |
| **Hard-delete the `tracks` row (cascading to posts)** | Correct reach, but destroys the tombstone the repeat-infringer count depends on, and leaves the bytes publicly streamable with no row pointing at them — the takedown would manufacture principal-client's "worst kind" leak. |
| **A 7-state RightsClaim lifecycle with append-only claim history** | A workflow nobody has run, at 2 reports ever and 1 moderator. Upholds `ops_reports_queue`'s precedent. Its own proposer withdrew it in cross-examination. |
| **A dedicated strike/repeat-infringer ledger table** | `count(*)` over track tombstones is the same number with zero new tables. |
| **Private evidence bucket + 5-minute signed URLs in v1** | Untestable: CI's storage shim declares only `(id, name, public)` and cannot represent the property. First-ever use of `createSignedUrl` in this codebase. Retention has no scheduler. Storage objects do not cascade on account deletion. Identity-document compromise is permanent and unrecoverable (P20, P43). |
| **Install `pg_net` / `pg_cron` / `pgmq` for async scanning** | All three live outside `public` and are invisible to `schema-fingerprint.sql` — the ADR-0007/0012 disease one layer down. `pg_net`'s response table auto-vacuums at ~6 h, so failures are observed by nobody. |
| **Supabase Database Webhooks as the async trigger** | Rejected by ADR-0008 on category: the configuration is unversioned production state (P51). That rejection binds here. |
| **GitHub Actions `schedule` as a durable scan drainer** | Proposed by principal-platform in Round 1 and **withdrawn by its own author** in cross-examination: durable retry for ~7 jobs/month, drained by the one person who could read the failures, costs more to operate than the work it schedules. |
| **A new provider-agnostic adapter abstraction** | Zero providers integrated; P25 says the third occurrence justifies the abstraction. The deployed function is already the operational swap boundary — though principal-client correctly notes that a boundary whose contents nothing verifies is a deployment location, not a seam. |
| **AcoustID / Chromaprint as a free alternative** | Identifies known MusicBrainz recordings; carries no rights data and no licence to be used as a copyright gate. It would produce false confidence, **which is worse than no gate.** |
| **Consolidating the two upload clients as a prerequisite** | principal-client demanded it in Round 1 and **withdrew the blocking framing** in cross-examination: real, but independently justified, and bundling it makes the cheapest safety item wait behind a refactor of two 300-line paths. |

---

## Consequences

**Makes easy.** A rightsholder gets an in-app path and a real removal, on a `web/`-only change
that ships without a store release. The repeat-infringer count becomes computable, which is what
§512(i) safe harbour actually requires. Everything recommended lives in the `public` schema, so
it is covered by the daily schema fingerprint and testable by the RLS harness that already runs
in CI.

**Makes hard / forecloses.**
- **A pre-publication hold is off the table** for as long as there is no server tier. The product
  cannot promise "reviewed before it goes live."
- **Takedown destroys captions, comments and counters on the removed posts, irreversibly.** That
  is the price of not hand-patching 18 definer functions, and it is stated here in those words so
  nobody discovers it during an incident.
- **Bytes are a separate, manual step until probe K1 passes.** A blocked track's `audio_url`
  remains world-readable to any signed-in account via `tracks_select_authenticated` (`using (true)`),
  and `tracks-media` public byte reads bypass RLS entirely (probe recorded at
  `20260804010000:31-34`). **"Unpublished" is a metadata state, not a media state, and telling a
  rightsholder otherwise would be false.**
- Adding `'copyright'` to the report reasons will generate reports that a single operator must
  action against a published 24h/15d clock in India. **This creates an obligation on ratification,
  not on completion** (P44).

**Costs not otherwise visible.** Every mobile-side item requires a Play Store release cycle.
`web/src/screens/Ops.tsx` is 684 lines in one component with 20 `useState` slots, all fetched
eagerly on mount; adding a sixth section without tabs makes the rot argument worse.

---

## Dissent

**The critic's counter-notice objection — recorded, unresolved, and the board did not answer it.**
The recommended primitives include the India Rule 75 21-day block-then-auto-restore timer but
**not DMCA counter-notice and 10–14 business-day putback.** A §512(i) repeat-infringer policy
whose strikes cannot be **removed** when a counter-notice succeeds will terminate accounts on
vacated strikes. The critic's words: *"Two values is the right instinct; these are the wrong
two."* **This is the most likely line in this document to prove right later.**

**The critic: "2 post_reports ever" is a measurement artifact being read as a signal.** A
copyright report is *unexpressible* in-app, so zero copyright reports is not evidence of low
rightsholder demand — the instrument cannot record the quantity. The board used the number
anyway, for operator capacity rather than for demand, but the objection stands against any
future use of it as demand evidence.

**The critic: the licence chain has 12 of 60 links, and 38 tracks predate any attestation.**
`terms_acceptances` = 12 against 60 profiles. **48 accounts have never accepted the document
this ADR treats as the rights foundation.** Back-acceptance and back-attestation are unscoped
work nobody named. Recorded, not resolved.

**The critic argued the venue should be a proposal, not an ADR.** Its reasoning: the central
storage mechanism is unprobed, and P4 says rigour scales with irreversibility. The Chief
Architect chose an ADR with status **Escalated** rather than Accepted, on the ground that the
document decides nothing irreversible — it records an escalation, several rejections, and one
ruling the schema explicitly delegated to the board — and that §K makes the unverified parts
blocking rather than assumed. **The critic's objection is recorded; a reasonable reader may
think it was the better call.**

**principal-security's Round 2 cross-examination did not return.** Its Round 1 position is
recorded here unchallenged by the other principals, including its formal objection on evidence
documents (§H) and its correction of the brief (§H, storage config is versioned). The board
notes the gap rather than papering over it (P6). Its two unprobed inferences are precisely what
§K makes blocking.

**principal-data's Round 1 claim that `tracks-media` has no policy migration was false**, and
the record should show it was refuted by principal-security and conceded in full.

**Attacks the critic tried and could not land**, recorded because a failed refutation is
evidence: that the consensus was motivated reasoning dodging a hard integration (it is
provider-independent, therefore an engineering ordering claim, not a product decision); that
low volume was over-applied (it holds for operator capacity and for the supply/demand
asymmetry); that collecting attestations could be used against Livil (no mechanism found —
withdrawn). The critic also found that **"red-flag knowledge" cuts *for* the board's
sequencing**: a flagged-and-unactioned match converts a defensible §512 position into an
indefensible one, and honest review latency here is *"whenever the maintainer next opens
/studio/ops."*

---

## Findings recorded in passing

These are defects found during the debate, none of which belong to this decision:

1. **`web/**` and `shared/**` appear in no domain's `owns` list in `board-routing.yml`** — including
   the two files this debate turned on most, `shared/services/publishTrack.ts` and
   `web/src/screens/Ops.tsx`. ADR-0015 added them and routing was never updated. Orphaned
   surfaces (P48). principal-client claims `web/src/screens/**` and `web/src/components/**`;
   **`shared/services/**` is a genuine contest between client and data and must be assigned
   explicitly, not left blank.**
2. **Proposal `Status` lines are systemically stale**, which makes the board's own 8-proposal WIP
   cap unmeasurable. PROP-0002 is marked *Draft* but shipped as
   `20260804000000_storage_policies_and_bucket_config.sql`; PROP-0006, PROP-0007 and PROP-0008
   still carry the unedited template status line while `src/utils/authorDisplay.ts`,
   `SettingsScreen.tsx` and `DeleteAccountScreen.tsx` all exist.
3. **Mobile leaks orphaned storage objects at permanent public URLs.** `safeDeleteTrack`
   (`src/services/tracks.ts:67-73`) deletes the row only; web already fixed this and calls it
   *"the worst kind of leak"* (`shared/services/publishTrack.ts:182-185`). The dominant producer
   is OS process death mid-upload, where the `catch` never runs. Minimal fix ~15 lines, one file,
   no migration, no native code. **principal-data raises the stake: orphaned objects have no row,
   so the takedown RPC could never find them to remove.** Belongs in its own proposal.
4. **`kb/security/model.md:139` is stale** — "There is no block or mute capability"; blocking
   shipped in `20260809000000`. **`kb/private/security/threat-model.md` does not exist** despite
   being indexed.
5. **`scripts/schema-fingerprint.sql` is `public`-only** (lines 63, 76, 95, 136) — the second
   independent finding, after ADR-0012 decision 4, that the drift detector does not cover the
   thing being proposed.
6. **The error surface for any RLS `WITH CHECK` failure is actively false.**
   `src/utils/errorMessages.ts:45-47` renders *"You don't have permission to do that"* — which an
   uploader would see after a 500 MB upload of their own track. Any future gate must pre-flight
   before bytes move, as the tag cap already does at `tracks.ts:341-344`.

---

## Revisit when

- **Probe K1 returns.** If storage DELETE bypasses RLS, §E is amended: byte removal requires the
  dashboard and the ADR must say so plainly.
- **A rightsholder complaint arrives that Livil cannot action.** That is the event this document
  is designed to make cheap, and the first one should be treated as a test of it.
- **A counter-notice is received.** The Dissent's unresolved objection becomes live and the
  tombstone model needs a rescission path before any account is terminated.
- **A label, distributor, or store review requires proactive filtering**, or EU turnover/age
  crosses the Art. 17(6) threshold (3 years in the EU, €10M turnover). Position A in §A is
  explicitly conditional on being inside that carve-out.
- **A second moderator exists.** That is the trigger `ops_reports_queue` itself named for
  admitting a status enum, and it would change §F.
- **Upload volume rises by an order of magnitude**, or a single track goes viral. The board
  designed for ~7 uploads/month and says so (P23); tail risk, not throughput, is what would
  change the answer.
- **ACRCloud's fingerprint-instead-of-audio path becomes computable somewhere in this stack.**
  It would dissolve both the egress objection and the "permanent public URL to an unreleased
  master" objection — but not the problem of where to compute it.
