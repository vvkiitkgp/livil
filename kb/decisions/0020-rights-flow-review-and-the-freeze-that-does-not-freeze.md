---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-23
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
amends: [0017, 0018, 0019]
related_adrs: [0003, 0004, 0007, 0008, 0012, 0015, 0016, 0017, 0018, 0019]
---

# ADR-0020 — Review of the shipped rights flow: the system coheres, the freeze does not

| | |
|---|---|
| **Status** | **Escalated** — the board splits 2–2 on the commit and the split is definitional; the engineering findings are decided and listed |
| **Date** | 2026-09-23 |
| **Domain** | data + security (with client and platform) |
| **Decided by** | Board review — principal-data, principal-security, principal-client, principal-platform, adversarial-critic. Chief Architect moderating, no technical vote. |
| **Reviews** | Branch `agent/copyright-scan`, 46 files, ~9,800 lines, staged and uncommitted. Eight migrations **already applied to production**; the edge function **already deployed**; the mobile client **not shipped**. |
| **Amends** | ADR-0017 §E, §F, §G, §I, §K · ADR-0018 §A, §G · ADR-0019 §H, §I. **Supersedes none.** Where this document is silent, they govern unchanged. |

---

## Round 0 — triage, stated before anything else

**Warranted?** Yes. `no_debate` does not cover it: not routine, not a bug fix, and it reverses parts of three
accepted ADRs, which P53 makes reviewable. Decisively, **it is already applied to production**, which is the
irreversibility P4 says rigour must scale with.

**Framed question.** *Does the shipped rights-and-copyright system form one coherent mechanism whose parts do
not contradict each other, and is anything in it unsafe enough to block the commit?*

**That question contained a defect, and the defect shaped the outcome.** "The commit" was left undefined, and
the board argued across three different acts — `git commit`, `git push`/merge, and *apply to production* — as
though they were one. See §M. **This is the Chief Architect's error, not a principal's**, and it is recorded
here rather than quietly repaired.

**Routed** — four principals, at the cap, plus the mandatory critic: principal-data (8 migrations, new RPCs,
referential integrity), principal-security (`supabase/migrations/**` → *ALWAYS*), principal-client (two upload
clients, the ops UI, the notice surfaces), principal-platform (the edge-function deploy surface, which
ADR-0017 §G made conditional on a prerequisite; `.github/workflows/ci.yml` is modified).

**Not routed, and why.** principal-playback — no engine, coordinate, MediaSession or patch surface is touched
(verified: the diff contains no `patches/`, no `GlobalAudioPlayer`, no `PlaybackContext`). The
playback-adjacent risk — a queue still holding a taken-down track — was assigned to principal-client
explicitly rather than seating a fifth principal, and principal-client returned §F.2, which is one of the two
most valuable findings in the review. principal-realtime — `20260923050000` was checked for a push path and
has **zero hits** for `send-push`/`dispatch_push`; the notice is in-app only. That absence is itself a
finding (§F.4) and was put to principal-client. **Both omissions were load-bearing and both were covered by
the principals who inherited them; the routing table's gap is recorded in §L.**

**Protocol run.** Round 1 in parallel with no cross-visibility. Round 2 cross-examination with full visibility
and assigned verification tasks. Round 3, the mandatory critic. **Round 3b — a deviation, declared:** the
critic produced a finding verified by execution that corrected a paragraph principal-security had written for
verbatim use in this ADR. Recording it on a single source would have breached P6/P8, so the two domain owners
were asked to confirm or refute it, and nothing else. **The cost was real and it shows:** both confirmed, both
sharpened it in *different* directions, and their two executions disagree on one variant (§A.3). A fuller
protocol would have reconciled that; this document records the disagreement instead.

---

## Context

ADR-0017 escalated whether to integrate a fingerprinting provider at all and recommended building the
enforcement primitives first. ADR-0018 amended it under campaign volume. ADR-0019 killed the ownership boolean
and escalated the replacement's shape. **All three were written before most of this code existed.** The
maintainer then built the whole flow — detection, declaration, per-upload grant, ops queue, takedown/restore,
notices, blocked UI, and a read-side predicate — and applied eight migrations to production.

**What the board was given as already verified by execution, and did not re-derive:** 109 migrations replay
clean from an empty Postgres; SQL suites pass (takedown 31, copyright-scans 34, terms-acceptance 18,
authorization 91, rpc-contracts 20); typecheck clean on mobile and web; 0 lint errors; 636 Jest tests; and a
production probe in a rolled-back transaction showing a blocked track invisible to a non-owner (0 of 2),
visible to its owner (2 of 2), with the owner's live tracks unaffected (6).

**The board's own standing state, stated because it constrains the output:** there are **9 unratified
proposals** in `kb/debt/proposals/` against a **cap of 8**. The board is over its cap. **No proposal is
produced by this review.** ADR-0017 finding 2 already recorded that these `Status` lines are systemically
stale, which is what makes the cap unmeasurable; that defect is now load-bearing.

---

## Decision

### A. DECIDED — `tracks_freeze_media` does not freeze. Section 0 is not a control.

**This is the finding of the review. It was found by the adversarial critic, in Round 3, after four principals
had been over the code for two rounds, and it was confirmed independently by both domain owners.**

`supabase/migrations/20260922100000_track_copyright_scans.sql:111-141`:

```sql
if old.video_url is distinct from new.video_url
   and not (old.video_url = placeholder and new.video_url is not null
            and new.video_url <> placeholder) then
  raise exception ...
```

When `old.video_url` is **NULL**: `NULL = placeholder` → NULL; `NULL and true` → NULL; `not NULL` → NULL; and
**plpgsql evaluates a NULL `IF` condition as false, so the raise never fires.**

`src/services/tracks.ts:441-442` writes `audio_url: mode === 'audio' ? 'pending://placeholder' : null` and the
mirror for video. **So every published track carries exactly one permanently-NULL, permanently-unguarded media
column**, and the client puts it there on every upload.

**1. It is reachable by one ordinary authenticated request.** `tracks_update_own`
(`00000000000000_baseline_schema.sql:295-297`) is `using (uploader_id = auth.uid())` — rows, never columns.
**Zero column-level grants exist in all 109 migrations** (`grep -riE "grant[[:space:]]+(update|insert|select)[[:space:]]*\("`
→ nothing; verified independently by both principals). Only three triggers exist on `tracks`, and
`tracks_freeze_takedown` inspects only `taken_down_*`. A real `PATCH /rest/v1/tracks?id=eq.<mine>` lands.

**2. The evidence row does not notice.** `scanned_media_url` lives on `track_copyright_scans` and is untouched
by an UPDATE on `tracks`. It keeps naming the file that was examined while `match_found` stays `false`. **The
ledger reads clean while the track plays something that was never scanned** — precisely the failure the
migration header at `:36-58` says section 0 exists to prevent.

**3. The two confirmations disagree on one variant, and the board records both rather than picking.**
principal-security executed against PG 17.10 **with the real baseline table including its CHECK constraints**
and found that setting `audio_url` alone on a video track is **blocked** — not by any trigger, by
`tracks_media_shape_check`, which the critic had not modelled. principal-data, executing the extracted
function body, reported that variant succeeding. **The methodological difference is stated as fact: one run
modelled the table, the other modelled the trigger. The board does not rule on which output is correct,
because it does not need to** — both runs agree that setting the NULL column on the *other* kind of track
succeeds, and principal-security found a third variant that is worse than either.

