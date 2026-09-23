---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-22
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
amends: [0017]
related_adrs: [0003, 0004, 0007, 0008, 0012, 0015, 0017]
---

# ADR-0018 — Rights enforcement under campaign volume: amendment to ADR-0017

| | |
|---|---|
| **Status** | **Escalated** — two product/legal questions are returned to the maintainer; the engineering amendments are decided and listed |
| **Date** | 2026-09-22 |
| **Domain** | data + security (with client and platform) |
| **Decided by** | Targeted board amendment — principal-data, principal-client, principal-security, principal-platform, adversarial-critic. Chief Architect moderating, no technical vote. |
| **Amends** | ADR-0017 §A, §F, §I, §J, §K and its Dissent. **Does not supersede it.** §C, §E (shape), §G, §H stand as written. |

---

## Why this exists

ADR-0017 named its own revisit trigger: *"Upload volume rises by an order of magnitude"* (line
458-460). It fired **four days after ratification**, at a forecast 70–140×. Constitution P53 is
met — the constraint changed — so the board re-ran a targeted amendment rather than the full
protocol: Round 0 triage, Round 1 from the four principals whose positions were load-bearing on
the changed premise, the mandatory critic, and this synthesis.

**This is an amendment, not a supersession.** Most of ADR-0017 survives contact with the new
facts, and a reader needs both documents. Where a section is amended it is named here; where it
is silent, ADR-0017 governs unchanged.

---

## Context — what changed

### The premise the board reasoned from

ADR-0017 designed for **7 uploads/month, 38 tracks ever, 2 reports ever, 1 moderator** and said
so explicitly (P23). The maintainer reports that figure was a testing-phase artifact. The
**First 100 artists** campaign — built and shipping
(`20260919000000_profile_badges_first_100.sql`, hard cap 100, manual `grant_badge()` from
`/studio/ops`, revoke-reclaims-slot per `20260920000000_badge_slot_reclaim_split.sql`) —
requires each of 100 artists to upload a minimum of 5 tracks: **≥500 uploads inside 1–2 weeks**,
~14× the entire catalogue arriving at once. **Moderator count: still 1.**

> **Both campaign premises are maintainer-asserted and exist nowhere in the repository.**
> Independently verified by three participants: `grant_badge()` caps grants at 100 and carries
> **no upload-count predicate** (`grep -c tracks` on that migration = 0); the 5-track minimum and
> the content policy appear in no file under `src/`, `web/`, `shared/`, `supabase/`, `docs/`,
> `kb/` or `.ai/`. A future reader will find "500 uploads" in this ADR and be unable to locate
> its source. **Recording the campaign rules in the repository is itself a finding** (P39).

### Fact A — the upload surface is BOTH

Artists choose the phone app or the web studio. Partial attestation coverage is therefore the
actual condition, not a hypothesis.

Verified: no over-the-air update mechanism exists — no CodePush, no `expo-updates` in
`package.json`; the shipped build is `versionCode 72` / `versionName "2.0.7"`
(`android/app/build.gradle:86-87`). Any mobile change needs a bump, `bundleRelease`, Play review,
**and users choosing to update, which cannot be forced.** principal-platform's estimate of
60–80% of an active cohort within 7 days is **inferred from industry behaviour, not measured —
Livil has no analytics and no crash reporting.** The load-bearing part needs no number: **there
is no date at which every install is on a given build.**

### Fact B — the campaign permits "anything they want to post"

The campaign as described invites 100 hand-picked, badged, promoted artists to upload anything,
five tracks each. **This contradicts shipped, accepted legal text.** Verified today:

- `docs/terms.html:351` **§3, titled "You Must Own What You Upload"** — *"You promise that you
  own, or have permission to use, everything you upload… Do not upload it if you cannot answer
  'yes, this is mine or I have permission.'"*
- `docs/terms.html` **§4** forbids anything that *"infringes someone else's copyright or other
  rights"*.
- `terms_versions` is **sha256-pinned over the exact published bytes and immutable by trigger**
  (`20260907000000:56, 183-193`), and `TERMS_VERSION` is generated from `docs/terms.html`
  (`src/services/terms.ts:9, 14, 33`).

**The campaign rules and the Terms cannot both be true.** This is escalated below, not resolved.

### The four facts the board had not seen

