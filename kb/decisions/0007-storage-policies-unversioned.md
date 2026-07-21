---
tier: 4
owner: principal-security
consumers: [ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [4]
---

# ADR-0007 — Reflect storage policies from production before versioning them

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-07-21 |
| **Domain** | data + security |
| **Decided by** | Architecture Board — bootstrap debate 2 |
| **Participants** | principal-data, principal-security, adversarial-critic |

---

## Context

The `tracks-media` bucket — which holds every uploaded audio, video, and cover image — has no
policy definition in this repository. The `avatars` bucket has one
(`20260607000001_avatars_bucket.sql`) scoping writes to a per-user folder prefix.

The board was asked what to do about the gap.

Positions were written in parallel with no cross-visibility. **Both principals independently
reached the same conclusion and cited the same precedent** — the `follows_select` incident,
where a correctly-scoped policy was defeated because a leftover permissive one was never
dropped, and policies OR together.

### What the principals verified

`principal-security`, reading `src/services/uploads.ts`:

- The upload path is `${userId}/${trackId}/${kind}.${ext}` — and **`userId` is a client-supplied
  argument**, a literal segment of the POST URL, not server-derived.
- **`x-upsert: false` is a client-set request header.** A patched client flips it. It is a
  convenience default and was never a control.
- `ext` is everything after the last dot of the picked filename; `contentType` comes from the
  picker. Neither is validated client-side.

`principal-data` confirmed the path's first segment matches `auth.uid()` in the shipped client,
so the `avatars` predicate transfers exactly — and that **no delete path exists** in the client
at all.

**Both explicitly refused to assert production state**, having no database access. `principal-security`:
*"Zero confidence on production state — that must be checked by a human before anything is
written."* That refusal was correct (Constitution P6) and is why this ADR exists rather than a
speculative migration.

### What the human then verified

The uncertainty both principals flagged was resolvable, and was resolved:

| Fact | Value |
|---|---|
| `storage.objects` RLS enabled | **yes** |
| **Policies on `storage.objects`** | **ZERO** |
| Table owner | `supabase_storage_admin`, `rolbypassrls = false`, `FORCE RLS` off |
| `tracks-media` bucket | public, **500 MB limit**, **17-entry MIME allowlist** |
| `avatars` bucket | public, no size limit, no MIME allowlist |
| Objects present | 23, **all dated 2026-07-07** — the Sydney→Mumbai migration |

**The decisive finding: the `avatars` policy migration exists in this repository and its
policies are not in production.** This is the same class of failure as
[D-08](../debt/register.md) — `schema_migrations` was empty until 2026-07-21, so migrations in
this directory were never the thing being applied.

**A partial correction also falls out:** the bucket *does* carry a server-side MIME allowlist
and size limit. The recorded claim that upload validation is client-side only is therefore
wrong for `tracks-media` — and remains true for `avatars`, which has neither.

## Decision

**Do not author a speculative policy migration.** Reflect production first, then commit one
faithful, idempotent migration that:

1. Declares both buckets **including `public`, `file_size_limit`, and `allowed_mime_types`** —
   that config is the only server-side validation lever we have without an API tier (ADR-0004),
   and it currently lives in an unversioned blob.
2. `drop policy if exists` **by name** for every reflected policy before creating any.
3. Creates scoped write policies on the `foldername[1] = auth.uid()::text` predicate.
4. Leaves reads public. Tightening them breaks every stored URL and is a product decision, not
   a schema one.

**Verification is a live probe, not a merge:** as user A, attempt to write
`B/<trackId>/audio.mp3` and expect a refusal. `principal-data`: *"Merge is not verification."*

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Copy the `avatars` migration shape** | It uses bare `create policy` with no `drop if exists`. Blind copying reproduces the `follows_select` failure — a clean-looking repo over an unknown production state, which is **worse than an honest gap** |
| **Do nothing; it is only P2** | The reflection cost is minutes and it resolved a real unknown |
| **Also make reads private** | Breaks every stored URL. A product decision about media privacy, tracked separately |
| **Rely on `x-upsert: false`** | Not a control. A client-set header |

## Consequences

**Good:** storage configuration becomes reviewable and restorable from source. The MIME
allowlist and size limit stop being invisible.

**Costs:** one more migration whose correctness CI cannot prove — the migration job's own
shims are explicitly not a behavioural simulation. Only a live probe verifies it.

**Newly visible:** with zero policies on `storage.objects`, whether writes are currently
permitted at all depends on how the storage service connects. **This ADR does not assert that
storage is either safe or exploitable** — it asserts that the answer is not knowable from this
repository, which is the defect being fixed.

## Dissent

None on substance — an unusually clean convergence, which per the protocol is itself worth
noting rather than celebrating (Constitution P10).

`principal-data` raised one unresolved question the board could not settle: whether legacy
objects exist at non-`{userId}/…` paths. `avatars` already shows convention drift by hosting
album covers. This affects writes only, and is the reason for reflection rather than assumption.

## Revisit when

- Media privacy becomes a product promise rather than a listing filter → signed URLs
- An edit or re-upload flow needs `update`
- Any second bucket is added

## Follow-on work

[PROP-0002](../debt/proposals/0002-version-storage-config.md).
