---
tier: 4
owner: principal-security
consumers: [ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [4, 7]
---

# ADR-0012 — Ratify PROP-0002 with modifications: explicit verbs, hard upload precondition, extend the parity gate

| | |
|---|---|
| **Status** | **Accepted** (companion to ADR-0007) |
| **Date** | 2026-07-24 |
| **Domain** | security (with data) |
| **Decided by** | Architecture Board — LIV-8 debate |
| **Participants** | principal-data, principal-security, adversarial-critic |

> Board recommendation — PENDING FOUNDER RATIFICATION (2026-07-24).

---

## Context

ADR-0007 (Accepted, 2026-07-21) decided: reflect production storage config first, then commit
one faithful, idempotent migration declaring both buckets (`public`, `file_size_limit`,
`allowed_mime_types`) plus scoped write policies on `foldername[1] = auth.uid()::text`, with
`drop policy if exists` by name for every reflected policy, reads staying public, and
verification by **live probe**, not merge. PROP-0002 is that work, still "Draft." LIV-8 asks the
board to finalize the ratification recommendation.

Re-verified still-true: `storage.objects` has RLS enabled and, per ADR-0007's human-verified
findings, zero policies. `src/services/uploads.ts` still builds the path
`${userId}/${trackId}/${kind}.${ext}` where `userId` is a **client-supplied** argument (not
derived from the JWT server-side); `x-upsert: false` is a client header; `contentType` comes
from the picker. No storage migration has landed since 2026-07-21 (git log confirms only
auth/RLS/counter work). Album covers in the `avatars` bucket use the same `{userId}/…`
first-segment shape, so the `avatars` write predicate covers them — narrowing an ADR-0007 open
question.

## Decision

1. **REAFFIRM ADR-0007** under Constitution P53 — no constraint changed, no new evidence
   contradicts it. Reflect-production-first is still correct precisely because this repo's own
   `avatars` migration is a proven false artifact (in git, never applied). Recommend the founder
   ratify PROP-0002 **with the modifications below**.

2. **MAKE THE POLICY VERB LIST EXPLICIT — and include DELETE.** PROP-0002/ADR-0007 say "write
   policies" without naming `INSERT`/`UPDATE`/`DELETE`. This is a real cross-proposal hazard:
   PROP-0003 (in-app account deletion) is already **RATIFIED** (2026-07-23) and its plan requires
   an authenticated client `DELETE` against storage under the user's own `${userId}/` prefix. If
   PROP-0002 ships INSERT-only, it silently forecloses PROP-0003's ratified plan the day someone
   implements it. The scoped policies must cover `INSERT` + `UPDATE` + `DELETE` on the
   `foldername[1] = auth.uid()::text` predicate (matching the `avatars` migration, which already
   writes all four verbs), so self-service deletion is possible and no cross-user delete is.
   Reflect the `avatars` policy's verb set rather than guessing.

3. **MAKE "CONFIRM UPLOADS WORK TODAY" A HARD PRECONDITION**, run before the migration is
   authored — not folded into post-merge verification. The live probe from ADR-0007's step 1
   (reflect production) must be re-run immediately before writing SQL (the 2026-07-21 findings
   are three days stale; a dashboard edit could have changed them). Justification is the repo's
   base rate for exactly this failure class — D-54 (push dead and unnoticed), D-59 (comment likes
   silently dropped), D-61 (a migration merged and unapplied for six weeks) — not the "23 objects
   dated 2026-07-07" artifact, which is **not proof of an outage** (a migration-tooling timestamp
   reset explains it equally well).

4. **EXTEND THE PARITY GATE to the storage schema.** `scripts/schema-fingerprint.sql` — the
   control this org built specifically to catch merged-but-not-applied drift — is hard-scoped
   `where nspname = 'public'` and does **not** cover the `storage` schema. So the one automated
   guard against the failure this whole ADR fears is structurally blind to the migration under
   debate. Extend the fingerprint to cover `storage.buckets` config and `storage.objects`
   policies (cheap, mirrors what exists), OR log this as a named tracked gap. This closes the
   D-55/D-61 blind spot rather than letting it recur a fourth time.