1. **The web studio records no Terms acceptance at all.** `web/src/screens/SignIn.tsx:248-251`,
   verbatim: *"web still has no terms ACCEPTANCE gate. Mobile shows a scrollwrap screen and
   records the acceptance in terms_acceptances; this is clickwrap only, and a user who signs up
   here is never recorded as having agreed."* `src/services/terms.ts:65` is the only writer and
   is mobile-bound. Found independently by principal-data, principal-client and
   principal-security. ADR-0017 never examined web signup.
2. **The invite already routes creators to the browser.**
   `supabase/functions/waitlist-invite/app.ts:135, 150` — *"If you make music, the creator studio
   works in a browser right now: https://livil-music.com/studio."*
3. **`web/` is built for bulk.** `web/src/upload/queue.ts:25` `MAX_CONCURRENT = 3`, written for
   *"a twelve-track folder"*; 2 GB cap (`shared/services/media.ts:41`) vs mobile's 500 MB
   (`src/services/uploads.ts:29`) and no batch affordance in a 1,342-line `UploadScreen.tsx`.
4. **`tracks` carries no upload-surface column**, so the split is unrecoverable after the fact.

---

## Decision

### A. DECIDED — the cost objection to fingerprinting is struck

500 uploads against AudD's published $5/1,000 is **~$2.50**. Confirmed by principal-data: ADR-0017
§A states its recommendation without a cost term, and the three real objections carry it entirely —
**(a)** no enforceable pre-publication gate exists, **(b)** no actuator exists to act on a flag,
**(c)** no provider returns authorisation.