**4. principal-security's third variant, which neither the critic nor principal-data named:** `media_kind` is
**frozen by no trigger anywhere in the schema.** Flip the kind and fill the NULL column in one statement — the
shape check is satisfied at statement end, the freeze trigger sees NULL→value and returns, and a scanned video
post becomes an audio post playing attacker-chosen bytes. Executed: `UPDATE 1`.

**5. principal-data's correction, which makes repair harder rather than easier:** the injection **succeeds
once and then freezes shut behind the attacker** (nulling it back raises `is immutable once set`). Neither the
uploader nor an operator without `moderating_now()` can undo it. **A repair migration must remediate
already-injected rows, not merely close the door.**

**6. It reaches anonymous visitors.** `shared_post_public` is definer, granted to `anon`
(`20260922000000:65,136`), and projects `t.audio_url`/`t.video_url`. `web/api/share.ts:160-168` `safeUrl`
checks **only** `u.protocol === 'https:'` — no host check, no allowlist — and `:332,352,369,371` render it into
`og:audio`/`og:video` and `<audio src>` on a livil-music.com page. **An uploader can make Livil's own domain
serve `<audio src="https://any-host/anything">` under their post.**

principal-security insisted on bounding this, and the board records the bound rather than the alarming version:
**it is not XSS** — `escapeHtml` is applied and `javascript:` is rejected. What it is: the copyright bypass made
publicly consumable; Livil's domain fronting arbitrary third-party content with `og:` attribution in link
unfurls; and every share-link visitor's IP and user-agent handed to a host the uploader chose. A takedown does
kill the page, because the RPC joins `posts` — `20260923050000:17-24` reasons about exactly this and gets it
right.

**RULING.** Section 0 closes neither the pointer nor the pointee. **Every evidential claim in this batch rests
on a control that does not hold, and the ADR must not record it as if it does.** The repair is three parts, not
one: NULL-safe guards (`old.url is not distinct from placeholder`), `media_kind` frozen after first publish,
and a host allowlist in `safeUrl` (the legitimate hosts are two known Supabase storage origins).

**And the reason the test suite did not catch it, which is the durable lesson:** every existing test starts
from the placeholder. **A guard whose bug is NULL-swallowing cannot be found by a test that never passes it a
NULL.** Constitution P30 — coverage follows blast radius — and this boundary was already documented as
load-bearing.

### B. DECIDED — the eight pieces are one system, not a pile

Unanimous across four principals, and the board states it plainly because the maintainer asked: **the parts
interlock on a single invariant** — *a takedown is the deletion of every `posts` row plus a tombstone on
`tracks`* — and each part is built against that invariant rather than a private copy of it. The
`livil.moderating` GUC is set and cleared inside both actuators; `posts_block_taken_down` is `SECURITY DEFINER`
**on purpose** so a blocked viewer's hidden-track read cannot make it fail open; the snapshot is written
*before* the delete and a second takedown is refused so it cannot be overwritten with NULL; the new RLS clause
degrades gracefully in the two places its own header names.

**The contradictions are not between the parts. They are between the shipped code and the ADRs that were
supposed to authorize it** (§I), plus one intra-batch regression where migration 7 undid migration 3 on a
justification covering half the ground (§D).

### C. DECIDED — the reversibility split is correct, and is better engineering than the ADR it replaces

ADR-0017 §E specified hard delete. ADR-0018 §G then declared §E **unratifiable** precisely because hard delete
cannot model India's Rule 75 block-then-restore. **The shipped split — takedown reversible, purge
permanent-and-absent — resolves that without inventing the `takedown_vacated_at` column §G correctly killed.**

Two invariants make it actually reversible rather than nominally so, and both are present and tested: the
snapshot is written **before** the delete (`20260923050000:187-193`), and a second takedown is refused
(`20260923010000:397-399`). **ADR-0018 §G's conclusion is obsolete; its diagnosis was correct and was acted on.**

**The cost, stated because an ADR listing only benefits is advocacy.** Restore is partial and the code says so:
the uploader's own post returns with caption and clip; **likes, comments, views, impressions and all reposts do
not**, and share links break because the post uuid is new. Adequate for Rule 75 — access is restored — **not a
restoration of state.** The operator screen should show the count of reposts that will not come back;
`live_reposts` is already on the row at takedown time.

### D. DECIDED — the delete-block reversal was right in principle and its stated justification is false in fact

`20260923050000:325-330` drops `trg_tracks_block_taken_down_delete`, reasoning: *"Section 5 moves the count to
the ledger, so the reason is gone."* The principle is sound — once the strike derives from the ledger, blocking
the delete protects nothing and only stops a creator tidying their own profile.

**The premise is false as shipped.** Section 5 moved only `ops_takedown_counts`, and
**`grep -rn "ops_takedown_counts" src web shared supabase/functions` returns ZERO HITS** — verified
independently by principal-data and principal-client, and the critic then searched for a dynamic `.rpc(` with a
non-literal first argument and found only a comment. The count was not moved to the ledger; **a second count
was created in the ledger and never wired to any screen.**

Meanwhile `ops_copyright_scans` still computes its strike count inline as
`count(*) from tracks ot where ot.uploader_id = t.uploader_id and ot.taken_down_at is not null`
(`20260923020000:177-180`), and **that is the only strike number an operator ever sees**
(`opsCopyright.ts:175` → `Ops.tsx:553-557`), on the row where the removal decision is made. **It decrements when
the uploader deletes their own blocked track.** That is ADR-0017 §E's *"the strike ledger erased by the person it
counts"*, verbatim, arriving through a different door.

**The critic then found the false belief has propagated into three artifact types** — the migration
(`20260923050000:325-330`), a **test** (`takedown.test.sql:149-154`, as the comment explaining why an assertion
was removed), and a client comment authorising the destructive button (`Catalogue.tsx:259-261`). **A wrong
belief that reaches a test is no longer a belief; it is an enforced invariant pointed at the wrong reader, and
it will now defend itself against correction.**

**RULING: keep the reversal, repair its premise.** Two counts is the defect; either direction fixes it.

### E. DECIDED — "audit rows carry plain uuids" is the right principle. The batch applied it to one table and not the adjacent one.

The mechanism is verified and correct: `ON DELETE SET NULL` executes as an UPDATE, append-only triggers raise
on it, and the parent DELETE aborts — so FKs on audit tables would make account deletion permanently impossible
for anyone who appears in them. principal-security traced `delete_my_account` against every new table and
account deletion **still works end to end**. ADR-0019 §B holds; the shipped code picks correctly between §C's
two live options, and principal-data adds the unnamed property that favours it: **a dangling uuid keeps naming
the track it was about, where `SET NULL` forgets it.**

**But `track_copyright_scans.track_id` is `on delete cascade` (`20260922100000:156`), defended in its own header
on the ground that *"the row already dies with the track"* — which was true only while the track could not be
deleted.** §D made it deletable and `shared/services/blockedTracks.ts:92-98` ships the button.