5. **The board must not assert storage is either safe or exploitable** — preserve ADR-0007's
   calibrated refusal. A third state exists beyond "deny-by-default" and "bypass":
   `storage.objects` is owned by `supabase_storage_admin` with `FORCE RLS` off, so if the storage
   service issues queries as the table owner it bypasses RLS regardless of policy count, making
   the zero-policy count irrelevant. The countervailing evidence (the `avatars` bucket ships
   hand-written write policies, which only makes sense if RLS is the enforcement mechanism) is
   suggestive, not proof. Only the live probe settles which state we are in — and that this is
   unknowable from the repo is the defect being fixed (P57: a silent policy gap in the perimeter
   is a vulnerability with optimistic framing, not housekeeping).

6. **Do not wait on LIV-35 (transcoding/R2).** Constitution P51 stands on its own: versioning
   today's live storage config has value for today's incident response even if R2 later
   supersedes it, and PROP-0002 changes no topology/path/client-contract, so it costs nothing to
   retire if R2 ships. Drop the LIV-35 citation as load-bearing — P51 alone justifies proceeding.
   LIV-35 is Deferred (ADR-0010) and unbundled from R2 anyway. Record the dependency: if a future
   decision selects R2, that ADR must explicitly address retiring this migration.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Ratify PROP-0002 exactly as written (write policies, verbs unspecified) | Risks shipping INSERT-only and foreclosing the already-ratified PROP-0003 account-deletion plan; leaves the parity-gate blind spot open |
| Copy the `avatars` migration shape blindly | Bare `create policy`, no `drop if exists` — reproduces the `follows_select` permissive-leftover failure (ADR-0007's original reasoning) |
| Bundle a NEW `avatars` MIME allowlist/size-limit into this migration ("ADD," not "reflect") | Mixing "reflect what exists" with "add a new control" muddies the single live-probe verification and could break existing avatar/cover uploads if current objects fall outside a designed-not-reflected list. Split it into a separate, reflected-first follow-up (see Dissent) |
| Defer PROP-0002 until LIV-35 is decided | P51 applies to today's live config and today's incident response; the Supabase buckets serve production now and for however long any R2 cutover would take. Deferring trades a real present gap for a speculative future saving |
| Assert storage is currently safe (or currently exploitable) | Not knowable from the repo; a third RLS-bypass state is live. Only a probe settles it |

## Consequences

**Good:** storage config becomes reviewable and restorable; the MIME allowlist and size limit
stop being invisible; account deletion is not silently foreclosed; the parity gate stops being
blind to storage.

**Costs:** this is the highest-risk proposal on the board's queue by its own admission — a wrong
predicate breaks uploads for **everyone**, and CI cannot prove correctness (only the live probe
can). If the hard precondition (Decision §3) reveals uploads are already broken, that surfaces a
P0/P1 incident as a side effect of a security review — cheaper found now than by users. The
write-scoping does **not** make public read URLs private (correctly out of scope; the
media-privacy gap is a separate product decision).

## Dissent

- **Intra-board disagreement, recorded:** `principal-security` argued the `avatars` MIME
  allowlist/size-limit should be promoted from PROP-0002's "consider" to a committed "ADD" in the
  same migration, because `avatars` has neither and holds format-drifted album covers (D-29).
  `principal-data` and the adversarial critic argued it must instead be a **separate,
  reflected-first ticket** — bundling a designed-not-reflected control into the reflect-faithfully
  migration muddies the live-probe verification story and risks breaking existing uploads. The
  board sides with split-it-out (Decision, Alternatives) but records `principal-security`'s
  position: the `avatars` bucket's missing content-type control is a live gap (the only
  server-side validation lever this architecture has, ADR-0004) and should be closed soon in its
  own ticket, not indefinitely deferred.
- The critic could not refute the core ratify-with-modifications recommendation; it strengthened
  it by finding the parity-gate blind spot (§4) and the PROP-0003 verb-foreclosure (§2), neither
  of which either principal raised.

## Revisit when

- The live probe (Decision §3) resolves which RLS state production is actually in.
- A future decision selects R2 → that ADR must address retiring this migration.
- The `avatars` MIME-allowlist follow-up ticket is scheduled (`principal-security`'s dissent).
- An edit/re-upload flow needs additional verbs, or a third bucket is added.

## Follow-on work

[PROP-0002](../debt/proposals/0002-version-storage-config.md) — recommended for founder
ratification with the four modifications above (explicit verbs incl. DELETE; hard upload
precondition; extend the parity gate; do not bundle the `avatars` allowlist). A separate
follow-up should reflect `avatars`' actual stored MIME types and then add an allowlist.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