**One stale cost argument was doing work it cannot do.** ADR-0017 **line 462** refers to *"the
egress objection"* as established — **that objection is never stated anywhere in the document**,
so a future reader inherits a cost argument with no premise, no number and no way to check whether
it expired. **Struck.** Two related corrections: line 72 (*"sales-gated with no published price"*)
is an **availability** argument and must not be read as price; line 326 (GitHub Actions *"costs
more to operate than the work it schedules"*) is the one line volume genuinely weakens, and must
not be left standing as if it were still the reason — §G's versioning objection is independent and
binding.

### B. DECIDED — §D stands, unchanged

`posts_insert_own` is `with check (author_id = auth.uid())`
(`00000000000000_baseline_schema.sql:306-308`). A `WITH CHECK` is a property of **when** the
expression runs, not of how many rows exist. There is no row count at which a once-evaluated
predicate becomes retroactive. Volume changes the number of ungated rows, never the gate.
principal-data, who authored the killed Round 1 gate, confirms its concession stands.

### C. DECIDED — §H stands and strengthens

Re-verified today: CI's storage shim is still `storage.buckets (id, name, public)`
(`.github/workflows/ci.yml:170`, `:551`); **zero `createSignedUrl` callers** anywhere; **no
`pg_cron`** in any migration, so retention remains a sentence rather than a control. Volume is
orthogonal to all three grounds. It strengthens on a ground the original did not use: **500
identity documents collected in two weeks by a one-person operation with no retention enforcement
is a breach magnitude ~13× what was argued about** (P20, P43, P57). principal-security now treats
its own formal objection as **blocking rather than formal**.

### D. DECIDED — §F's rejections survive; §F's *argument* is replaced

**Answering MUST-RESOLVE: does §F survive 500 uploads and one moderator? Yes — but not for the
reason §F gives, and the stated reason must be struck.**

ADR-0017 line 197 upholds the precedent because *"with 2 reports ever and 1 moderator, that
argument is stronger now than when it was written."* That is the Dissent's own objection
(lines 371-375) turned back on the board: report count is a **measurement artifact**, because
copyright is still unexpressible in-app — all three `reason` constraints remain
`('spam','harassment','hate','misinformation','other')` (`20260607000007:12`,
`20260607000004:76`, `20260808110000:40`).

**The quantification the maintainer asked for.** The 5%/20% forecast (25 or 100 reviews) does not
describe this system, because **uploads are not work items**: 500 uploads generate **zero**
additional queue entries. There is no scan (§A), no report path, and honest review latency is
*"whenever the maintainer next opens /studio/ops"* (line 407). The queue stays empty by
construction.

Therefore:
- **The 7-state lifecycle rejection survives**, on the instrument argument rather than the count.
- **The strike-ledger rejection survives more strongly.**
  `count(*) from tracks where uploader_id = $1 and takedown_at is not null` is O(one uploader's
  rows); at 5–12 tracks/artist it does not become a table at 500 or at 50,000. What would break it
  is a **shape** problem, not a size problem — see §G.
- **Replace the revisit trigger.** §F's trigger is no longer "a second moderator exists" but **a
  third state arriving from a real waiting party** — a counter-notice, or a Rule 75 21-day clock.

### E. DECIDED — no `publish_surface` provenance column

principal-data proposed `tracks.publish_surface`, filled by a `BEFORE INSERT` trigger reading
`current_setting('request.headers', true)::json ->> 'x-client-info'`, on the ground that
supabase-js already sends that header from both clients and the change is therefore DB-only.
The header is real (verified in the shipped bundle, v2.99.3, `JS_ENV` sniffing `document` vs
`navigator.product`). **Rejected on three grounds, two of which its author did not raise:**

1. **The value embeds the supabase-js version**, so `npm update` silently changes the stored
   string. A discriminator whose domain moves on a dependency bump is a log line.
2. **It is NULL for exactly the caller that matters.** A `curl` with a bearer token sends no
   `x-client-info`. It separates honest-web from honest-mobile and cannot separate either from
   the direct-PostgREST bypass — it answers a question nobody is asking.
3. **The GUC is inferred, not probed** — zero `current_setting` uses across 101 migrations — and
   a passing probe leaves (1) and (2) intact.

The honest discriminator is the attestation row itself. Adding a weaker, client-asserted second
signal to disambiguate the absence of the first is two internal truths where one is required.

### F. DECIDED — a half-covered attestation is NOT worse than none, but it is a RECORD and never a GATE

**This answers the sharpest of the MUST-RESOLVE questions, and both principals who argued it were
partly wrong.**

**principal-client's argument is dead.** It held that if the attestation gates Publish the way
`uploaderRole` already does (`web/src/upload/queue.ts:185-188`), a refusing artist produces no
`tracks` row, so "refused" is unrepresentable and absence can only mean "not asked". **Verified
and refuted:** `uploader_role` **is not a column in any migration** (`grep` → 0 hits across 101
files); it writes into `track_collaborators.role`. `tracks_insert_own` and `posts_insert_own`
check **only ownership** (`baseline_schema.sql:292-294, 306-308`). The queue gate is a client-side
`if` in front of an unconstrained PostgREST insert — a refusing artist can produce both rows with
two authenticated POSTs. **This is ADR-0017's own line 42 — *"Any gate written in client code is
decoration"* — repeated one section later, by the same board, in the same week.**

**principal-data's and principal-security's "worse than none" is also dead, as stated.**
`terms_acceptances` has no UPDATE or DELETE policy (`20260907000000:99-101`) and pins
`user_id`/`accepted_at` by trigger (`:163-172`). **Every row it holds is true about the user it
names.** A record true of 30% of uploads is not *falser* than one true of 0%. "Worse" requires a
consumer that reads absence as refusal; there is no such consumer, and building one wrong would be
the consumer's defect.

**Ruling.**
1. **A web-studio-only attestation is coherent** — as a record. It is **not** coherent as a gate,
   and no document may describe it as one.
2. **The schema must make absence non-load-bearing rather than explainable.** Ship a
   `comment on column` stating that **the absence of an attestation row is never evidence of
   anything** — executable truth beside the column, not a sentence someone must remember (P39).
   This is cheaper and more honest than the rejected provenance column (§E).
3. **The narrow form of the objection survives and is recorded:** the moment a takedown decision
   keys off attestation presence, absence becomes load-bearing and this ruling must be revisited.
4. **principal-security's §512(i) claim — that a selectively-implemented policy is affirmatively
   worse than none — is a legal claim, uncited, made by an engineering role.** Under P6 it is not
   established by this board. Escalated to counsel; not ratified as a finding.

**Shipping it is nonetheless blocked, on Fact B.** See §K.

### G. DECIDED — §E is not ratifiable, and the blocker is no longer only probe K1

**The critic found a contradiction internal to ADR-0017 that survived two rounds and five agents.**

ADR-0017 lines 82-84 record India's Copyright Rules **Rule 75: a 21-day block-then-auto-restore
mechanic *"that any takedown tooling must model."*** ADR-0017 line 168 then chooses **hard-delete
`posts`, tombstone `tracks`, remove bytes explicitly**, and line 345 states the removal is
**irreversible**. **§E structurally cannot model the thing the same document says it must model.**

Consequently:
- **`takedown_vacated_at` is REJECTED for now**, despite principal-security proposing it and
  despite it adopting the critic's own standing dissent. On top of an irreversible actuator, a
  vacate column builds a ledger that **proves you removed content wrongly and cannot put it
  back** — strictly worse than no column, because it manufactures the evidence against you.
- **The live question is not "one timestamp or two". It is whether §E's hard-delete survives
  Rule 75 at all.** Escalated (§L2). §E is now **pending against two blockers**: probe K1 and this.

### H. DECIDED — §J changes URGENCY, not ORDER

**Explicitly, as required.** §J's ordering was derived from **ship surface** (`web/` same-day vs
Play review) and from the **supply/demand asymmetry** — detection is supply-driven and scales with
uploads; notice-and-takedown is demand-driven and bounded. Both are volume-independent. At 500
uploads the second argument gets *stronger*, not weaker: detection manufactures more work for the
same one moderator.

