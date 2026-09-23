---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-22
verify_every: 9999d
verified_by: manual
supersedes: []
amends: [0017, 0018]
related_adrs: [0003, 0004, 0007, 0008, 0012, 0015, 0016, 0017, 0018]
visibility: public
---

# ADR-0019 — A rights declaration that a cover can answer truthfully

| | |
|---|---|
| **Status** | **Escalated** — the boolean is dead and several sub-questions are decided; the replacement's *shape and placement* are returned to the maintainer and to counsel |
| **Date** | 2026-09-22 |
| **Domain** | data + security (with client) |
| **Decided by** | Targeted board amendment — principal-data, principal-client, principal-security, adversarial-critic. Chief Architect moderating, no technical vote. |
| **Amends** | ADR-0017 §I.1, §I.2, §I.5 and ADR-0018 §L1, §K. **Supersedes neither.** Where this document is silent, ADR-0017 and ADR-0018 govern unchanged. |

---

## Round 0 — triage, stated before anything else

**Warranted?** Yes. Not a challenge under Constitution P53 — the maintainer supplied a *new premise*
(cover songs are a supported, first-class upload type) that the two prior ADRs never reasoned about.
`no_debate` does not cover "an accepted ADR's ruling is premised on a fact that has since changed".

**Routed:** principal-data, principal-client, principal-security, plus the mandatory adversarial
critic. Three principals, under the cap of four.

**The brief suggested two (data, client). The Chief Architect added principal-security** because
`board-routing.yml` makes it mandatory on `supabase/migrations/**` — *"escalate: [principal-security]
# ALWAYS — RLS is the perimeter"* — and this change edits an **evidential** table plus a
`BEFORE INSERT` trigger that is an authorization control. Dropping it to save one agent would have
been the moderator overriding the routing table for convenience. **That addition earned itself:**
principal-security produced the `ON DELETE SET NULL` probe, one of the two load-bearing findings.

**Not routed, and why.** principal-playback (no engine, coordinate or patch surface is touched);
principal-realtime (no presence, jam or push path; the credit notification was read by
principal-data without needing its owner); principal-platform (a mobile build is happening, but the
brief explicitly forbids deciding sequencing against the unknown Apple feedback, so there is no
platform question to put).

**Protocol run.** Round 1 in parallel with no cross-visibility, then the mandatory critic, then this
synthesis. Round 2 cross-examination was **compressed into the critic's round** — the same
compression ADR-0018 used — because the brief scoped this narrowly. **That is a real cost and it
shows below:** the critic surfaced an in-repo precedent (§C) that two principals would very likely
have found in a cross-examination round, and the board is now recording an unresolved choice that a
fuller protocol might have closed.

**Framed question.** *Given cover songs are a first-class, welcome upload type, what is the correct
shape and location of the per-upload rights declaration ruled in ADR-0017 §I?*

---

## Context

### The maintainer's two rulings

**1. ADR-0018 §L1 is CLOSED.** The Terms/campaign contradiction is resolved by maintainer ruling:
*First 100 is marketing only. It does not alter upload terms. Terms apply to every upload, forever,
for everyone.* **No Terms edit, no version bump, no re-acceptance, no hash trap.**

This is recorded as **closed, not as decided by the board** — it was always product direction and
P63 put it outside the board's authority. Its consequences are mechanical and are applied throughout
this document:

| ADR-0018 item | Was | Now |
|---|---|---|
| §L1 | Escalated | **Closed** — maintainer ruling above |
| §I (per-upload attestation) | Blocked on Fact B | **Unblocked from Fact B.** Blocked on §H and §I below instead |
| Web terms-acceptance gate (§K) | Blocked on Fact B; "actively perverse" | **Unblocked.** §K's perversity objection is dead — it was wholly derived from Fact B. §K's *other* three grounds (three readers of one comment ≠ convergence; §B is cheaper and more load-bearing; no mechanism offered for clickwrap→scrollwrap) are untouched, so **the task survives and the ranking still does not** |
| Item 7 of the minimum set (rights notice in invite + `welcome.html`) | Blocked on Fact B for wording | **Unblocked** |
| §L2 (Rule 75), §L3 (designated agent), §L4 (batch UI) | Escalated | **Still escalated.** None depended on Fact B |

**2. Livil supports cover songs**, and is built for small local and regional Indian creators.
Product direction, stated by the maintainer, designed to rather than debated.

### Why ruling 2 breaks ADR-0017 §I

A cover splits ownership precisely along the master/composition line: the performer owns the **sound
recording** they made, and not the **musical composition** underneath it.

**Verified today, and sharper than the brief put it.** `docs/terms.html:351-358` does not merely
imply the split — it *enumerates* it:

> *"You promise that you own, or have permission to use, everything you upload — **the recording,
> the composition**, the artwork, and anything that appears in a video. Uploading someone else's
> music without their permission is not allowed on Livil, **whatever the reason**."*

