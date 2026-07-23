---
tier: 4
owner: principal-data
consumers: [ALL]
last_verified: 2026-07-24
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [4, 7, 8]
---

# ADR-0009 — Audit and harden the existing stories backend (do not redesign)

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-07-24 |
| **Domain** | data (with security) |
| **Decided by** | Architecture Board — LIV-24 debate |
| **Participants** | principal-data, principal-security, adversarial-critic |

**Board recommendation — PENDING FOUNDER RATIFICATION (2026-07-24). One sub-decision is
Escalated (see Decision §5).**

---

## Context

LIV-24 was filed as "design the stories backend: table, RLS, expiry, friends-only reads,
indexing." Both principals, independently and in parallel, discovered the backend **already
exists and is live**: `supabase/migrations/20260530000001_repost_and_stories.sql` defines
`stories` and `story_views`, their RLS policies, and the `list_active_stories()` RPC, wired
end-to-end into `src/services/stories.ts`, `src/contexts/StoriesContext.tsx`,
`src/screens/main/StoryViewerScreen.tsx`. So LIV-24 is an audit-and-harden of shipped code, not
a greenfield design. Migrations are forward-only; the existing DDL cannot be edited, only added
to.

The shipped design, stated as fact: `stories` has `author_id`, `track_id`, `original_post_id`,
`comment`, a clip window, `created_at`, and `expires_at` (default `now() + 24h`). `story_views`
has `story_id` (FK), `viewer_id`, `viewed_at`, cascade-on-delete from `stories`.

The RLS `stories_select` predicate (verified at lines 47-67): `expires_at > now() AND
(author_id = auth.uid() OR an accepted friendships row in either direction OR a follows row
where follower_id = auth.uid() AND kind = 'star')`. `stories_insert`/`stories_delete` are
owner-only (`author_id = auth.uid()`); there is **no update policy** (immutable by design).
`story_views` policies scope to `viewer_id = auth.uid()`. `list_active_stories()` is SECURITY
INVOKER and independently re-filters `expires_at > now()`, so expiry is enforced twice and RLS
still applies on top.

The shipped design hides a dependency: `stories_select` trusts `friendships.status =
'accepted'`, a column that was client-forgeable until `20260722000000_liv10_authorization_guards.sql`
(LIV-10) closed it — that migration's own comment names `stories_select` as a downstream-affected
policy. This is now fixed, but the coupling is invisible from the stories migration alone.

## Decision

1. **Ratify the existing schema and RLS predicate as sound** — do not redesign or introduce a
   `story_friends` table. Visibility reuses the same `friendships`/`follows` relationships every
   other feature uses; a second source of truth for "who can see whom" is exactly the
   `follows_select` / D-55 drift failure class.
2. **Keep expiry inside the RLS `USING` predicate.** It must never be demoted to an
   application-level `WHERE expires_at > now()` filter — a client can omit that; the policy
   cannot. Expiry is an authorization concern here, not just data lifecycle.
3. **Bound the read path.** `list_active_stories()` currently has no `LIMIT` — a P22
   (bounded-by-default) defect. Add a bounded limit. (Follow-on work, see PROP-0004.)
4. **Add a reaper for expired rows.** Nothing deletes expired stories today; they accumulate
   permanently (with `story_views` cascading). `pg_cron` **is** available on the Mumbai project
   (`pg_cron` 1.6.4, available-not-installed, per the debt register 2026-07-22) — so a scheduled
   purge is viable; this reverses the ADR-0008 blocker where availability was unknown.
   Expiry-in-predicate already guarantees correctness regardless of when the reaper runs; the
   reaper is for table hygiene, not authorization.
5. **Escalated sub-decision (Constitution P63).** The ticket says "friends-only reads," but the
   shipped policy grants "accepted friend OR I star them" — broader than friends-only. Whether
   stories should be visible to people the author only follows/stars is a **product decision**
   about intended audience, not a schema question. The board does not ratify or silently narrow
   it — it escalates to the founder. Until decided, the shipped "friends-or-star" behavior
   stands.