**The catalogue is about to grow 14× while there is still no way to remove anything.** Re-verified:
`tracks_select_authenticated` is `using (true)`, so every signed-in account can read every
`audio_url`; **zero `is_ops` predicates across all 39 `storage.objects` policy statements**;
`revoke_badge()` touches no tracks, so revoking a badge unpublishes nothing. The sharper
conclusion the board records: **the actuator is the only §J item whose absence scales.** Everything
else on the list is a fixed cost; §E's cost is per-incident and the incident population just grew
14×.

### I. DECIDED — the reframe: the human detector already exists, and has nowhere to send its output

**The single most consequential finding in this amendment, and ADR-0017 never saw it.**

`web/src/screens/OpsUser.tsx:22-26`, verbatim: *"One artist's uploads, so an operator can listen
before granting the First 100 badge… a number cannot answer the only question that matters at
grant time — is the work real. Granting from the roster alone means granting on a count, which is
what a bot farm looks like too."* Verified: the page carries a per-track `<audio controls>`
(`:257`), reads through the `is_ops()`-gated `SECURITY DEFINER` `ops_tracks_for_user`, and
`grant_badge` raises for anyone else.

**So 100% of campaign catalogues pass in front of the one moderator's ears as a condition of the
reward.** The review is already built, already shipped, and already budgeted as the grant workflow —
it is ~100 artist-catalogues, not 500 loose items, and it is not new work.

It is post-publication, so it is **not a gate**. It is a **human detector**.

> **The campaign does not create 500 unreviewed uploads. It creates ~500 reviewed uploads with
> nowhere for the review to go.**

That inverts the framing of the whole amendment, and it makes §J item 2 (the actuator) the only
item that converts already-built work into an outcome.

### J. DECIDED — staging the campaign is a RECOMMENDATION, not a prerequisite

**Answering MUST-RESOLVE.** All four principals recommended tranches. The board declines to
promote it to a prerequisite, on the critic's mechanism: **there is no tranche artifact.** Nothing
in the schema, the ops UI, or the upload path bounds tracks per unit time; invites already send one
row at a time (`web/src/screens/Ops.tsx:320-322`) and badges grant one artist at a time
(`OpsUser.tsx:99-107`). A tranche is the maintainer sending fewer emails — a calendar entry, and
P1 says an unenforced invariant is a wish.

**What tranching does not fix:** moderator throughput per item, the missing actuator, or the
per-item probability of infringement. It changes queue depth at an instant and nothing else.
Promoting it to a prerequisite would let the board record a mitigation it has not built.

**It is still recommended**, for two reasons that are real: it makes the unmeasured egress
observable before it is expensive, and it produces the first measurable cohort this product has
ever had — Play Console tester acceptance is unobservable, so without tranches there is no way to
learn the web-vs-mobile split before it is 100% spent. **This is a product lever; the maintainer
decides.**

### K. DECIDED — the web terms-acceptance gate ships, but SECOND, and not before Fact B resolves

principal-data, principal-client and principal-security each independently surfaced
`SignIn.tsx:248-251` and each ranked closing it the highest-value pre-campaign item. Under P10 that
convergence went to the critic, **and the ranking did not survive**:

- Three principals read **the same source comment**. That is three readers of one sentence, not
  independent convergence.
- **A Terms click is not a copyright control.** §512 wants a designated agent, notice-and-takedown,
  and an enforced repeat-infringer policy. §B (the agent — **$6, no code**) is cheaper and more
  load-bearing, and was already escalated. Ranking the codeable thing above the effective thing is
  the failure mode P10 exists to catch.
- **Under Fact B it is actively perverse.** Forcing 100 artists to affirmatively accept
  `docs/terms.html:351` §3 *"You Must Own What You Upload"* while the campaign invites them to post
  anything **converts a missing record into a documented, invited breach on every campaign
  upload.** This is the one place in the debate where "worse than none" has a real mechanism, and
  no principal applied it here.