**principal-security conceded this completely in cross-examination, having ruled the opposite in Round 1.**
Asked to name what is destroyed that exists nowhere else, it produced the list: `provider` and
`provider_scan_id` (the only handle back to the vendor's own records), `scanned_media_url`, `matched_isrc` /
`matched_title` / `matched_artist` (**the identity of the commercial master**), `status` / `match_found` /
`confidence`, `acknowledgement` + `acknowledged_at` + `acknowledged_by`, the entire `claim_*` block, and
`accepted_responsibility` + `granted_streaming_licence` — which live here, **not** on `terms_acceptances`.

**The decisive point none of the three principals had stated until Round 2:** `moderation_actions` and
`post_removals` **only exist if a takedown happened.** In the common case — a match was found, the uploader
declared *"I have permission from Sony Music India,"* and no operator ever acted — `track_copyright_scans` is
the **sole** record that the event occurred. One "Delete permanently" click leaves `terms_acceptances` saying
only *"this person accepted v3 of the terms."*

**This is the same threat ADR-0017 §I.2 used to reject CASCADE for `terms_acceptances` — destroyed by the
infringer, automatically, at the moment of maximum motive. Two adjacent migrations gave the same threat
opposite answers.**

**And the board records what it got right, because §512(i) is what actually matters here:** the repeat-infringer
strike lives in `moderation_actions`, which `20260923050000:33-39` deliberately gives no foreign keys —
*"outlives everything it names."* **The legally load-bearing ledger survives.** What is destroyed is the
uploader's own attestation.

### F. DECIDED — "removed" is not true, on four independent mechanisms, and only one of them was known

ADR-0017 §E already recorded that bytes are a separate manual step. **The review found three more, and two of
them are outside the database entirely — which is why two database principals converged on a safety claim that
was correct and incomplete.**

1. **The bytes.** `tracks_media_public_read` is `using (bucket_id = 'tracks-media')` with no owner clause; the
   bucket is public and public object reads bypass RLS. The path `{uploaderId}/{trackId}/{kind}.{ext}` is
   **reconstructible** from data that was in the feed payload and on the share page — not merely retained.
2. **The share page keeps serving it.** `web/api/share.ts:600` sets
   `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`, and the cached HTML **inlines the raw
   media URL** in `og:audio` and `<audio src>`. `ops_take_down_track` is pure SQL and cannot purge a CDN;
   `grep -rniE "purge|revalidate"` across `web/` returns only the SWR string itself. **The code's own comment
   (`:596-599`) reasons about `s-maxage=300` and does not account for the `stale-while-revalidate=86400` on the
   same line** — the author's stated safety margin is five minutes, the configured one is a day.
   **The critic partially refuted the finding's own framing and in doing so strengthened it:** under SWR a
   *popular* link self-corrects quickly and an *unpopular* one is rarely fetched, so exposure is bounded at
   roughly one stale serve per edge POP, not 24 hours of continuous serving. **But S10 does not depend on SWR at
   all — `s-maxage=300` is an unconditional five-minute floor during which the origin is never consulted.**
   principal-platform under-used its own strongest leg. The `og:audio` unfurler half is undiminished and is the
   worse half, because it escapes to caches Livil does not control.
3. **The running app keeps playing it, for the whole session.** `grep -rn "taken_down\|takenDown" src/` returns
   **exactly one hit in the entire mobile app**, a count query on a profile screen — **zero in the playback
   path**. No realtime subscription on `posts` or `tracks` exists. So: a listener mid-song plays to the end; it
   **plays again** because `queueRef.current` is an in-memory array with URLs baked in; and it **plays again from
   the lock screen with no JS involved**, because `mediaQueueJson` was already handed to the native service and
   JS is not in that path by design. Nothing invalidates. **The horizon is the app session — on a warm phone,
   days.** The critic tried to shrink this to "mid-song only" by hunting for a feed refetch on focus and
   **could not**.
4. **The creator is told the opposite, and in-app only.** `RemovedContentCard.tsx:90` and
   `Catalogue.tsx:248-250` both say *"It cannot be played."* while `Ops.tsx:134` and `:598` tell the operator
   *"The files are NOT removed; they stay reachable at their public URL."* **Two surfaces in the same branch make
   contradictory factual claims about the same event, and the one shown to the affected party is the false one.**
   `shared/services/postRemovals.ts:92-103` exists explicitly *"so both clients say the same thing"* — it is
   imported by web and **by nothing in `src/`**, and the divergence it was written to prevent is the false
   sentence. There is also **no push**: `20260923050000` has no `pg_net`, no `send-push`. A creator learns their
   work was removed when they next open the app and scroll. **On an installed build the row is dropped entirely**
   — `rowToItem` has no `default` branch — **while `activity_unread_count()` still counts it**, so the badge says
   1 and the inbox shows nothing.

**RULING: "unpublished" is a metadata state, not a media state, and the product must stop saying otherwise on
the surface shown to the person it happened to.** ADR-0017 §E said this in the ADR; the code says the opposite
in a string literal.

### G. DECIDED — the quota is not a control, and the board's own escape hatch was retracted

`supabase/functions/scan-upload/app.ts:339-349` counts **rows** in `track_copyright_scans`; the write is an
upsert on `(track_id, provider)` and `rowFor` omits `created_at`. principal-data fetched the PostgREST source
(`Query/QueryBuilder.hs:154`) and verified the `DO UPDATE SET` list and the `INSERT (...)` list are the same
list, derived from payload keys — so `created_at` does not move.

**Then principal-data retracted its own framing, which is the more valuable half:** it had told the board *"if
`created_at` DOES move, the quota is sound and this finding collapses."* That is false, and was false on code it
had already read. **The count counts rows, and an upsert on `(track_id, provider)` never creates a second row
for that track, whatever `created_at` does.** Frozen → 1 for 24h then 0 forever; moving → 1 forever. Both under
50. **No fact about PostgREST could have made the quota a control.**

principal-security priced it: AudD publishes $5/1,000; one free signup plus the published anon key, looping on
one `trackId`, is unbounded billable calls. No test covers it. The object need not even exist — a user can
insert a `tracks` row with a well-formed URL and get a billable call for a file never uploaded.

**And principal-security corrected its own urgency framing too:** *"Committing the branch does not create the
exposure; the DEPLOYED function is the exposure, and it exists right now whether this commit lands or not."*

### H. DECIDED — ADR-0017 §G's prerequisite was skipped, and the check is worse than dormant

§G said no new edge function, with a named prerequisite: pin the Management API's per-slug `version` integer.
An edge function shipped. **`scripts/check-edge-functions.mjs:66` is `REQUIRED_FUNCTIONS = ['send-push',
'welcome-email']` — `scan-upload` is not in the list**, matching is slug-only, and the word `version` appears
only in self-test fixtures.

principal-platform's Round 1 hedge was that the check might be dormant. **It ran `gh secret list` and
`gh run view 35726393405 --log` and killed its own hedge:** `SUPABASE_ACCESS_TOKEN` exists and the run printed
`PASS all required edge functions deployed to fqzrmqnlgjeuxzinbqvs: send-push, welcome-email`. **A live,
working, currently-green production deploy check that does not know `scan-upload` exists is a false assurance,
not a neglected tool.**

**And `scan-upload` has no `deno.lock`, while `send-push` does** — pinning `jsr:@supabase/supabase-js@2` to
`2.111.0` with SHA-256 integrity hashes. Both import the identical unpinned specifier; only one is locked, and
the unlocked one is the one that holds `SUPABASE_SERVICE_ROLE_KEY`, fetches an attacker-influenced URL, and
calls a paid third party. **principal-security escalated this past where platform put it**, having under-ranked
it in Round 1: exploitability LOW, **blast radius TOTAL** (service_role bypasses every RLS policy these four
ADRs designed), cost of the control **one command and one file matching a file already in the repo**. *"A
control that costs one file and is already applied next door has no acceptable-debt argument available to it.
Calling this debt IS P57's optimistic framing."*

**principal-platform then broke principal-security's compensating-control argument.** `asStatus` degrading to
`'failed'` does protect the *client* — but (i) **the edge function is what writes the row, so an undeployed
function yields zero rows, and `ops_copyright_scans` filters `where s.match_found is true`, so an empty queue is
indistinguishable from a clean campaign**; §G's failure mode is not blocked, it is **relocated from the uploader
to the operator, where nobody is watching**; and (ii) `asStatus` validates **shape, not provenance** — a
tampered function returning a well-formed `{status:'complete', matchFound:false}` passes through untouched.

**The critic constrained how this may be stated, in the batch's favour.** `20260923000000:135-137` records
*"VERIFIED IN PRODUCTION BEFORE WRITING THIS: three rows already carry a bare acknowledgement"* — contemporaneous
in-repo evidence that `scan-upload` **is deployed, has run, has matched, and humans have answered the prompt.**
The empty-queue chain is a sound structural argument about a future outage; **it is not a description of today,
and the board must stop stating it as though it might be.**

### I. DECIDED — the ADR set now misdescribes the system, in nine places

Named by section, because "the docs are stale" is not actionable and P40 says wrong documentation is worse than
none.

| Section | Status |
|---|---|
| **0017 §A** — *escalated; the board did not decide whether to integrate a provider* | **Resolved off-document.** AudD is integrated and deployed. The escalation was answered by building. |
| **0017 §E** — hard delete, irreversible, "remove bytes explicitly", plus the `BEFORE DELETE` guard | **Superseded** by §C and §D of this ADR. The guard shipped in `010000` and was removed in `050000`. |
| **0017 §F** — *"`count(*) from tracks where taken_down_at is not null` is the repeat-infringer count with zero new tables"* | **Superseded and inverted.** The ledger count exists and reads nothing; the erasable count is the one displayed (§D). |
| **0017 §G** — no new edge function, with a named prerequisite | **Contradicted, prerequisite unmet** (§H). |
| **0017 §I.1/§I.2** — `track_id references tracks(id)` + `ON DELETE SET NULL` | **Superseded** by ADR-0019 §B and then by the shipped no-FK column. §I.2's *outcome* stands. |
| **0017 §I.5** — `ConfirmActionModal` bound to Publish | **Superseded** by ADR-0019 §E; the shipped consent is a fire-and-forget row plus a match-triggered form. |
| **0017 §K.1** — probe K1 as written | **Defective.** It asks for one policy and needs two (§K). |
| **0018 §G** — *"§E is not ratifiable"* | **Conclusion obsolete, diagnosis correct and acted on** (§C). |
| **0019 §H** — four candidate placements, escalated | **Resolved by a fifth nobody proposed.** The declaration went into `track_copyright_scans`, so **it exists only for uploads that matched** — and for the uploads that do not match, §A's replacement-for-the-boolean is **still unanswered and effectively unimplemented.** |

**Two sections were marked BLOCKING and the code walked past them. The board names this rather than softening it.**

- **0019 §I** — *"No placement may be ratified until a correction path exists that is neither frozen nor silently
  swallowed."* Shipped: `20260923020000:84-87` raises *'this scan has already been answered'* — **the frozen
  option, verbatim.** `acknowledgeScan` has exactly two call sites, both inside the publish flow; no screen re-opens
  a declaration; and if one tried, the write returns `{error}`, the function returns `false`, and the caller
  `void`s it — **the silently-swallowed option too.** principal-data: *"the system's sole correction mechanism is
  its evidence-destruction mechanism."* **No record of a human override exists anywhere any principal could find.**
- **0019 §J.1** — *"FOR COUNSEL, BLOCKING — do not ship the migration ahead of this answer; building it is taking
  the position."* Eight migrations are applied. **All four principals flagged it; none claims authority to resolve
  it.** principal-platform records the one mitigation: `ClaimBasis` is `'assigned' | 'company' | 'other'` and the
  acknowledgement enum has **no `original`/`cover` values**, so the specific artifact §J.1 feared — a queryable set
  of *"the composition isn't mine"* — was **not** built.

**The board states the strongest case for the shipped design before objecting to it (P54).** principal-client:
§I reasoned about a declaration on *every* upload; what shipped is asked only of uploads that matched a
commercial master — a small, self-selected set, answering a concrete prompt about one named recording, where a
wrong answer is far less likely than on a twelve-field form. **That is a real mitigation. It is not an answer**,
because §I's ground was *"a permanent, attributable, uncorrectable misstatement on file"*, and a wrong
`permission` row is exactly that.

### J. DECIDED — the gaps, ranked by what bites first at ~500 uploads

The campaign is 100 artists × 5 tracks in 1–2 weeks against a system ADR-0017 designed for ~7 uploads/month.

1. **§A — the freeze that does not freeze.** Live, production-reachable today by any uploader, defeats the
   control every evidential claim rests on, and **freezes shut behind the attacker** so repair must remediate
   existing rows. The critic ranks it above the CASCADE and the board records the reason: **the CASCADE requires
   the uploader to delete something; §A requires one PATCH and leaves the row looking clean.**
2. **§G — the quota.** Exploitable now, from one free signup, against a metered third party. Independent of
   this commit.
3. **§E + §D — evidence destruction plus the erasable strike count.** The subject of a claim can delete the
   claim, and doing so decrements the only strike number an operator sees.
4. **The inbound path.** `PostReportModal.tsx:24-30` offers five reasons, none copyright;
   `grep "'copyright'" supabase/migrations/` → zero hits. ADR-0018 §J.1 ranked this **first of five** and items
   2 and 4 shipped while item 1 did not. **principal-platform corrected the framing in a way that changes what
   "fix" means:** a channel *does* exist and is published (`docs/support.html:332-338`, `docs/terms.html:392-397`)
   — it is a personal Gmail address with no triage, no queue and no timestamp. **It is a triage gap, not an
   absence.** And `grep -in "report|copyright|dmca|infring" web/api/share.ts` → **ZERO HITS**: the page a rights
   holder actually lands on offers them nothing. **A rights holder is not a Livil user and does not have the app**
   — so the cheapest genuine improvement is a `mailto:` on the share page, one line, ships today, no release.
   principal-client's ranking survives the correction and the release cycle **strengthens** it: the mobile half
   cannot be there when the complaint arrives whatever is decided today, so it should start earlier, not later.
5. **§F.4 — the split ship.** Old builds upload fine (traced independently by principal-client and
   principal-platform; the critic tried to break it and could not — **uncomfortably, it survives partly because
   the freeze trigger is weaker than advertised**, the P10 shape resolving in the reassuring direction for an
   unreassuring reason). But a takedown today is a **silent disappearance** for a mobile-only creator.
6. **`ops_copyright_scans` truncation.** `order by created_at desc limit 500` in SQL while the *concern* ranking
   is client-side and `includeAnswered` defaults true — above 500 matched scans the oldest **unanswered** rows
   fall off the bottom, silently, in the safe-looking direction.
7. **The tab-close orphan, widened by this feature.** `grep -rn "beforeunload" web/src/` → zero hits. Closing the
   tab while an item sits in `awaiting_rights` means the catch never runs, so `safeRemoveObjects` +
   `safeDeleteTrack` never run, leaving an orphan row and **up to 500 MB of an unreleased master in a public
   bucket** — what the code's own docstring calls *"the worst kind of leak."* `awaiting_rights` does not create
   the hole but **widens the window from seconds of network time to however long a human takes to read a
   copyright prompt**, and puts a stop-and-think moment exactly where the tab is most likely to be closed.
8. **Back-attestation, and the comment that was mandated and not written.** 38 pre-existing tracks and every
   mobile upload in the split-ship window have no attestation row. **ADR-0018 §F.2 and ADR-0019 §F.2 mandated a
   `comment on column` stating that the absence of a row is never evidence of anything. It is not there.** The
   cheapest unfixed item in the set — one comment, no behaviour change — and the guardrail against the failure
   ADR-0018 §F.3 named.
9. **Dead privileged surface.** The branch built **three** read surfaces over consent/declaration data and wired
   **one**. `ops_upload_consent` and `ops_takedown_counts` have zero callers. **A `SECURITY DEFINER` function
   nobody calls is a hole nobody watches**, and one of them is load-bearing for an argument made in a migration
   header (§D).

### K. DECIDED — probe K1 is defective as written, and must be corrected before anyone runs it

ADR-0017 §K.1 says *"with the predicate added"* — singular. **The live SELECT policy on that bucket is
`tracks_media_select_own` (`20260804010000:72-77`), owner-scoped**; `tracks_media_public_read` was destroyed by
the drop-all at `:50-58` and never recreated. This repo already records that storage-api needs SELECT on the row
it touches. **An operator deleting another user's object needs an ops SELECT policy AND an ops DELETE policy. A
probe that adds only the DELETE policy will fail for the wrong reason and be misread as "storage DELETE bypasses
RLS."** Also: `storage.protect_delete()` refuses direct SQL DELETE unconditionally, so **the probe must go over
HTTP, never `psql`.**

**And it is genuinely not settleable from this repository.** The CI shim declares `storage.objects(id, bucket_id,
name, owner)` and a `foldername()` stub; running K1 there proves only that Postgres evaluates a predicate, which
nobody doubts. **K1's real question is whether storage-api's DELETE handler opens its connection as the caller's
role or as `service_role` — a property of a Node service, not of the schema.** The full six-step procedure is in
principal-security's Round 2 record: branch database, two probe policies, upload into another user's folder,
DELETE over HTTP with the ops user's token, record the status verbatim, delete the branch.

**principal-data's distinction, which nobody had drawn:** mobile's `safeRemoveUploadedObjects`
(`src/services/tracks.ts:130-140`) proves the **owner**-deletes-own-objects path works and needs no probe. **K1
is about ops deleting someone else's bytes. The two are different questions and only one is blocked.**

### L. DECIDED — findings recorded in passing, belonging to no decision here

1. **The routing table still does not cover `web/**` or `shared/**`.** ADR-0017 finding 1 raised this; it is
   unchanged, and this review turned on `shared/services/copyrightScan.ts`, `web/api/share.ts` and
   `web/src/screens/Ops.tsx`. **`shared/services/**` remains an explicit contest between client and data. This is
   a defect in `board-routing.yml` and naming it is how the table improves.** It also has no entry for
   `supabase/functions/**`, which is why an edge function reached production with no principal formally owning it.
2. **Nine functions in this batch repeat a mistake the repo already paid for and documented.**
   `20260806040000_revoke_stale_anon_function_grants.sql:1-11` explains that Supabase default privileges issue a
   **direct** grant to `anon`, which `REVOKE ... FROM public` does not touch — that migration exists solely to
   clean up four earlier functions. **This batch made it again in nine**, while the `ops_*` functions in the same
   files carry the explicit anon revoke. principal-security probed and got `moderating_now` → **HTTP 200 to anon**.
   **Exploitability: none today** (the other eight are trigger functions and raise `0A000` if called directly).
   Asserted as control-hygiene against an in-repo precedent, **not** as an exploit. Nine lines.
3. **`list_active_stories`' safety rests on one invisible word.** It is `SECURITY INVOKER` and inner-joins
   `tracks`, so the new predicate applies — **but stories are not posts, and a takedown deletes only `posts`.**
   Add `security definer` for any reason and every taken-down track's audio streams to every follower through the
   story viewer. **`invoker` is the default and therefore invisible in a diff, and nothing tests it.**
   `20260919010000:155-165` proves the project already knows how to assert a function's security mode in SQL;
   that assertion exists for two `ops_*` functions and nothing else.
4. **`track_copyright_scans.scanned_media_url` is a second copy of the media URL in a second table.** Safe today.
   But **"the media URL lives in one place behind one policy" was true before this branch and is false now**, and
   the table it now lives in is the one whose whole purpose is to be handed to outsiders.
5. **The `terms_acceptances` trigger ordering is an authorization control held together by alphabetical naming.**
   principal-client raised it under P60 and **principal-data conceded it fully**: reverse the order and
   `terms_acceptances_verify_track` evaluates against the **client-supplied** `user_id`, so an attacker names the
   real owner, verify passes, the pin overwrites `user_id` back, and the row lands as *attacker attested to a
   track they do not own*. **No test asserts the order**; the suite tests an order-dependent outcome only in the
   order that currently holds. The fix is not a rename ban in a comment — it is **one assertion that a forged
   `user_id` is rejected**, which fails the moment the ordering inverts. Traced, **not executed**.
6. **`ops_restore_track` re-notifies every credited collaborator, every time, with a dead button.** The insert
   fires `tg_notify_track_credits`; no dedupe is possible because the notification omits `agg_key` and the only
   unique index is partial on `agg_key is not null`. Worse, the payload lacks the `answered` key, **so the bubble
   re-renders Accept/Decline for a credit already answered and tapping either silently does nothing.**
7. **`safeDeleteTrack`'s catch is dead code for the failure it was written for**, on both clients: `supabase-js`
   **returns** `{ error }` and does not throw on an RLS refusal. True today, unmonitored, safety margin zero and
   invisible.
8. **`copyrightDeclaration.test.ts` promises a property it structurally cannot hold.** Its docstring says the
   property under test is *agreement with `track_copyright_scans_claim_shape`* and that *"if that constraint
   changes and this file does not, these tests are the thing that should go red."* **The tests never see the
   constraint.** The suite is good; the promise in its header is not kept. The property belongs in
   `copyright-scans.test.sql`, which runs against real Postgres in CI.
9. **A mirror-image NULL near-miss, recorded as a footnote, not a finding.** A CHECK evaluating to NULL
   **passes**. `track_copyright_scans_claim_fields_match_path` (`20260923000000:166-173`) admits exactly the
   combination its header says it prevents when `acknowledgement` is NULL. **Not client-reachable** — the guard
   force-sets `acknowledged_at`/`acknowledged_by` so `ack_shape` rejects first. Reachable only by `service_role`.
10. **A second realtime residue, refuted down and then re-aimed.** The critic found `broadcast_jam_state` —
    definer, granted to `authenticated`, pushing client-supplied jsonb onto a **public** topic. principal-security
    **refuted the caller axis**: it checks `status = 'active' and host_id = auth.uid()`, so only the host of an
    active jam can send, into their own room, on a non-guessable `jam:<uuid>`. **And the copyright harm is near
    zero, because the bucket is public and the URL was never a secret.** But principal-security then named a
    sharper bug neither had: **because the topic is public, Realtime never re-checks membership on subscribe, so
    anyone who ever learned the jam uuid keeps receiving that room's now-playing forever — including a member
    removed from the conversation afterwards.** That is a **privacy** leak, not a copyright one. **It predates
    this batch by four months and this batch does not make it worse. File it; do not gate on it.**
11. **`kb/private/security/threat-model.md` still does not exist** despite being indexed — ADR-0017 finding 4,
    unchanged. principal-security reasoned without it and said so twice. `kb/security/model.md:135,139` is still
    stale on blocking and on moderation tooling, and the second is now doubly false.
12. **principal-data's Round 3b hand-off contained a factual error**, recorded under P6: it advised *"do not apply
    these eight migrations to production yet."* **They are already applied.** The instruction is not actionable and
    a reader should not act on it.

### M. ESCALATED — the board splits 2–2, and the split is definitional

**Final votes after Round 3b:** principal-client **commit**; principal-platform **commit** (withdrew all three of
its Round 1 blockers); principal-security **do not commit as-is** (five blockers, #1 now more severe than its own
Round 2 text recorded); principal-data **moved to block** the batch until a ninth migration ships doing three
things rather than one. The critic: **commit, but the synthesis is under-conditioned**, and it disagrees with the
board's ranking.

**The Chief Architect has no technical vote and does not break this tie.** But the moderator's job is to state
what is actually contested, and here it is not what it appears to be.

> **Question:** Should the branch `agent/copyright-scan` be committed now?
>
> **Position A** (principal-client, principal-platform, adversarial-critic): **Yes.** Every defect found is
> already live in production; the commit creates no new exposure and changes no production state. The branch is
> the only written record of a schema that is already running, and withholding it guarantees that schema exists
> in no reviewable artifact. Fix the short list in the same change and forward-migrate the rest.
>
> **Position B** (principal-security, principal-data): **Not as-is.** Section 0 — the control every evidential
> claim in the batch rests on — does not hold, and the ADR must not record it as if it does. A ninth forward
> migration must land with the change: NULL-safe guards plus a `media_kind` freeze plus remediation of
> already-injected rows, an `uploader_id` snapshot so the evidence remains attributable, and a `deno.lock` on the
> function holding the service-role key.
>
> **Precise point of divergence:** **not whether the defects are real — all five participants agree on every
> finding in §A through §H — but what the word "commit" was being asked about.** Position A reads it as *record
> the work*. Position B reads it as *declare the work done*. Under the first reading Position B's own evidence
> supports committing; principal-security said so itself in Round 2: *"Committing the branch does not create the
> exposure; the DEPLOYED function is the exposure, and it exists right now whether this commit lands or not... I
> said 'same-commit blocker' as though the commit were the trigger. It is not."* Under the second reading,
> Position A's conditions are identical to Position B's blockers and the two positions have the same content.
>
> **What would resolve it:** the maintainer deciding which of three distinct acts is being authorised — `git
> commit` (records state, changes nothing, no CI), `git push`/merge (runs CI, and `enforce-agent-scope.mjs`
> genuinely fails here on five files), or *apply to production* (**already done, before review, which is what
> created this position**). **The board's framed question conflated all three, and that is the Chief Architect's
> defect, not a principal's.**

### N. ESCALATED — three questions the board must not decide

**1. To counsel, and it now has two limbs, not one — BLOCKING and already overrun.**
ADR-0019 §J.1 asked whether recording a rights classification changes Livil's knowledge position. Eight
migrations shipped ahead of the answer. **principal-data asked that a second limb be bundled rather than
arbitrated by the critic, and the board bundles it:** *does Livil's defence rest only on having acted
expeditiously on notice — in which case `moderation_actions` is sufficient and §E is a tidy-up — or does it need
the uploader's own attestation, which is the only document that shifts liability to the uploader and the only one
destroyed by the party it would be used against?*

**A third limb, found by the critic and confirmed by principal-security.** `acknowledged_by` cascades from
`profiles`, so **account deletion is a second evidence-destruction lane** — one tap, user-initiated, no operator
involved. It is redundant today (the row already dies via `track_id`) and **becomes the surviving lane the moment
the ninth migration severs `track_id` — a latent hole that the prescribed fix activates.** It cannot be closed
with `SET NULL`: principal-security executed it and got the guard trigger **and** `ack_shape` vetoing
independently, aborting the parent delete. ADR-0019 §B holds.

**principal-security's reason for routing this to counsel is stronger than the critic's and the board adopts it:**
**this repo already decided the identical trade once, in the opposite direction.**
`20260907000000_terms_acceptance_log.sql:43` cascades terms acceptances on deletion because *"quietly retaining a
row that names a deleted user would contradict a published promise"*, and `docs/delete-account.html` makes that
promise in the strongest available terms. **P54 says we do not unmake that precedent without being able to argue
its case better than its author did.** Whether copyright evidence is the exception — legal hold, or an
anonymised ledger row naming no user — is a statutory-retention question. **Not an engineering call.**

**2. The designated agent and grievance officer.** ADR-0017 §B escalated it; it requires publishing a name and a
physical address, which is the maintainer's call because it discloses personal information. **Still the cheapest
item on the table, still not done, and now roughly 500× more urgent than when it was first written.**

**3. Whether ADR-0019 §I is overridden or still binds.** The code shipped past a section marked BLOCKING. **Either
§I stands and this is unratified, or a human overrode it — and no record of an override exists.** The board cannot
ratify its own bypass. **Silence here teaches that a ratified blocker is optional, which is the more expensive
outcome than either answer.**

### O. THE THEATRE VERDICT — recorded verbatim, because the maintainer asked for it unsoftened

The critic was put on this question directly. Its answer, which the board adopts:

> **Would a rights holder contacting Livil today get a materially better outcome than before this work? Better in
> one specific way, and not in the way that matters most.**
>
> **Better:** there is now a real, deployed, tested actuator. Before this branch an operator who received a
> copyright email hand-wrote SQL and left no record of having done so. `ops_take_down_track` deletes the upload
> post and every repost in one call, writes an append-only ledger row, writes a per-author notice, refuses a
> second takedown so the restore snapshot cannot be nulled, and is reversible. 31 executed assertions constrain
> it. **That is not theatre. It is the difference between "we will get to it" and "it is gone from Livil's
> surfaces in ninety seconds."**
>
> **Not better, two legs.** *(i)* **The path to the operator is byte-identical to a week ago** — the published
> copyright channel is `docs/support.html:317`, a `mailto:` to a personal Gmail, with no form, queue, ticket,
> acknowledgement or timestamp, and this ~9,800-line branch about copyright added nothing to the surface a rights
> holder actually lands on. *(ii)* **What they are asking for is that the recording stop being available, and it
> does not** — four independent mechanisms, §F.
>
> **This batch built the operator's half of the machine and left the rights holder's half exactly where it was.**

**On the second-order question — does the system create a false belief in its own operator — the critic's answer
is sharper and the board records it as the single most important sentence in this review:**

> **It is not a risk. The false belief already exists, in three committed artifacts** — the migration, a **test**,
> and a client comment — all asserting that the strike moved to the ledger so deleting the track is harmless
> (§D). **A wrong belief that reaches a test is no longer a belief; it is an enforced invariant pointed at the
> wrong reader, and it will now defend itself against correction.**

**And on the `status`/`match_found` split**, which the schema calls "the load-bearing line" and the only read
surface discards: **building the distinction and then discarding it is worse than not building it** (P40). *Had it
never been built, nobody would trust the queue. Having built it, the operator is entitled to trust a queue that
structurally cannot carry the information.*

**The board's own framing, added to the critic's:** this is not theatre, because theatre is built to look like it
works and this works. **It is a machine with one end not connected.** The two cheapest items in the entire set —
a `mailto:` on the share page and an honest word instead of "removed" — are the two that would change what a
rights holder experiences.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Declare the batch blocked and withhold the commit** | Withholding does not un-apply eight migrations. The branch is the only written record of a schema already running, and P51 calls unrecorded production state exactly what we cannot reason about, review or restore. **But see the critic's refutation below — this ground is weaker than it looks and must not be reused.** |
| **Accept P51 as sufficient justification for committing** | **Refuted by the critic and the refutation is upheld.** The eight files are already staged on the branch, so the schema is already readable; `git commit` adds durability and history, not reviewability. **The real objection is the ratchet:** P4 was violated when migrations were applied to production from an agent branch before review, and P51 is now invoked to convert that violation into a reason to proceed. *"P51 describes the hole that was dug. It does not justify the next shovel."* The vote is right for a different reason, and **this route to P51 is closed** (§P). |
| **Drop the `track_copyright_scans.track_id` FK, as principal-data specified in Round 2** | **Insufficient, and both the critic and principal-data's own Round 3b check agree.** `ops_copyright_scans` derives `uploader_id`, `username`, `media_kind`, `taken_down_at` and the entire strike count **through** that join, so a surviving row shows `(track unavailable)`, no uploader, and a strike count of **zero** — the safe-looking-failure mistake this table's own header names, reintroduced through a join. `acknowledged_by` is not even in the return list. **It preserves evidence that cannot be attributed.** |
| **Denormalise `uploader_id` onto `track_copyright_scans`** | Adopted as *necessary*, but it contradicts a documented decision in the same header (`20260922100000:247-249`: *"so there is one answer to 'who owns this' and it cannot drift"*). **principal-security resolved it by splitting rather than overruling: the RLS policy keeps its join; the denormalised column is an evidential snapshot, frozen at insert, never used for authorization.** That must be written into the migration header or the next reader will "fix" the duplication. |
| **Restore `trg_tracks_block_taken_down_delete`** | Rejected. It blocks a creator tidying their own profile while protecting nothing the ledger does not already hold. The defect is the *premise* (§D), not the reversal. |
| **Treat the CASCADE as the top-ranked item** | Displaced by §A on the critic's ground, which the board adopts: **the CASCADE requires the uploader to delete something; §A requires one PATCH and leaves the row looking clean.** |
| **Add a read-side `visible` flag, reopening ADR-0017 §C** | Not needed and not done. Deletion remains the primary mechanism, which is what makes the anon share page 404 for free. The `taken_down_at is null` predicate is defence-in-depth for the **non-post** pointers (`album_tracks`, `user_recent_tracks`) and is **not** a §C repeat. Verified by three independent enumeration methods. |
| **Ship the `'copyright'` report reason's DB half alone** | Rejected on ADR-0018's standing "ship both halves or neither" — it creates the obligation with no way to exercise it (P44). **Superseded in practice by a better option: a `mailto:` on the share page**, which needs no DB change, no mobile release, and points at a channel the Terms already promise. |
| **Let the critic arbitrate the evidence-retention question** | Refused. principal-data asked for it to be bundled to counsel instead, and the board bundles it (§N.1). It is a legal-obligation question and P63 puts it outside the board. |
| **Gate the batch on the jam-broadcast residue** | Rejected. principal-security refuted the caller axis and the copyright harm is near zero because the bucket is public. **It predates this batch by four months and this batch does not make it worse.** The privacy limb is filed, not gated. |
| **Compress Round 2 into the critic's round, as ADR-0018 and ADR-0019 did** | Rejected, and the rejection earned itself. Round 2 produced two vote reversals in opposite directions, four principals conceding findings, one false alarm withdrawn entirely, and the `ops_takedown_counts` zero-callers finding that reframed §D. **The compression in ADR-0019 was recorded there as a real cost; this review paid for the full round and got it back.** |

---

## Consequences

**Makes easy.** A real, reversible, audited takedown exists where there was hand-written SQL. The repeat-infringer
ledger survives account deletion by design and **the §512(i) half is correct**. Two upload clients share one
declaration implementation, byte-identical in labels and validation — the divergence risk ADR-0017 worried about
largely did not materialise. The reversibility split solves the Rule 75 problem that made ADR-0017 §E
unratifiable. Everything lives in `public`, so the daily fingerprint covers it; **zero extensions were added**,
honouring ADR-0017 §G's other half.

**Makes hard / forecloses.**
- **Every evidential claim in the batch is currently unsupported**, because §A's control does not hold. Until it
  is repaired, a scan verdict cannot be tied to the file that plays.
- **The ADR set can no longer be read alone.** Nine sections across three documents misdescribe the running
  system, and two of them read as live blockers the code has already passed.
- **A repaired freeze cannot undo existing injections** — the hole locks shut behind the attacker, so repair is a
  data-remediation job, not only a schema change.
- **CI is red on this branch for a reason that is not a code defect**: `enforce-agent-scope.mjs` fails on five
  files because an agent authored them in an area with no executed test coverage. **The board declines to clear
  it and declines to declare it a blocker** — both would collapse proposer into ratifier. Recorded, not decided.
  **It must not be cleared by widening `.claude/autonomy-config.yml`**: that would grant write access on the
  strength of `index.test.ts`, **a test file no CI job executes** — the gate satisfied by the appearance of
  coverage, which is P8's exact failure.
- **The KB `--check` failure is an unstaged-file artifact, not staleness.** The generated docs are current;
  `scripts/kb/generate.mjs:89-108` runs the generators then asks `git status --porcelain`, so it cannot
  distinguish "stale" from "regenerated but not yet added." **Note also that `--check` is not read-only — it
  writes the files it then inspects.**
- **Adding the `'copyright'` reason will create an obligation against a published 24h/15d clock on ratification,
  not on completion** (P44), against one operator who also writes the code.

**Costs not otherwise visible.** `web/src/screens/Ops.tsx` went 684 → 953 lines, 20 → 22 `useState` slots, and
gained a **third** eager mount fetch pulling 500 rows including answered ones. ADR-0017 §J item 3 asked for tabs
and quoted the file's own line — *"the queue that gets scrolled past is the queue that rots — which is how
`post_reports` sat unread for two months."* **This change added a fourth queue to the same scroll.**

---

## Dissent

**principal-security and principal-data dissent from any reading of this document as authorising the work as
done.** Their position is §M Position B and it is recorded, not smoothed. **principal-security's blocker #1 is
§A and it grew rather than shrank under examination**; principal-data moved *toward* blocking in the final round,
against the direction of the other three.

**The critic dissents from the board's ranking**, and this is the dissent most likely to prove right: it ranks
§A above the CASCADE, says **the ninth migration as specified is not a fix**, and says *"It cannot be played."*
must not ship to mobile and should be corrected on web in this commit — *"everything else in this batch can be
argued as incomplete; that sentence is the platform telling the affected party something Livil's own operator
screen says is untrue. Under P43 that is not a polish item."*

**The critic's ruling on the vote crossover, recorded because the board's composition changed on it.**
principal-platform asked the critic to check whether it had folded out of momentum. The critic's answer: **two of
platform's three withdrawals are correct and evidence-based** (`git commit` does not run CI; an agent declaring a
maintainer's gate a blocker collapses proposer into ratifier). **The third was withdrawn purely on the P51
argument, which is the weakest thing in the round** — *"the correct response to a mis-aimed blocker is to re-aim
it, not to withdraw it,"* and principal-data immediately re-imposed it under another name. **So platform's
original instinct was right, the blocker was transferred rather than resolved, and the transfer cost a round.**
By contrast **principal-security's reversal was better-founded**, because it reversed on newly-checked facts —
`ls` showing the missing lockfile, and enumerating the destroyed columns — rather than on a framing argument.
principal-security's own confession is recorded: *"I had ranked severity by how much thought I had already given
something."* Both times, minutes of checking reversed it.

**ADR-0017's original counter-notice dissent is vindicated a second time and the board still has not answered
it.** *"A §512(i) repeat-infringer policy whose strikes cannot be removed when a counter-notice succeeds will
terminate accounts on vacated strikes."* principal-security found the mechanism that makes it worse: **the
complete set of actions a creator has after removal is "Delete permanently" or "Delete this notice", and the only
one that does anything is the one that destroys the platform's own evidence.** *"The absence of an appeal route
does not merely leave the creator helpless — it funnels them, under maximum motive, into the single action that
erases the §512(i) record, the ISRC, and their own strike. The product gap and the control failure are the same
gap."*

**principal-client withdrew the legal framing of that same point, correctly**, and the withdrawal is recorded
because it is the right shape: *"'Inadequate against a 15-day grievance clock' is a legal-sufficiency claim and it
is not mine to make."* What it defends from its own domain: the client presents a terminal state with no
affordance to respond.

**principal-client also withdrew a head-to-head ranking contest it had started**: *"These were never competing for
the same slot, and framing them as a contest was my error."* And it **withdrew its own top-ranked unknown as a
false alarm** — the Ops UI renders a missing consent as the literal string *"Predates the consent boxes"*, never
as an unticked box, and a `false` value is unreachable for an answered row. **`20260923020000:113-115` is
honoured.**

**principal-data withdrew two of its own Round 1 claims** — that the cascade was "unconsidered" (the test suite
names it at `takedown.test.sql:183-185` and deliberately excluded it, though **the exclusion's premise expired two
migrations later and the comment did not**), and that an orphaned consent row would return a false streaming
grant (`ops_upload_consent` returns no grant field at all).

**Attacks the critic attempted and could not land, recorded because a failed refutation is evidence:** a second
permissive SELECT policy on `tracks` that would OR past the new predicate (**exactly one exists across 109
migrations**); a third table holding a media URL (**exactly two**); a fourth definer function returning media
columns (**its own independent parser over all 134 function definitions returned the same answer as two prior
methods**); shrinking the client-playback horizon to "mid-song only" (**no feed refetch on focus exists**);
`ops_takedown_counts` being wired dynamically (**it is not**); and an acknowledgement enum drifting between client
and database (**they match**). **Convergence 4, as rescoped, survived three independent enumerations and is the
most thoroughly attacked claim in this review.**

**One uncomfortable note the critic insisted on and the board records rather than smoothing:** "old builds keep
uploading fine" **survives partly because the freeze trigger is weaker than advertised.** The P10 shape resolved
in the reassuring direction for an unreassuring reason.

---

## Revisit when

- **§A is repaired.** The repair is three parts and a data remediation; **until it lands, no document may cite
  section 0 as a control** and no reply to a rights holder may describe a scan verdict as tied to the file.
- **A production query answers whether any track already has both `audio_url` and `video_url` set.** Expect zero
  rows. Anything returned is either a pre-existing oddity or an injection, **and it cannot be corrected in place
  because the freeze locks it.**
- **Probe K1 runs, with §K's two-policy correction.** If storage DELETE bypasses RLS, ADR-0017 §E is amended to
  say bytes require the dashboard, permanently.
- **Counsel answers §N.1.** All three limbs. The third limb changes the shape of the ninth migration.
- **The first rights-holder complaint arrives.** ADR-0017 said the first one should be treated as a test of this
  machinery. **It now has a second job: it is the only way to find out whether the inbound path works at all**,
  since the instrument that would measure demand still cannot record the quantity.
- **A counter-notice is received.** The unresolved dissent becomes live and the tombstone model needs a rescission
  path before any account is terminated.
- **A second moderator exists**, or **`AUDD_ENTERPRISE_ENABLED` is turned on** (it silently flips every video
  upload between `skipped` and a per-12-seconds-of-audio billable call, and its state is production configuration
  that exists nowhere in the repository — P51).
- **`list_active_stories` is edited for any reason.** Its safety is one default keyword that no test asserts.

### P. A standing rule this review produced

**Applying migrations to production from an agent branch, before review, is a gated action.** It is what put the
board in the position where the only available argument for proceeding was one the critic then showed to be a
ratchet. **P51 is never again reachable by this route**, and a future review that finds itself reasoning *"it is
already applied, therefore..."* should treat that sentence as the finding rather than the conclusion.

---

> **ADRs are append-only.** Do not edit this to reflect a new decision — write a new one and mark this
> `Superseded by ADR-NNNN`. The record of what we believed and when is the point.
>
> **No proposal accompanies this ADR.** The board is at **9 open unratified proposals against a cap of 8** and is
> blocked on its own backlog by charter. The work implied by §A, §D, §E and §H is recorded here and must be
> scheduled by the human directly, or the cap must be cleared first by ratifying or closing the stale drafts.