So §3 already names the composition, and "whatever the reason" forecloses the usual carve-outs. A
single "I own this" confirmation would force a legitimate, welcome cover uploader to tick a false
statement — **which is an attack on the table's whole purpose**, because a row everyone knows is
routinely false proves nothing about the rows that are true.

> **This is a wording problem for a future Terms version, and explicitly NOT for this release.**
> **Deferred**, for the reason the brief gives and the board verifies: a version bump invalidates
> every existing acceptance and forces re-acceptance, which on mobile is a build. `TERMS_VERSION` is
> scraped from a hand-typed `Version 1.0 ·` line (`docs/terms.html:297`) while `sha256` is computed
> over the bytes, and `terms_versions` refuses UPDATE by trigger (`20260907000000:183-195`).
> **Recorded as deferred debt with that reason, not as resolved.**

### A citation defect in the brief, corrected so nobody chases the wrong section

The brief attributes the per-upload attestation ruling to **ADR-0018 §I**. It is **ADR-0017 §I**
(`0017:246`). ADR-0018 §I (`0018:258`) is the human-detector reframe. Every "§I" below means
ADR-0017 §I unless stated.

### The fingerprinting case collapses further — both grounds, stated honestly

The brief asked the board to verify two independent grounds. The board can verify one and **cannot
verify the other**, and says so (P6).

1. **VERIFIED as a property of the technology, not of this repo.** Acoustic fingerprinting matches a
   *specific master recording*. A cover is a different recording and does not match it. So on a
   platform that welcomes covers, **the most rights-relevant upload type is structurally invisible
   to the scanner.** This is a well-established property of how commercial ACR works, and no code in
   this repository bears on it; it is recorded as a domain fact, not as a probe result.
2. **NOT VERIFIED — maintainer-asserted and plausible, and the board marks it rather than adopting
   it.** That commercial ACR catalogues skew to Western/major-label repertoire and would therefore
   recall poorly for small local and regional Indian creators is an assertion about third-party
   catalogue composition. The board has no access to any provider's catalogue and ran no test. It is
   **recorded as the maintainer's premise, and it is NOT load-bearing** — ground 1 carries the
   conclusion alone.

**Net, and it does not reverse ADR-0017 §A.** The detector would rarely fire, and the narrow case it
does catch — a straight rip of a commercial master — is already caught by the maintainer's ear
during First 100 badge review (ADR-0018 §I). ADR-0018 §M's *census* argument is weakened but not
struck: a census of covers is a census of things that, by ground 1, the census cannot see.

### What actually carries the exposure — named, scoped, NOT advised on

**The exposure that matters for a cover-friendly platform is COMPOSITION / publishing rights** —
mechanical and communication-to-the-public licensing (**IPRS** and **PPL** in India; **§115**
statutory mechanicals via the **MLC**, plus PRO blanket licences, in the US). **No fingerprinting
product addresses this.** Providers return *recording* identity; composition ownership is a contract
between writers and publishers and is in no provider's response.

**Engineering facts the board asserts** (and only these):

- No provider integration reduces this, so no purchase decision turns on it.
- **This codebase has no mechanism to meter, report or remit anything per play.** ADR-0018 already
  records plays and egress as entirely unmetered with no alert. If a licence ever required usage
  reporting, **none of the inputs exist.**
- Making covers first-class and publicly labelled moves Livil from "no knowledge" to "a
  self-declared inventory of covers", while the takedown actuator remains double-blocked
  (ADR-0018 §G). The engineering consequence is unambiguous and one-directional: **it raises the
  urgency of the actuator (§J.2) and the designated agent (§B). It lowers neither.**

**The board gives no legal advice and estimates no exposure.** ADR-0018's Dissent records
principal-security's uncited §512(i) claim as *not ratified*; that discipline is held here. The
question is escalated in §J1.

---

## Decision

### A. DECIDED — the single "I own this" boolean is dead

Unanimous across three principals, which under P10 sent it to the critic rather than to synthesis.
**The critic attacked it three ways and failed**, and records the failure as evidence:

- *"Covers overlap `licensed`, so an enum does not partition either"* — reduces the finding, does not
  refute it. Smaller ambiguity beats total ambiguity.
- *"Collect no per-upload declaration at all"* — dies on ADR-0018 §I, which established a **real
  consumer**: the operator listening before granting a badge (`web/src/screens/OpsUser.tsx:22-26`,
  verified verbatim).
- *"The boolean is fine if the Terms are the rule"* — dies on maintainer ruling 2.

The decisive ground, which all three principals reached independently: **the boolean's failure is
systemic and silent** — every row loses value at once and no query can separate a true row from a
false one — **while a mis-stated declaration's failure is per-row and attributable.** P15 prefers
detectable over unrepresentable.

**What is decided is narrow and the board keeps it narrow: the boolean is dead.** The replacement's
shape is §H, and it is escalated.

### B. DECIDED — ADR-0017 §I.2's `ON DELETE SET NULL` mechanism is broken. Its *intent* stands