- No principal offered a mechanism for why clickwrap→scrollwrap improves enforceability. **The row
  is the improvement; the scroll is a preference** until counsel says otherwise.

**The task survives; the ranking does not.** Ship it — after Fact B is resolved, and after §B.

### L. ESCALATED — four questions the board must not decide

> **1. The campaign content policy contradicts the published Terms.**
>
> **Question:** Does the First 100 campaign permit non-original work, and if so, what happens to
> `docs/terms.html` §3?
> **Position A — the campaign as described:** 100 badged artists may upload anything they want,
> five tracks each.
> **Position B — the shipped Terms, which every user is bound by:** §3 *"You Must Own What You
> Upload"*; §4 forbids anything that *"infringes someone else's copyright"*. v1.0 is sha256-pinned
> and 12 accounts have accepted it.
> **Precise point of divergence:** not whether infringement is tolerable, but **which of the two
> documents is the real rule.** They cannot both be operative, and every downstream engineering
> item in this ADR — the attestation, the web terms gate, the report reason, the actuator's
> urgency — forks on the answer.
> **What would resolve it:** the maintainer stating the campaign content rule in writing, in the
> repository, beside `20260919000000_profile_badges_first_100.sql`.
>
> **Engineering consequence the maintainer must price before answering.** Editing `docs/terms.html`
> is **not** a cheap text edit. `TERMS_VERSION` is scraped from a hand-typed `Version 1.0 ·` line
> (`scripts/generate-terms.mjs:42-48`) while `sha256` is computed over the bytes (`:57`), and
> `terms_versions` **refuses UPDATE by trigger** (`20260907000000:183-193`). **Editing §3 without
> hand-bumping that version string yields a new hash under an unchanged version string, and the
> '1.0' row permanently holds a hash of text that is no longer published — detected by nothing.**
> `grep generate-terms .github/workflows/ci.yml` → **zero**. Minting a new version also restales
> every existing acceptance and forces re-acceptance, which on mobile is a build.

