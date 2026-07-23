---
tier: 4
owner: principal-data
consumers: [CA, TR, ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [9]
---

# PROP-0004 — Harden the existing stories backend

| | |
|---|---|
| **Status** | **Draft — awaiting human ratification** |
| **Date** | 2026-07-24 |
| **Domain** | data (with security) |
| **Addresses** | [ADR-0009](../../decisions/0009-stories-backend-audit-and-hardening.md) |
| **Jira** | LIV-24 *(the design gate for LIV-22/23; do not unblock those until this is ratified)* |

---

## Problem

The stories backend already exists and is live (`supabase/migrations/20260530000001_repost_and_stories.sql`
— `stories`, `story_views`, RLS, `list_active_stories()`). ADR-0009 audited it and found the
schema and RLS predicate sound, but recorded five concrete defects that must be fixed before the
Stories UI (LIV-22/23) builds on it. None is a redesign; all are additive, forward-only
migrations plus one test.

1. **`list_active_stories()` has no `LIMIT`** — an unbounded read path (Constitution P22). Works
   at current scale, a defect on principle.
2. **No reaper.** Nothing deletes expired stories; rows (and their cascading `story_views`)
   accumulate permanently. `expires_at`-in-predicate keeps them *unreadable*, but the table grows
   without bound.
3. **`expires_at` is client-trusted.** `stories_insert` only checks `author_id`; the client never
   sends `expires_at` (it relies on the column default). A patched client can set `expires_at`
   years ahead and defeat the 24h-ephemeral promise (P16 — any request a client can make, a
   malicious client will make).
4. **`story_views_insert_self` has no visibility check.** It checks only `viewer_id = auth.uid()`,
   not that the story is visible to the viewer. A caller can insert view rows against any
   `story_id` (including non-friend or expired stories) — polluting analytics and creating a
   UUID-gated existence oracle that bypasses `stories_select`.
5. **No direct RLS test for `stories_select`.** Only the dependency (friendship forgery, LIV-10)
   and the RPC's existence are tested — the codebase's recorded "verified the RPC instead of the
   property" failure mode (D-02/D-53/D-55).

## Why now

It blocks LIV-22/23 (Stories UI), and every item is cheap. Two are perimeter-adjacent
correctness gaps (P16-class), so they should not wait behind UI work that would ship on top of
them.

## Proposal

One or more forward-only migrations plus a test, implementing ADR-0009's Decision §3, 4, 6, 7:

- Add a bounded `LIMIT` to `list_active_stories()` (e.g. `LEAST(p_limit, 500)`), keeping it
  `SECURITY INVOKER` and its independent `expires_at > now()` filter.
- Add a `pg_cron` reaper that deletes expired stories on a schedule (`pg_cron` 1.6.4 is available
  on the Mumbai project per the debt register; install + schedule). A grace window (if any) is
  **unspecified by any requirement** and must be set by product, not guessed — default to purge
  at expiry unless a retention need is stated. If `story_view` analytics must outlive the window,
  aggregate before purge (out of scope here; name it).
- Server-enforce the TTL: a `BEFORE INSERT` trigger that forces `expires_at = created_at + 24h`
  (or a `CHECK` bounding `expires_at` relative to `created_at`), so the client cannot extend it.
- Add a visibility check to `story_views_insert_self` so a view row can only be inserted for a
  story the viewer can actually see (reuse the `stories_select` relationship predicate).
- Add a direct RLS characterization test for `stories_select`: stranger denied, friend allowed,
  star allowed, expired denied even to a friend, pending-request denied.

## Implementation plan

1. Confirm the shipped migration is **applied in production** and `schema-parity.sh` is green for
   `stories`/`story_views` (ADR-0009 §8) — do not build on an unverified base.
2. Migration: bounded `LIMIT` in `list_active_stories()`.
3. Migration: TTL-enforcing trigger/CHECK on `stories` insert.
4. Migration: tightened `story_views_insert_self` visibility predicate (drop-and-recreate by
   name, per the ADR-0007 permissive-leftover lesson).
5. Migration: install `pg_cron`, schedule the expired-stories purge.
6. Test: direct `stories_select` RLS block in `supabase/tests/rls/`.
7. Live-probe each policy/behaviour change (a merge is not verification — ADR-0007).

## Scope boundaries

**Not** included: the friends-vs-star visibility semantics (escalated to the founder in ADR-0009
§5 — a product decision, not this proposal); any new columns for LIV-22/23 (reactions, replies,
seen-by UI) until those specs exist; a "seen-by" author-read policy on `story_views` unless
LIV-22/23 requires it; signed URLs / media-object privacy (the ADR-0004 partial-exit trigger);
any redesign of the shipped schema.

## Risk

**Moderate.** Two changes touch shipped, live policies (`story_views` insert; the TTL trigger) and
a live RPC. A wrong `story_views` predicate could break view-recording; a wrong TTL trigger could
reject legitimate inserts. Mitigations: reflect-then-tighten, drop-by-name before create, and a
live probe before and after each change. The `pg_cron` job can fail silently (no monitoring
exists) — but correctness never depends on it (expiry is enforced in the read predicate), so a
stalled reaper degrades only to table growth, not to a visibility leak.

## Verification

- Live probe: a stranger cannot read a story; a friend and a starrer can; an expired story is
  unreadable even to a friend.
- Live probe: a client-supplied far-future `expires_at` is overridden by the trigger.
- Live probe: a `story_views` insert against a non-visible `story_id` is refused.
- `list_active_stories()` returns at most the bound.
- The new RLS test fails when any of those predicates is inverted (mutation-test it, per P29).
- The reaper deletes an expired story on schedule.

## Alternatives

| Alternative | Why not |
|---|---|
| Redesign the schema greenfield (as LIV-24 was filed) | The backend exists and is sound; a second design is competing sources of truth (ADR-0009) |
| Delete-on-read TTL instead of a reaper | Unnecessary; the read predicate already hides expired rows. A reaper is table hygiene only |
| Leave `expires_at` client-set | Defeats the ephemerality promise; a patched client keeps stories forever (P16) |
| Skip the direct RLS test | This codebase has three recorded incidents where source-correct and production-correct diverged |