6. **Two illegal states the shipped schema permits, found by the critic, must be fixed
   (follow-on, PROP-0004):**
   - (a) `expires_at` is client-trusted — `stories_insert` only checks `author_id`, and the
     client never sends `expires_at` (relies on the column default), so a patched client can
     set `expires_at` years in the future and defeat the 24h-ephemeral promise (Constitution
     P16). Fix: server-enforce the TTL (e.g. a trigger forcing `expires_at`, or a `CHECK`
     bounding it relative to `created_at`).
   - (b) `story_views_insert_self` checks only `viewer_id = auth.uid()`, not that the story is
     visible to the viewer — so a caller can insert view rows against any `story_id` including
     non-friend or expired stories, polluting analytics and creating a UUID-gated existence
     oracle that bypasses `stories_select`. Fix: add a visibility check to the insert policy.
7. **Add a direct RLS characterization test for `stories_select`** (stranger denied, friend
   allowed, star allowed, expired denied even to a friend, pending-request denied). None exists
   today; only the dependency (friendship forgery) and the RPC's existence are tested. This is
   the codebase's recorded "verified the RPC instead of the property" failure mode
   (D-02/D-53/D-55).
8. **Verification is a live probe, not a merge** (per ADR-0007's standing rule). Also: confirm
   the shipped migration is actually applied in production before LIV-22/23 build on it — the
   schema-parity gate exists (`scripts/schema-parity.sh`) but its most recent run on `main` is
   red for unrelated LIV-11 function drift; parity must be green and `stories`/`story_views`
   confirmed live.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Redesign the schema greenfield as the ticket implies | The backend already exists and is sound; a second stories design is two competing sources of truth — the exact drift this domain prevents |
| Invent a `story_friends` / dedicated visibility table | A second source of truth for "who can see whom"; reproduces the `follows_select` / D-55 drift class |
| Move expiry filtering to the client query / application layer | A client can omit the filter; expired rows become readable. Expiry must stay in the RLS predicate |
| Delete-on-read or a TTL trigger instead of a reaper | Unnecessary complexity (P13); the `USING` predicate already makes expired rows unreadable. A reaper is for table hygiene only |
| Silently narrow "friends-or-star" to "friends-only" in a migration | That is a product decision about audience (P63); the board escalates, it does not decide |
| Ship without a direct RLS test | This codebase has three recorded incidents where "reads correctly in source" and "behaves correctly in production" diverged |

## Consequences

**Good:** reuses proven relationships; expiry is correct-by-construction; the hardening is
small, contained, additive migrations; the backend becomes reviewable.

**Costs / made-hard:**

- **The media object gap.** A story row being friends-visible does not make its media private —
  `track`/`audio`/`video`/cover URLs are public `tracks-media` bucket URLs (ADR-0007), and the
  underlying track/post is already visible to any authenticated user via the ordinary feed
  (posts/tracks are `USING(true)`). So the friends-or-star predicate protects the story *object*
  (its ephemeral existence, comment, clip window as a social signal), **not the media**.
  LIV-22/23 UI copy must not promise "only your friends can ever see this" — the backend cannot
  deliver that without signed URLs (the ADR-0004 partial-exit trigger).
- The RLS `EXISTS` subqueries are correlated per-row; fine at current scale, a cliff later.
- A hard purge destroys `story_views` analytics past the window unless aggregated first.

## Dissent

- **Recorded convergence:** both principals independently reached "audit, don't redesign" and
  cited the same drift precedents — per Constitution P10, fast convergence is noted, not
  celebrated, which is why the critic ran and found the two illegal states above.
- **principal-data** flagged that the reaper's retention/grace window is unspecified by any
  requirement (it picked 48h defensively, from no evidence) and that whether LIV-22/23 need new
  columns (reactions, replies, seen-by UI) is unknown — guessing would violate the
  refuse-to-guess rule.
- **The critic** could not refute the RLS predicate's soundness, the P22 `LIMIT` gap, or the
  public-media gap. It did refute the framing that the board can assert the backend is "live and
  correct" without a live probe plus green parity.

## Revisit when

- The founder decides the friends-vs-star visibility question (Decision §5).
- LIV-22/23 specs require new columns (reactions, replies, seen-by list).
- Media privacy becomes a product promise → signed URLs (ADR-0004 partial exit).
- Story volume makes the correlated `EXISTS` subqueries a measured cost.

## Follow-on work

[PROP-0004](../debt/proposals/0004-harden-stories-backend.md) — bound `list_active_stories`, add
the `pg_cron` reaper, server-enforce the TTL, fix the `story_views` visibility check, add the
direct RLS test. The visibility-semantics question is escalated separately, not in the proposal.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`. The record of what we believed and when is
> the point.