**Verified by execution on three independent PostgreSQL instances by three different agents**
(17.10, 16.0, 15.18 — none of them Supabase):

`ON DELETE SET NULL` is executed as a real `UPDATE ONLY ... SET track_id = NULL`. That fires
`trg_terms_acceptances_no_update` (`20260907000000:149-152`), which raises unconditionally, which
**aborts the parent `DELETE`**. Representative output:

```
ERROR:  terms_acceptances is append-only: acceptance records cannot be edited
CONTEXT:  SQL statement "UPDATE ONLY "terms_acceptances" SET "track_id" = NULL WHERE ..."
--- track still present? ---  tracks_remaining = 1
```

Shipped as ratified, this would mean:

- **`tracks_delete_own` (`baseline_schema.sql:298-300`) stops working for every attested track — an
  artist could never delete their own work again.**
- `safeDeleteTrack` — the **failed-publish rollback path** (`src/services/tracks.ts:67-73`,
  `shared/services/publishTrack.ts:171-176`) — fails. And because supabase-js returns PostgREST
  errors in `{ error }` rather than throwing, the surrounding `try/catch` catches nothing, so the
  failure is **silent**, leaving an orphan `tracks` row and orphan bytes at a permanent public URL.
  *(The trigger conflict is probed; the non-throwing contract is inferred from the library's
  standard response shape and is NOT probed.)*
- A table `CHECK` tying `source='upload'` to `track_id not null` is **also** vetoed by the same
  referential update (`23514`) — which is `collab_user_xor_custom` (`20260722200000:140-165`)
  repeating a third time. **P2: the repo has already paid for this bug.**

**RULING: §I.2's *outcome* — the attestation must survive deletion of the track — stands, unamended
and correct. §I.2's *mechanism* is struck.** The board states the case for §I.2 before amending it
(P54): CASCADE lets the infringer destroy the attestation automatically at the moment of maximum
motive, and SET NULL was the weakest referential action that preserved the row. That reasoning is
right. The clause is simply unbuildable on this table.

**Which replacement is NOT decided — see §C.**

### C. DECIDED — "no foreign key" is NOT forced, and the ground for rejecting the alternative is refuted

principal-data and principal-security both concluded `track_id uuid` with **no FK**, rejecting a
carve-out in the no-update trigger on the ground that it re-opens §I.2's own attack: an infringer
nulls their own `track_id` with a direct `PATCH` instead of a `DELETE`.

**The critic refuted that ground by execution.** Under the real posture — RLS on, `insert` and
`select` policies only, **no UPDATE policy** — as role `authenticated`:

```
-- PATCH trying to exploit the carve-out (track_id -> NULL) --   UPDATE 0
-- DELETE of the attestation --                                  DELETE 0
-- row unchanged, track_id intact
```

The trigger never fires for a client, because **RLS never matches a row to update.** The trigger
binds only the owner and `service_role` — the same principal that `20260907000000:154-155` already
permits to `DELETE` the row outright. **Refusing a narrow `track_id → NULL` update while permitting
that same principal an unrestricted delete is not a threat model.**

**And the pattern already ships in this repository.** `20260804030000_freeze_post_track_id.sql:56-64`
implements exactly this carve-out, for exactly this referential action, on `posts.original_post_id`:

```sql
-- Allowed only when this is the FK's ON DELETE SET NULL firing: the column is being
-- cleared, and the post it pointed at no longer exists.
if not (new.original_post_id is null
        and old.original_post_id is not null
        and not exists (select 1 from public.posts where id = old.original_post_id)) then
  raise exception 'posts.original_post_id is immutable'
```

**Three agents read that file — principal-client cited it by line range as its freeze-trigger model —
and none noticed it contains the solution two of them declared unbuildable.** That is the finding,
not the instance, and it is the second time in three ADRs that a stale or unread in-repo comment has
misled this board.

**RULING: the board records that both mechanisms are buildable and does NOT pick between them.** The
Chief Architect has no technical vote, the principals never saw the carve-out precedent, and the
compressed protocol (Round 0) is why. An unnamed property nobody argued either way: **no-FK leaves
`track_id` a dangling pointer after deletion rather than NULL, which is arguably *better* for §I.2's
stated goal** — the row keeps naming the track it was about.

**What would settle it:** re-run the three probes against a **Supabase branch database** with the
real `20260907000000` applied and PostgREST in front. The critic marks as *inferred* that PostgREST's
PATCH path behaves as a raw `UPDATE` under RLS; that is the one assumption the whole refutation rests
on, and it is cheap to check.

### D. DECIDED — `track_collaborators.custom_name` is the WRONG home for cover metadata

The brief asked the board to test this hypothesis. **Refuted, on grounds the board verified
independently.** The sharpest is not the one anyone expected:

