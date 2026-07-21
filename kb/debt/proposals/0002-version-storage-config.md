---
tier: 4
owner: principal-data
consumers: [CA, TR, ALL]
last_verified: 2026-07-21
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [7]
---

# PROP-0002 — Version storage bucket configuration and policies

| | |
|---|---|
| **Status** | **Draft — awaiting human ratification** |
| **Date** | 2026-07-21 |
| **Domain** | data + security |
| **Addresses** | [ADR-0007](../../decisions/0007-storage-policies-unversioned.md), D-24, D-29 |
| **Jira** | *(assigned on ratification)* |

---

## Problem

Storage configuration exists only in the hosted project:

- `storage.objects` has RLS enabled and **zero policies**
- The `avatars` policy migration is **in this repository but not in production** — the same
  class of failure as D-08
- Bucket config that acts as real validation — `tracks-media` carries a 500 MB limit and a
  17-entry MIME allowlist — is unversioned and invisible to review
- `avatars` has **neither** a size limit nor a MIME allowlist

None of this can be reviewed, diffed, or restored from source (Constitution P51).

## Why now

Cheap, and it closes a documented gap two principals independently prioritised. It also
corrects a recorded claim: upload validation is **not** purely client-side for `tracks-media`,
though it is for `avatars`.

## Proposal

One migration declaring both buckets and their policies faithfully — reflected from production,
not designed fresh.

## Implementation plan

1. **Reflect** current bucket rows and any `storage.objects` policies (read-only)
2. Write `<timestamp>_storage_buckets_and_policies.sql`:
   - bucket upserts including `public`, `file_size_limit`, `allowed_mime_types`
   - `drop policy if exists` **by name** for every reflected policy
   - scoped write policies on `foldername[1] = auth.uid()::text` for both buckets
   - public read retained
3. Apply, then **probe live**: as user A attempt a write under user B's prefix, expect refusal
4. Consider a MIME allowlist and size limit for `avatars`, which has neither

## Scope boundaries

**Not** included: making reads private (a product decision — breaks every stored URL); signed
URLs; server-side content inspection; changing the upload path structure; migrating existing
objects.

## Risk

**Moderate — the highest of any proposal so far.** A wrong policy breaks uploads for everyone.

Mitigations: reflect rather than design; drop by name before creating, so nothing is left to
OR against; probe live rather than trusting a merge. CI's migration job proves the SQL applies —
its own comment says the shims are not a behavioural simulation.

**Note:** all 23 existing objects date from the 2026-07-07 project migration. Whether uploads
succeed *today* was not established and should be confirmed before and after.

## Verification

1. Live probe: cross-user write refused
2. Own-prefix upload still succeeds — **verify before and after; do not assume the pre-state**
3. `npm run kb:generate` reports storage policies as versioned
4. Existing media still loads

## Alternatives

| Alternative | Why not |
|---|---|
| Copy the `avatars` migration shape | Bare `create policy`, no drop — reproduces the `follows_select` failure |
| Leave it | The gap is real and reflection is minutes |
| Sign all media URLs | A much larger architectural change; see the media-pipeline revisit triggers |