> **2. Does §E's hard-delete survive India's Rule 75?**
>
> **Question:** Can a takedown that hard-deletes `posts` and removes bytes satisfy a 21-day
> block-then-auto-restore obligation?
> **Position A (ADR-0017 §E):** hard-delete, because it makes the anon share page 404 for free and
> avoids hand-patching 18 `SECURITY DEFINER` functions.
> **Position B (ADR-0017's own Context, lines 82-84):** any takedown tooling must model
> block-then-restore.
> **Precise point of divergence:** whether "removal" under Rule 75 must be **reversible by the
> platform**. §E is irreversible by design (line 345).
> **What would resolve it:** counsel, on Rule 75's restore obligation. This is legal, not
> engineering, and the board guessed at it twice.

> **3. §B — the designated agent and named grievance officer.** Carried forward unchanged from
> ADR-0017 and now ~500× more urgent. Still the cheapest item on the table, still requires no
> code, still the maintainer's call because it discloses personal information.

> **4. The batch-attestation UI shape.** principal-client correctly showed §I.5's
> `ConfirmActionModal` does not transfer to a batch queue — twelve modals for a twelve-track folder
> is a defect (P41). Its replacement did not survive either: *"Confirm ownership for all N"* is
> §I.5's rejected *"checkbox among twelve fields"* with a button on it, and `patchPending`
> (`queue.ts:143-149`) sweeps `pending` **and `failed`**, so a retried previously-failed item
> silently inherits an attestation made before its failure. **The critic could not construct a
> batch UI that is both usable and per-item honest, and neither could the board in one round.**
> Escalated rather than invented.

### M. §A restated — not reversed

Fact B changes what a detector *is*, and the coordinator's reading is half right. **Right:**
signal-to-noise collapses; a fingerprint hit stops being an exception. **Wrong:** the conclusion.
Under "anything goes" the base rate is high **by design**, so the detector stops being an alarm and
becomes a **census** — *"which of these 500 are commercial masters"* is a question one moderator
cannot answer by ear and a machine genuinely can. **That is the first argument in this entire
debate for a provider that does not dissolve on inspection**, and the board records it against
its own prior recommendation.

**§A still does not reverse.** ADR-0017's red-flag-knowledge finding (lines 404-407) is *stronger*
under Fact B: a census of ~500 flagged tracks, no actuator, one moderator, and honest review
latency of *"whenever the maintainer next opens /studio/ops"* converts a defensible §512(c)
position into an indefensible one at ~500× the old volume.

**Amendment to §A, one sentence: the escalation is now conditional on the actuator existing, not
merely on product appetite.**

### N. DECIDED — one new pre-campaign item nobody had: there is no upload quota

**P22: unbounded is a defect, not a simplification.** The only rate limits across 101 migrations
are impressions (`20260816000000:165`) and reactions (`20260722000000:682`). `tracks-media` caps
one **file** at 524288000 bytes (`20260804000000:76`) and caps nothing else. **There is no
per-user upload quota and no server-side rate limit on uploads anywhere.** 500 uploads × up to
500 MB is unbounded write and egress against a Micro-tier project with no ceiling and no alert.

If the board recommends one burst-shaped artifact, this is it: **a per-user upload quota, DB-side,
shipping without a client release.**

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Supersede ADR-0017 with a full replacement** | §C, §E's shape, §G and §H all survive unchanged, and most of the Context is still the best record of why this is hard. A supersession would discard correct work and force a future reader to diff two long documents to find the four sections that moved. |
| **Amend ADR-0017 in place** | ADRs are append-only by charter. The record of what the board believed on 2026-09-19 — including that it was wrong about §F's argument and blind to Rule 75 — is the point. |
| **`tracks.publish_surface` from `x-client-info`** | §E. The value embeds the supabase-js version so `npm update` changes it; it is NULL for the direct-PostgREST caller, which is the only caller the disambiguation was for; and the GUC is unprobed. A client-asserted signal cannot disambiguate a record. |
| **Gate Publish on the attestation in `web/`, making refusal unrepresentable** | §F. `uploader_role` is not a column; `tracks_insert_own`/`posts_insert_own` check only ownership. The gate is a client-side `if` in front of an unconstrained insert — ADR-0017's own "any gate in client code is decoration", repeated. |
| **`takedown_vacated_at` beside `takedown_at`** | §G. On an irreversible actuator it manufactures a ledger proving you removed content wrongly and cannot restore it. Revisit only after the Rule 75 escalation returns. |
| **Declare a half-covered attestation worse than none and ship nothing** | §F. Every row the table holds is true about the user it names; a record true of 30% is not falser than one true of 0%. The defect would belong to any consumer that read absence as refusal — so forbid that consumer instead, in a column comment. |
| **Promote campaign tranching to a prerequisite** | §J. No tranche artifact exists; it is a calendar entry. It changes queue depth at an instant and fixes neither throughput, nor the missing actuator, nor per-item infringement probability. Recommending it as a prerequisite records a mitigation nobody built. |
| **Rank the web terms-acceptance gate first** | §K. Three readers of one source comment is not independent convergence; §B is cheaper and more load-bearing; and under Fact B it converts a missing record into a documented, invited breach. |
| **Ship `'copyright'` in the three `reason` constraints before the campaign** | The migration is DB-only and applies same-day, but the UI that lets anyone select it is **mobile-only** (`src/components/PostReportModal.tsx:28` and two siblings hardcode the list) and **`web/` has no report-submission path at all**. Shipping the constraint alone creates the obligation (P44) with no way to exercise it. **Ship both halves or neither.** |
| **Build a job queue / rate limiter / CDN / transcoding for 500 uploads** | Unanimous across all four principals: the burst is a dated, operator-controlled event hard-capped at 100 artists by a database constraint. Sustained 500/month is an unmeasured forecast, and this project has no analytics with which to make one (P13, P21, P23). |
| **Design for both burst and sustained volume** | Refused, as the maintainer asked. The burst is the only bounded number anyone has ever had here. The burst-specific work is **entirely non-schema**: onboarding copy, invite pacing, and a spend cap. |

---

## Consequences

**Makes easy.** The one moderator's existing listen-before-grant workflow (§I) becomes the
detector, at no new cost, for 100% of the campaign cohort. The actuator is now unambiguously the
highest-value engineering item, with a reason stronger than the one ADR-0017 gave. Three stale
arguments are struck rather than left to mislead a fourth reader.

**Makes hard / forecloses.**
- **§E is now double-blocked** — probe K1 *and* the Rule 75 reversibility question. The item this
  ADR names as most urgent is the item that cannot be ratified. The board states that plainly
  rather than resolving it by preference.
- **The per-upload attestation cannot ship before the campaign**, because it is blocked on Fact B
  (you cannot ask someone to attest to terms the campaign contradicts) and its UI shape is
  escalated. **~500 tracks will be published with no attestation**, on top of the 38 that already
  are, and that is not recoverable afterwards.
- **The mobile surface cannot be changed in time at all**, in those words. Anything under `src/`,
  `android/` or `patches/` needs a bump, a manual signed build on one laptop, Play review, and a
  voluntary user update — and there is no date at which every install is on a given build.
- **The campaign creates the obligation on launch day, and none of the mechanisms are on the same
  clock** (P44). On the day invites go out, Livil has a *promoted* cohort producing ~500 uploads
  against a published promise that it removes infringing content and terminates repeat infringers
  (`docs/terms.html` §5, §6), with no takedown actuator, no designated agent, no named grievance
  officer, bytes unremovable until K1, and one moderator. **That is the maintainer's to accept or
  defer, not the board's.**

**Costs not otherwise visible.**
- **Egress is the failure mode nobody had considered, and it is unmetered.** Cost scales with
  **plays**, not uploads — no CDN we control, no transcoding, no adaptive bitrate, every play
  downloads the full-quality file. 100 artists each promoting 5 tracks to their own audience is the
  first event in this product's life that multiplies catalogue by promotion. principal-platform can
  name the shape but not the magnitude: **a usage-metered bill with no alert configured and no
  dashboard anyone watches.** A Supabase spend cap is a five-minute dashboard click and the only
  backstop that exists.
- **Two deployed edge functions are verified by nothing.** `scripts/check-edge-functions.mjs:87-95`
  matches slug only, and `waitlist-invite` — **the campaign's ignition** — is not even in
  `REQUIRED_FUNCTIONS` (`:60`). The header's reasoning is *"failure is visible to the operator in
  /ops"*, which is the same assumption that let `post_reports` sit unread for two months.
- **`/studio/ops` is a 684-line single component with 21 `useState` slots, all fetched eagerly on
  mount, and the Users roster — the hot path for 100 manual badge grants — is the fifth section
  down.** Tabs move from nice-to-have to the highest-frequency operator ergonomics item of the next
  fortnight. The file's own argument at `Ops.tsx:333-338` now applies to the grant path.

---

## THE MINIMUM SET THAT CAN SHIP BEFORE THE CAMPAIGN OPENS

Stated separately because it is the operative output of this amendment. **Surfaces are honest:
`web/` and `docs/` ship same-day via Vercel; a migration is applied by hand from the dashboard;
`src/` cannot ship in time at all.**

### Ships — no store release, no mobile dependency

| # | Item | Surface | Blocked on |
|---|---|---|---|
| 1 | **Supabase spend cap / billing alert** | dashboard, maintainer only | nothing — 5 min |
| 2 | **Per-user upload quota** (§N) — the one burst-shaped artifact | DB migration | nothing |
| 3 | **Tabs in `/studio/ops`** (§J.3) — now mandatory, not cosmetic | `web/` same-day | nothing |
| 4 | **Add `waitlist-invite` to `REQUIRED_FUNCTIONS`** | `scripts/` | nothing — 1 line |
| 5 | **Pin the per-slug edge-function `version`** (§G prerequisite) | `scripts/` | nothing — ~15 lines; the field is already in the payload (`check-edge-functions.mjs:159-161`) |
| 6 | **CI check that `src/constants/termsContent.ts` matches `docs/terms.html`** | `.github/` | nothing — and it becomes urgent the moment Fact B forces a Terms edit |
| 7 | **Rights expectation in the invite + `docs/welcome.html`** — **NOTICE ONLY, explicitly not attestation** | `docs/` + `supabase/functions/` | Fact B (the wording depends on the answer) |
| 8 | **Delete the stale comment at `web/src/App.tsx:33-35`** | `web/` | nothing — it already misled one board debate |
| 9 | **§B designated agent + named grievance officer** | none — a $6 filing | the maintainer's decision |

### Blocked — cannot ship before the campaign, stated plainly

| Item | Why |
|---|---|
| **Per-upload attestation (§I)** | Blocked on Fact B, and its batch UI shape is escalated (§L4). |
| **Web terms-acceptance gate** | Blocked on Fact B (§K) — perverse until the content rule is settled. |
| **`'copyright'` report reason (§J.1)** | DB half ships; the UI half is mobile-only and web has no report path. Ship both or neither. |
| **§E takedown actuator (§J.2)** | Double-blocked: probe K1, and the Rule 75 reversibility escalation (§G). |
| **Anything under `src/`, `android/`, `patches/`** | No OTA. Bump + signed build + Play review + a voluntary update that never reaches 100%. |
| **`safeDeleteTrack` orphan fix** (ADR-0017 finding #3) | `src/` only. The campaign's web uploads are already on the fixed path (`publishTrack.ts:178-197`). Next release. |

**No proposal accompanies this ADR.** The board is **over its WIP cap: 10 proposals carry an
unratified status against a cap of 8.** Per the charter the board blocks on its own backlog rather
than generating more. ADR-0017 finding #2 already recorded that these status lines are
**systemically stale** — PROP-0006/0007/0008 still carry the unedited template line while the code
they describe exists — so the true count is probably lower, **and the fact that the board cannot
measure its own cap is the defect, not the number.**

---

## Dissent

**The critic: §F's conclusion is right and §F's sentence proves the critic's point against the
board.** Recorded in §D and acted on. Using "2 reports ever" as support was the Dissent's own
objection turned back on the board, four days after it was written.

**principal-data and principal-security both argued a half-covered attestation is worse than
none, and the board ruled against them** (§F). Their narrow form survives and is the most likely
line here to prove right later: *the moment any takedown decision keys off attestation presence,
absence becomes load-bearing and this ruling must be revisited.*

**principal-security's §512(i) argument is recorded and NOT adopted.** That a selectively
implemented policy is evidence of a policy not "reasonably implemented", and therefore worse than
none, is plausible and is legal reasoning by an engineering role with no citation. It is escalated
to counsel, not ratified. **If counsel agrees, §F is wrong and §K's ordering is wrong with it.**

**principal-client's "refusal is unrepresentable" was refuted on a verified mechanism** (§F), and
the record should show the board verified it independently rather than taking the critic's word:
`grep uploader_role supabase/migrations/` returns zero.

**The critic could not kill four things, and a failed refutation is evidence:** that the web
acceptance row is worth recording as a *task* (it found no mechanism by which recording is worse
than not recording, except under Fact B); that §J's ordering survives the new premise; that
`ConfirmActionModal` does not transfer to a batch queue; and principal-platform's stale-comment
catch.

**The stale-comment pattern is the finding, not the instance.** Three confirmed today:
`web/src/App.tsx:33-35` claims the SPA rewrite has not shipped when `web/vercel.json:11-14`
contains it — **ADR-0017 cited that comment as a live campaign-blocking defect**;
`shared/services/publishTrack.ts:307` claims mobile writes credits after the post is live when
`src/services/tracks.ts:485,495` writes them before — **§I.5's "same failure envelope" reasoning
was argued from a wrong picture of mobile**; and `OpsUser.tsx:26-31` records that a stale sentence
in its own header *"is what shipped the 'No uploads' bug"*. **Two stale comments misled this board
in a single day.**

**principal-platform corrects its own domain file:** `kb/operations/infrastructure.md:155-166`
lists edge function source as the single genuinely unrecoverable asset — **false**; all four
functions have source under `supabase/functions/`. Recorded as its error.

**Unprobed and named as such** (the discipline §K exists to enforce): probe K1 (storage DELETE
under `is_ops()`); the PostgREST `request.headers` GUC; Play update-adoption fractions (**inferred
from industry behaviour — Livil has no analytics and no crash reporting**); Supabase behaviour
under ~300 concurrent TUS uploads; the Supabase plan tier and included quotas; and whether database
branching is available, which gates K1's cheap path.

---

## Revisit when

- **The maintainer answers Fact B** (§L1). Every engineering item in this ADR forks on it.
- **Counsel answers Rule 75** (§L2). If removal must be reversible, §E's hard-delete is wrong and
  `takedown_vacated_at` returns with it.
- **Counsel answers §512(i)** (§L4 / Dissent). If a partial record affirmatively harms, §F reverses.
- **Any takedown decision begins keying off attestation presence.** §F's narrow objection goes live.
- **A third state arrives from a real waiting party** — a counter-notice or a Rule 75 clock. That,
  not a moderator count, is now §F's trigger.
- **The campaign's actual web-vs-mobile split becomes known.** It is currently unknowable and,
  without tranches, will be 100% spent before it can be learned.
- **Egress or storage cost becomes observable.** It is the only unbounded quantity here and nobody
  is watching it.
- **Sustained volume replaces the burst.** Then this project holds its first real measurement, and
  P21 says that is when the steady-state work starts — not before.