1. **A typed name renders as CONFIRMED, not pending.** `src/services/tracks.ts:574-578` hard-codes
   `status: 'accepted'` for any row with a null `user_id` — *"Nobody to confirm a typed-in name, so
   it is never shown as awaiting confirmation."* `src/components/FullScreenPlayer.tsx:722,736` paints
   the amber pending clock only when `status === 'pending'`. **So writing "A. R. Rahman" on a
   stranger's cover renders identically to a credit A. R. Rahman personally confirmed** — a
   manufactured public endorsement. **This is a live defect on the 38 existing tracks today, entirely
   independent of covers**, and the critic confirmed it is aggravated by the fact that real pending
   credits now *do* render distinctly.
2. **No notification fires for a typed name.** `tg_notify_track_credits` (`20260806130000:73`) selects
   `where c.user_id is not null`. Combined with (1): displayed as confirmed, silently, with no path
   for the named artist to contest.
3. **Tagging the real profile is worse.** A notification fires, the artist gets Accept/Decline, and
   **Decline removes the credit entirely** — `fetchTrackCollaborators` filters `.neq('status',
   'declined')` (`tracks.ts:652`). A rights declaration a third party can delete is not a
   declaration.
4. **Semantics.** `ROLES` (`shared/constants/roles.ts:21-35`) answers *"what a person did on **this**
   track"*. `Songwriting` on a cover asserts the original writer played on your recording. The file's
   own header warns against exactly this overloading.
5. **Invisible on two of three surfaces.** `web/src/screens/TrackDetail.tsx` renders no credits at
   all; `shared_post_public` selects only `t.title` from tracks (`20260901000000:104`), so the anon
   share page shows nothing either.

**Complementary, and left exactly as it is.** A *tagged, accepted* credit remains the one thing that
can make a cover credit verifiable rather than asserted. **Do not extend `track_collaborators`; do
fix (1) separately.**

### E. DECIDED — ADR-0017 §I.5's `ConfirmActionModal` placement is struck; its RULE survives

§I.5 prescribed *"a confirm step bound to the Publish action, `ConfirmActionModal`-shaped"*.
**`UploadScreen.tsx` imports `ConfirmActionModal` zero times** (verified), against 14 other files
that do; the screen has its own bespoke success modal. And §I.5's load-bearing argument was the
failure envelope — which ADR-0018's Dissent already showed was argued from a stale comment.

**What survives is §I.5's actual rule: never a checkbox among twelve fields, and bound to Publish.**
The repo already proves a blocking *field* satisfies it. `uploaderRole` is bound at four layers —
`canSubmit` (`UploadScreen.tsx:319-325`), `handleSubmit` (`:333-336`), the web Publish `disabled`
(`web/src/screens/Upload.tsx:355-361`), and `validate()` before bytes move
(`shared/services/publishTrack.ts:117-118`) — and it is the one queue field with **no batch-apply
path**, which is the precedent for declining one here.

### F. DECIDED — "a record, never a gate" (ADR-0018 §F) SURVIVES and strengthens

The brief's read was that a basis selector strengthens §F because it is plainly a declaration.
principal-client was asked to challenge it and did, on three grounds. **Adjudicating between them on
evidence:**

- **The strengthening is real, and stronger than the brief's reason.** Not "it looks like a
  declaration" but: **no value of a basis denies publication.** A boolean at least had a `false` a
  gate could key on. `original | cover | licensed` are all permitted. The only gate-shaped thing left
  is "did you answer at all", which is a client-side `if` in front of an unconstrained PostgREST
  insert — decoration (ADR-0017:42). **There is nothing left to gate on.**
- **principal-client's counter — that a `cover` branch reads as an implied promise that Livil clears
  covers — is UPHELD as a real risk and is a UI-copy constraint, not a schema one.** It is answered
  by keeping the two concepts apart: the field describes *what the work is*; it must never assert
  *that it is lawful*. Conflating them is what forced the false tick in the first place.
- **principal-client's sharpest counter — that a "covers of X" discovery surface makes absence
  load-bearing — has the right conclusion and the WRONG CITATION, and the critic caught it.**
  ADR-0018 §F.3's trigger is scoped to *"the moment a **takedown decision** keys off attestation
  presence."* A discovery index is not a takedown decision. **The ship-separately recommendation
  survives on its own ground; §F.3's trigger is not yet fired.**

**Two amendments to §F, both adopted:**
1. **§F.3's trigger is WIDENED**: from "keys off attestation *presence*" to "keys off attestation
   presence **or basis value**". "Auto-review everything declared `cover`" would turn the record into
   a queue, and §F must be revisited then.
2. **§F.2's mandated `comment on column` must be REWORDED.** "Absence is never evidence" remains true
   but is now half the statement, because a *present* row carries a classification. The comment must
   also say: the value is the uploader's own claim, never verified, never rewritten by the server;
   `cover` asserts something about the **sound recording only** and nothing about the composition;
   and it must not be read as a licence.

### G. DECIDED — the `'copyright'` report reason needs no sibling, but `details` must become mandatory

The brief asked whether "this is my song, they covered it without a licence" needs its own reason.
**No.** Inventing `copyright_master` vs `copyright_composition` before a single copyright report has
ever been filed is the `ops_reports_queue` speculative-enum rejection one column over, and both types
produce the **same operator action**: assess, then remove or not. `reason` drives nothing but a label.

**But the one structural difference must ship with it:** `details` is nullable on all three tables
(`20260607000007:12-13`, `20260607000004:76-77`, `20260808110000:40-41`), and **a copyright report
that names no work is unactionable by anyone.** Make the illegal state unrepresentable (P15) — add a
`reason <> 'copyright' or length(btrim(coalesce(details,''))) >= N` constraint alongside the widened
`reason` check, on all three tables.

**ADR-0018's "ship both halves or neither" still binds and is NOT satisfied.** The picker is
hardcoded in `src/components/PostReportModal.tsx:25-26` and two siblings, and **`web/` still has no
report-submission path at all.** With `src/` back in scope the mobile half is now shippable — the web
half is not. **No sequencing claim is made against the iOS release.**

### H. ESCALATED — the shape and placement of the declaration

**The board could not settle this, and the reason is not a failure of analysis: each of the three
placements was broken by verified evidence, and the critic then proposed a fourth that nobody had
considered.** Full statement in §J2. Summarised here because it is the operative output:

| Placement | Proposed by | Broken by (verified) |
|---|---|---|
| **Split** — `terms_acceptances.basis` + public `tracks.cover_of_*` | principal-data | The public half carries the maximal queryable-set exposure (below) |
| **All in `terms_acceptances`**, corrections by APPEND | principal-security | **Append is unbuildable on §I.1's unique index** — it raises `23505`, and `src/services/terms.ts:68-76` swallows exactly `23505` as *success*. A creator correcting `original → cover` gets a success toast and no correction |
| **All on `tracks`**, frozen `null → value once` | principal-client | Repeals §I.1's `source='upload'` row without framing it as a repeal; and once frozen, **a creator who later realises it is a cover can never correct it** |
| **No enum at all** (the critic's fourth option) | adversarial-critic | Not yet examined by any principal |

**The critic's fourth option, recorded in full because it is the most likely thing to be proposed
again (P11):** §I.1's `source='upload'` row **already carries a positive assertion** — its existence
means "I attested for this track". So *row present + no named work* = declared original; *row present
+ named work* = declared not-wholly-mine; *no row* = not asked. **Three states, no enum, no CHECK, no
`licensed`, no `NOT NULL` question.** And its sting: an enum on `tracks` *plus* an attestation row is
**two client-asserted signals for one fact — verbatim the ground ADR-0018 §E used to reject
`publish_surface`.** The board would be doing in §I what it refused in §E, in the same week.

**Three verified facts that any resolution must survive:**

1. **The queryable-set risk is aimed at the wrong table.** `terms_acceptances_select_own`
   (`20260907000000:125-128`) means `where basis='cover'` is readable **by nobody but the row's
   owner**. On `tracks`, `tracks_select_authenticated` is `to authenticated`, **RLS is row-level and
   cannot withhold a column**, and a column-level `REVOKE` is silently undone by CI's
   `grant all on all tables in schema public to authenticated` (`.github/workflows/ci.yml:213`) — a
   trap the terms migration itself already records at `:160-162`. **So the exposure principal-security
   priced at ~25% is near zero for its own placement and maximal for the two public ones.**
2. **"The detector cannot read it" is NOT a tiebreaker.** Both principals independently found that
   `terms_acceptances_select_own` hides the declaration from the one human detector
   (`OpsUser.tsx`). **The critic showed `tracks` is no better:** `ops_tracks_for_user`
   (`20260919010000:58-70`) returns an **explicit column list**, and adding to it fails with
   `cannot change return type of existing function` — so **both placements require the same
   drop-and-recreate of the same `SECURITY DEFINER`, with the same P17 exposure.** Nobody costed it;
   it must be scoped into whichever design wins, preserving that migration's self-verification
   `DO` block.
3. **`NOT NULL` on a `tracks` column is a production outage**, and the obvious fix is worse.
   Mobile is `versionCode 72` / `2.0.7` with no OTA, and neither `src/services/tracks.ts:363-373`
   nor `shared/services/publishTrack.ts:219-234` sends such a column, so every upload from every
   existing install would fail. **And `NOT NULL DEFAULT 'original'` would not fail — it would
   silently declare every mobile upload original.** Stated explicitly because that is how someone
   will "fix" the outage.

### I. DECIDED as BLOCKING — no proposal on the table can express a CORRECTION

**The single most consequential gap, and it belongs to none of the three positions — it is common to
all of them.**

- principal-client's freeze trigger: correction impossible by construction.
- principal-security's append model: raises `23505` against §I.1's unique index, and `terms.ts:68-76`
  **swallows `23505` as success**, so the failure is silent and the creator is told it worked.
- principal-data's split leaves the *caption* correctable and the *declaration* frozen, which is
  coherent but never addressed correcting the declaration itself.

**A rights declaration that is write-once-and-wrong-forever is not better than no declaration — it is
a permanent, attributable, uncorrectable misstatement on file, which is the exact failure §A said the
boolean had.** No placement may be ratified until a correction path exists that is neither frozen nor
silently swallowed. The critic notes this is **cheaper to settle than the placement question**, and
the board agrees: settle it first.

### J. ESCALATED — three questions the board must not decide

> **1. Does recording a rights classification change Livil's position? — FOR COUNSEL, BLOCKING**
>
> **Question:** Relative to recording nothing, does storing each uploader's own classification of
> their rights — `original` / `cover` (with claimed original title and artist) / `licensed` — change
> Livil's knowledge position under DMCA §512(c)/(d) or India's intermediary-liability rules?
> **Position A (all three principals):** collect it — a boolean that a supported upload type cannot
> answer truthfully measures nothing, and the declaration is falsifiable where a tick is not.
> **Position B (principal-security's own counter, which it raised against itself):** `basis='cover'`
> creates a queryable set of tracks whose uploaders have told Livil the composition is not theirs,
> while the takedown actuator stays double-blocked (ADR-0018 §G) — ADR-0017's red-flag-knowledge
> finding in a form somebody can query.
> **Precise point of divergence:** whether *soliciting and storing* a self-classification is
> net-protective or net-harmful. Not a question about which column — a question about whether to
> collect at all.
> **What would resolve it:** counsel, on that one question. **principal-security ranks ~25% that the
> answer kills the feature**, in which case the correct output of this entire debate is *"collect
> nothing; fix the Terms wording instead."* **Do not ship the migration ahead of this answer** —
> building it is taking the position.
>
> **And separately, not bundled with it:** does Livil require its own communication-to-the-public and
> mechanical licences for the compositions underlying hosted covers (IPRS/PPL in India; §115/MLC and
> PRO blanket licences in the US), or does that sit with the uploader? **No fingerprinting product
> addresses this.** The board names and scopes it; it does not advise on it and offers no estimate of
> exposure.

> **2. The shape and placement of the declaration**
>
> **Question:** Where does the per-upload rights declaration live, and does it need an enum at all?
> **Position A (principal-data):** split — immutable `basis` in `terms_acceptances`, public
> correctable `cover_of_title`/`cover_of_artist` on `tracks`. They have opposite mutability
> requirements and no RLS overlap, so this is a fact and a caption, not two truths.
> **Position B (principal-security):** all in `terms_acceptances`, with a shape CHECK forcing detail
> on `cover` and `licensed`; the public display half is a *different* data item that must not be
> built from this table.
> **Position C (principal-client):** all on `tracks`, in the existing pre-bytes INSERT, so it is
> atomic with the track and needs no second row and no failure envelope.
> **Position D (adversarial critic):** **no enum.** The `source='upload'` row's existence is already
> the positive assertion; a named work distinguishes cover from original. An enum *plus* that row is
> two client-asserted signals for one fact — the ground ADR-0018 §E used to reject `publish_surface`.
> **Precise point of divergence:** whether the declaration is *evidence* (immutable, private,
> belongs in the append-only log) or *metadata* (public, correctable, belongs on the track). A cover
> is genuinely both, and **no participant found a single location that serves both without either
> forbidding correction or exposing the classification to every signed-in account.**
> **What would resolve it:** J1's answer first — if counsel says collect nothing, this question
> disappears. Then §I's correction path, which constrains every option. Then one Round 2
> cross-examination with Position D on the table, which no principal has seen.

> **3. Does `licensed` ship on day one? — PRODUCT**
>
> **Question:** Is `licensed` a real day-one value or speculative generality (P25)?
> **Position A (principal-data, self-declared coin-flip):** keep it — dropping it recreates Fact 2's
> defect one upload type over, since a label-cleared remix is neither `original` nor `cover`.
> **Position B (the critic):** cut it — `licensed` **does not partition**. For Livil's stated
> audience a ₹500 beat lease is defensibly `original` *or* `licensed`, and a Bollywood cover is
> defensibly `cover` *or* `licensed`. It is not merely unexercised; it is a legal characterisation
> the creator cannot reliably make.
> **Precise point of divergence:** whether `licensed` names a distinct state or overlaps the other
> two. principal-data could evidence **no** day-one use.
> **What would resolve it:** one question to the maintainer — *has any existing profile uploaded
> something they paid for a licence to use?* If no, ship two values; a fourth can be added later,
> and adding an enum member is far cheaper than removing one.

---

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Keep the single "I own this" boolean** | §A. Its only honest answer for a supported upload type is `false`, so honest cover uploaders must lie or be blocked. Its failure is systemic and silent — every row loses value at once and no query separates true from false. Survived three refutation attempts by the critic. |
| **Ship ADR-0017 §I.2's `ON DELETE SET NULL` as ratified** | §B. Verified broken on three independent Postgres instances: the referential action is an `UPDATE`, the append-only trigger vetoes it, and the parent `DELETE` aborts. Artists could never delete their own tracks, and the failed-publish rollback would fail silently. |
| **`track_id uuid` with NO foreign key, as the only survivor** | §C. It remains a legitimate option, but the ground for rejecting the alternative is refuted: the carve-out does not re-open the attack (RLS never matches a row for a client — probed: `UPDATE 0`, `DELETE 0`), and `20260804030000_freeze_post_track_id.sql:56-64` already ships the pattern for the same referential action. Choose it on its merits, not as the only thing left. |
| **Carve an exception into `terms_acceptances_no_update` for the RI set-null** | Not rejected — **re-opened.** Two principals rejected it as a P57 hole in the operator-binding trigger; the critic showed the operator may already `DELETE` the row outright, so the "hole" grants nothing new. Both mechanisms are now live options (§C). |
| **`track_collaborators.custom_name` as the cover-metadata home** | §D. `src/services/tracks.ts:574-578` hard-codes `status:'accepted'` for null-`user_id` rows, so a typed name renders identically to a personally-confirmed credit — a manufactured public endorsement, with no notification and no path to contest. Tagging the real profile is worse: Decline deletes the credit. |
| **A new `Original artist` / `Originally by` entry in `ROLES`** | §D.4. `ROLES` answers "what a person did on *this* track"; the role column is free text and `isPresetRole` only distinguishes picked from typed, so three spellings of one credit is the exact drift `roles.ts` exists to prevent. |
| **A canonical `works` table for cover targets now** | Zero occurrences exist. P25: the third occurrence justifies the abstraction. Ship free text with a partial expression index, let the real fragmentation distribution appear as a measurement, and introduce a join key when it is one. |
| **Wire cover text into `searchPosts` in v1** | `src/services/posts.ts:624-645` builds `.or(terms.join(','), {foreignTable:'tracks'})` — an extra ILIKE per column per query, and a search for the song would rank the original and every cover identically, which is worse than today. Discovery belongs on the track page against the index. |
| **A `copyright_composition` sibling for the report reason** | §G. Speculative enum before a single copyright report has been filed, and both produce the same operator action. The real gap is that `details` is nullable, which makes such a report unactionable. |
| **`NOT NULL` on a `tracks` basis column** | §H.3. `versionCode 72`, no OTA, neither client sends the column — every upload from every existing install fails. **And `NOT NULL DEFAULT 'original'` is worse:** it would not fail, it would silently declare every mobile upload original. |
| **Edit `docs/terms.html` §3 now to accommodate covers** | Deferred, with the maintainer's own reason: a version bump invalidates 12 acceptances and forces re-acceptance, which on mobile is a build. §3 already enumerates "the recording, **the composition**", so this is a real wording defect — recorded as deferred debt, not as resolved. |
| **Ship the migration now and ask counsel in parallel** | §J1. Building the collection mechanism is taking the position on whether collecting helps or harms. ADR-0017 §I.3's discipline — *ship the pin extension with the column or do not ship the column* — binds one level up. |

---

## Consequences

**Makes easy.** Fact B is gone: ADR-0018's per-upload attestation, its web terms-acceptance gate, and
the rights-notice copy all leave the "blocked" table. The cover-metadata question is settled against
the credits system on verified grounds, so nobody re-proposes it. Three live defects were found that
have nothing to do with covers and are worth fixing on their own (below).

**Makes hard / forecloses.**
- **The attestation still cannot ship**, and the blockers changed rather than cleared: it was blocked
  on Fact B; it is now blocked on **counsel (§J1)** and on the **correction path (§I)**. Honest
  accounting — this ADR did not unblock the item ADR-0018 named as most urgent.
- **Correction is unsolved in every proposal on the table** (§I), and a write-once-wrong-forever
  declaration reproduces the exact failure §A attributed to the boolean.
- **Whichever placement wins, a `SECURITY DEFINER` must be dropped and recreated** (§H.2) — P17
  treatment, an `is_ops()` gate before parameters are read, a pinned `search_path` ending in
  `pg_temp`, and an RLS test. **Nobody costed this**, and without it the feature produces data the one
  human detector cannot read.
- **A public cover label is a self-declared inventory of covers** while the takedown actuator stays
  double-blocked. This raises the urgency of ADR-0018 §J.2 and §B; it lowers nothing.

**Live defects found in passing, none caused by this work.**
- **Manufactured endorsement** — `src/services/tracks.ts:574-578` renders typed credits as confirmed.
  Affects the 38 existing tracks today.
- **The web upload queue publishes a stale snapshot** — `web/src/upload/queue.ts:238-245` captures
  `snapshot` once while `Upload.tsx:453` keeps rows 4–12 editable at `MAX_CONCURRENT = 3`, so an edit
  renders and does not publish. **This also un-solves ADR-0018 §L4**: principal-client argued the
  batch problem dissolves because the field is atomic with the `tracks` INSERT, and filed the
  snapshot defect in the same position — atomicity buys nothing against a snapshot that is already
  wrong. *Read, not run.*
- **`src/services/terms.ts:68-76` swallows `23505` as success**, which is what makes §I's correction
  failure silent rather than loud.
- **ADR-0017 §I.4's latent bug is unchanged**: `terms.ts:17` still types `'upload'` while the DB
  permits two values.

**A knowledge-base defect, aggravated, and the board's own.**
**ADR-0017:349 and ADR-0018:251 both quote `tracks_select_authenticated` as `using (true)`. It has
not been that since 2026-08-09** — the real body is `uploader_id = auth.uid() or not
public.is_blocked_between(...)` (`20260809000000:150-156`). The conclusions survive; the quotes do
not. **ADR-0018 §H attached the word "Re-verified" to the false quote.** And the correction is
already in the repository: `web/src/screens/OpsUser.tsx:28-32` records that this exact stale sentence
*"is what shipped the 'No uploads' bug."* **The board reintroduced, twice, an error the codebase
documents as having already caused an outage** (P40).

**Process cost, recorded against the board itself.** Compressing Round 2 into the critic's round let
an in-repo precedent (§C) reach synthesis unexamined, and §C is now an open choice instead of a
ruling. That is the price of the narrow scope, and it was the right trade — but it is a price.

---

## Dissent

**principal-client argued the declaration belongs wholly on `tracks` and the board did not adopt
it.** Its strongest point is unrefuted and is the most likely line here to prove right later: *a
column in the existing pre-bytes `tracks` INSERT is atomic with the track by construction — there is
no ordering to get wrong, no second row, no failure envelope.* What stopped adoption was that it
repeals ADR-0017 §I.1's `source='upload'` row without framing it as a repeal, and that its freeze
trigger makes correction impossible.

**principal-security ranks ~25% that its own §J1 escalation kills the feature it designed.** Recorded
because a principal arguing against its own proposal is the cheapest evidence the board gets. If
counsel agrees, §A's conclusion stands but the correct action is to collect nothing.

**principal-data kept `licensed` while conceding it can evidence no day-one use**, and called it a
coin-flip. The critic argued it does not partition at all. Escalated at §J3 rather than decided.

**principal-data cited `track_collaborators.status` as a live receipt against three-value enums in
this repo — and the critic refuted it.** `20260806130000:3-6` is the **bug description of the
migration that fixed it**, not a live receipt; since then all three values are written and pending
renders distinctly. **The repo's live receipt points the other way: a three-value enum here works.**
Recorded as principal-data's error, and as a caution about quoting a migration header without
checking what the migration then did.

**The critic could not kill four things, and a failed refutation is evidence** (the discipline
ADR-0018 established): the basis-over-boolean direction survived three distinct attacks; the
`ON DELETE SET NULL` finding replicated on a third instance; ADR-0017 §I.3's pin hole is real and
unchanged; and the manufactured-endorsement defect is confirmed and aggravated.

**Unprobed and named as such** (P6): that ACR catalogues recall poorly for regional Indian repertoire
(§ Context — maintainer-asserted, not load-bearing); that PostgREST's PATCH path behaves as a raw
`UPDATE` under RLS (the assumption §C's refutation rests on); that supabase-js returns PostgREST
errors without throwing (§B's silent-rollback consequence); the `searchPosts` PostgREST filter-grammar
comma behaviour; the web stale-snapshot defect (read, not run); and **all three probes ran on stock
PostgreSQL, never on Supabase's build** — the §B/§C probes should be re-run on a branch database
before either is treated as settled. principal-security additionally recorded that it reasoned
**without the private threat model**, which does not exist at the path the public stub names.

---

## Revisit when

- **Counsel answers §J1.** Everything else forks on it. If the answer is "collecting harms", §A stands
  and the output becomes *collect nothing, fix the Terms wording*.
- **A correction path exists** that is neither frozen nor silently swallowed (§I). Nothing ships first.
- **The §B/§C probes are re-run on a Supabase branch database** with PostgREST in front.
- **The maintainer answers §J3** — whether any existing profile has a licensed upload.
- **Any takedown decision begins keying off attestation presence *or basis value*.** ADR-0018 §F.3's
  trigger, widened here.
- **A "covers of X" discovery surface is proposed.** Ship it separately from the field, and price the
  public exposure in §H.1 at that point, not before.
- **`docs/terms.html` is versioned for any other reason.** That is the cheap moment to fix §3's
  "the recording, the composition" wording, since the re-acceptance cost is already being paid.
- **Cover-title fragmentation becomes a measurement** rather than a worry. That is when a canonical
  `works` join key stops being speculative generality.

---

> **No proposal accompanies this ADR.** The board is at or over its WIP cap and **still cannot measure
> it**: 7 proposals are unambiguously open, and PROP-0006/0007/0008 carry the *unedited template
> status line* (`**Draft** · Ratified · Rejected · Deferred · Implemented`), so they parse as neither
> draft nor ratified. The true count is somewhere in **7–10 against a cap of 8**. ADR-0018 recorded
> this as finding #2; it is unrepaired, and **the inability to measure the cap is the defect, not the
> number.** The operative output here is escalation, not work.
