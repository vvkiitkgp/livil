---
tier: 4
owner: principal-data
consumers: [CA, TR, ALL]
last_verified: 2026-08-16
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# PROP-0010 — Give the home feed a memory, a session, and one score

| | |
|---|---|
| **Status** | **Draft — awaiting human ratification** |
| **Date** | 2026-08-16 |
| **Domain** | data (primary) · client · security (impressions are behavioural data) |
| **Addresses** | Reported behaviour: pull-to-refresh is a no-op; the same posts open the feed every session. Also the known full-scan limitation recorded in `20260515120000` and `20260707000000`. |
| **Jira** | *(assigned on ratification)* |

---

## Problem

Two observable defects, reported by the product owner on 2026-08-16:

1. **Pull-to-refresh changes nothing on screen.**
2. **The same posts appear at the top of the feed every time the app is opened.**

Both fall out of the same root cause. `public.fetch_home_feed`
([20260707000000_home_feed_single_call.sql](../../../supabase/migrations/20260707000000_home_feed_single_call.sql))
is a pure function of `(viewer graph, posts table, wall-clock hour)`. It orders by
`(feed_bucket ASC, sort_key DESC, post_id DESC)`, where buckets 1 (friends) and 2 (starred)
sort on `EXTRACT(EPOCH FROM created_at)` — pure reverse-chronological.

Consequences, in observable terms:

| # | Defect | Where |
|---|---|---|
| 1 | Two refreshes seconds apart return a **byte-identical** page 1. `handleRefresh` replaces `posts` with a list equal to the one already rendered, so nothing visibly happens. | [HomeScreen.tsx:547-575](../../../src/screens/main/HomeScreen.tsx) |
| 2 | **Nothing records what the viewer has been shown.** There is no impressions table. `post_views` records *plays* (written by `activity_record_play`), not impressions, and its SELECT policy was deliberately dropped. Position 1 stays position 1 until someone uploads. | [00000000000000_baseline_schema.sql:152](../../../supabase/migrations/00000000000000_baseline_schema.sql), [20260804050000_close_post_views_read.sql](../../../supabase/migrations/20260804050000_close_post_views_read.sql) |
| 3 | **Three hard buckets, strictly ordered.** Every friend post outranks every starred-artist post, which outranks all trending. One friend on an upload spree owns the whole feed. No per-author cap; no per-track dedupe, so one track reposted five times is five cards. | `fetch_home_feed`, `feed_bucket` CASE |
| 4 | **Power-law decay has a fat tail.** `engagement / (age_hours + 2)^1.3` keeps a post with real engagement competitive for weeks. Combined with #2, the same trending posts recirculate indefinitely. | `fetch_home_feed`, `sort_key` CASE |
| 5 | **Zero personalization inputs.** Ranking reads graph edges and global counters only. `post_views`, `user_recent_tracks`, `post_likes`, `track_tags` and `search_result_taps` all exist and none of them feed ranking. | — |

Separately, and not a user-visible defect yet: bucket 3 scans and scores **every row in
`posts`** on every page fetch. Both feed migrations already record this as the known
limitation. It is survivable at current volume, but it is why no scoring term can be added
cheaply — each one multiplies a full scan.

## Why now

The feed is the home screen. It is the first surface every tester sees, and it currently
demonstrates that the app has no new content even when it does. Production access is submitted
and pending, so the window where a feed rebuild costs one week rather than one migration-with-
a-live-userbase is now.

It is also cheap. Phases 1 and 2 below fix both reported defects and touch one new table, one
function, and one screen.

## Proposal

Four changes, in dependency order. The design principle: **at this scale the win is seen-state,
rotation and diversity — not a smarter ranker.** Ranking sophistication is phase 5 and is
explicitly deferred.

### 1. Feed sessions — stateless, stable within a session, fresh on demand

The client mints a session on cold open and on every pull-to-refresh:

```ts
type FeedSession = { seed: number; startedAt: string };  // int32, ISO
```

Both travel with every page request of that session. The server uses `startedAt` as the frozen
"now" in all decay math, and `seed` in a tie-breaking jitter term.

This buys three things at once:

- **Refresh visibly re-ranks** — new seed, new order.
- **Pagination becomes consistent.** Today the score function moves under the user mid-scroll
  because `now()` advances between pages; a frozen origin makes pages 2 and 3 unable to
  duplicate or skip rows.
- **No server state.** No session table, no cache tier, still one round-trip.

`p_session_started_at` is **client-supplied and therefore untrusted**. It must be clamped
server-side to `greatest(least(p_session_started_at, now()), now() - interval '1 hour')` — an
unclamped value lets a caller set the decay origin arbitrarily far back and hand themselves a
different ranking, and a far-future value zeroes the decay denominator.

### 2. One additive score, replacing three walls

Buckets become an affinity *term*, not a partition:

```
score =  2.5 · affinity
       + 1.0 · engagement
       + 1.5 · freshness
       − 2.0 · seen_penalty
       + 0.15 · jitter(post_id, seed)
```

| Term | Definition | Why this shape |
|---|---|---|
| `affinity` | friend `1.0` · starred `0.7` · author the viewer has played or liked before `0.4` · stranger `0`. **Take the max, do not sum.** | Summing lets a friend-who-is-also-starred outrank every other friend for a reason nobody intended. |
| `engagement` | `ln(1 + 2·likes + 3·reposts + comments + views/10)` | Log damping stops one viral post permanently outranking the viewer's friends. Weights carried over unchanged from today's `sort_key`. |
| `freshness` | `exp(−age_hours / τ)`, τ = 36h when `affinity > 0`, 12h otherwise | Exponential kills the fat tail in defect #4. Friends' posts should stay reachable for a day and a half; a stranger's trending post should not. |
| `seen_penalty` | `least(seen_count, 4) / 4.0`, plus a **hard exclude** at `seen_count >= 3` with no engagement, within the last 7 days | The direct fix for defect #2. The 7-day window means genuinely good content can resurface rather than being burned forever. |
| `jitter` | `hashint(post_id::text || seed::text)` normalized to ±0.15 | Deterministic within a session, different across sessions. This is what makes refresh *feel* alive without making pagination incoherent. Amplitude is deliberately small — it reorders near-ties, it does not overrule affinity. |

### 3. Diversity pass — after scoring, before the limit

```sql
row_number() over (partition by author_id order by score desc)                  -- −0.5 per extra
row_number() over (partition by coalesce(original_post_id, id) order by score)  -- keep best only
```

Caps any one author at roughly two cards per twelve, and collapses a track reposted five times
to its single best-scoring card.

Plus a **reserved discovery slot**: at least one card per page from an author the viewer has
never played. Without it the feed collapses onto the viewer's three most active friends and
never introduces anyone — which on a platform whose growth depends on discovery is the failure
mode that matters most.

### 4. The missing table

```sql
create table public.post_impressions (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  post_id      uuid not null references public.posts(id) on delete cascade,
  seen_count   int  not null default 1,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
```

Upserted with `seen_count = post_impressions.seen_count + 1` through a `SECURITY DEFINER` RPC
taking a `uuid[]` batch — the same shape as `activity_record_play`.

**Two traps, both already precedented in this repository:**

- This is behavioural data of the same sensitivity as `post_views`. The read policy must be
  `using (user_id = auth.uid())` and nothing wider. A grant-based control does **not** hold
  here: `ci.yml` re-runs `grant all on all tables to authenticated` after migrations, so a
  revoke is silently undone and the test then passes for the wrong reason
  ([20260722000000_liv10_authorization_guards.sql:186-190](../../../supabase/migrations/20260722000000_liv10_authorization_guards.sql), restated in
  [20260804050000](../../../supabase/migrations/20260804050000_close_post_views_read.sql)).
  **The policy is the control.**
- `fetch_home_feed` is **`SECURITY INVOKER`**. Joining `post_impressions` inside it works *only*
  if that own-row SELECT policy exists. Without it, RLS returns zero rows and the seen-filter
  becomes a silent no-op that looks like it is working — the same failure class as a missed
  native prop mirror in the video patch: silent, not loud. **The migration must add the policy
  and the function in the same file.**

Client side: `onViewableItemsChanged` with `viewAreaCoveragePercentThreshold: 60` and
`minimumViewTime: 1500`, buffered and flushed on scroll-idle, on screen blur, and every 10
posts. Fire-and-forget; it must never throw to the UI.

### 5. Retrieve, then rank

This is the fix for the full-scan problem and it must land **before** the scoring gets richer,
not after. Two stages:

**Candidate generation** (~400 rows, index-only):
- friend and starred posts from the last 30 days
- top 200 by a new `posts.hot_score` column
- 50 recent uploads from authors the viewer has never played (the discovery pool)

**Ranking**: score only those ~400.

`hot_score` is a plain `numeric` column plus `hot_score_updated_at`, refreshed by `pg_cron`
every 10 minutes over posts with activity in the last 7 days. Deliberately not a materialized
view — a matview takes a refresh lock and this is the read path for the home screen. This is
the "precomputed trending surface" both feed migrations already name as the eventual fix.

### 6. Client changes

- Extract `useHomeFeed` — owns session, cursor, and cache. `HomeScreen.tsx` is 1141 lines and
  should not absorb more.
- **Feed state survives tab switches.** Today the initial load is a plain `useEffect` on mount
  ([HomeScreen.tsx:598-628](../../../src/screens/main/HomeScreen.tsx)); the session should
  persist so Home → Library → Home does not discard scroll position.
- **"New posts" pill** rather than silent replacement. The realtime channel is already wired
  ([HomeScreen.tsx:515](../../../src/screens/main/HomeScreen.tsx)); tapping it starts a new
  session and scrolls to top.
- Refresh scrolls to top explicitly. With re-ranking, holding offset 800 in a reordered list is
  disorienting.

## Implementation plan

Each phase is independently shippable and independently verifiable.

1. **Phase 1 — impressions.** Migration: `post_impressions` + own-row RLS + `record_impressions(uuid[])`
   DEFINER RPC. Service: `recordImpressions` in `src/services/posts.ts`. Client: viewability
   tracking + batched flush in `HomeScreen`. `fetch_home_feed` gains the hard exclude only
   (≥3 unengaged views in 7 days). **Fixes defect #2.**
2. **Phase 2 — sessions and decay.** `fetch_home_feed` gains `p_seed` and
   `p_session_started_at` (clamped), exponential decay replacing the power law, the jitter
   term, and the author/track diversity windows. Client mints and threads the session.
   **Fixes defect #1.**
3. **Phase 3 — one score.** Collapse `feed_bucket` into the additive `affinity` term; add the
   reserved discovery slot. Cursor becomes `(score, post_id)`. **Fixes defects #3 and #5.**
4. **Phase 4 — retrieve/rank split.** `posts.hot_score` + `pg_cron` job + candidate-generation
   CTE. No behaviour change; a latency and scalability change.
5. **Phase 5 — taste signals. Deferred, not scheduled.** Vectors from `user_recent_tracks` and
   co-listen overlap.

Phases 1 and 2 alone close both reported defects. 3 and 4 are what make it hold past a few
hundred users.

## Scope boundaries

Explicitly **not** in this proposal:

- **Tag-based taste matching.** The ten `EMOTION_TAGS` are pre-applied by deliberate product
  choice, so "this track carries most of them" is not a signal. Tag-driven personalization
  would be fitting noise until tagging becomes selective. Revisit if that changes.
- **Any ML model, embedding store, or external ranking service.** Everything here is SQL.
- **Changes to Search, Library, or profile feeds.** `listPostsForUser` and `searchPosts` are
  untouched.
- **Playback.** Nothing here goes near the single engine, the patch, or the media session.
- **`views_count` semantics.** It continues to count plays. Impressions are a separate column
  in a separate table and are never surfaced as a public counter.

## Risk

| Risk | Detection | Reversibility |
|---|---|---|
| The seen-filter silently no-ops because the RLS policy is missing or wrong under `SECURITY INVOKER` | A test that inserts an impression as user A and asserts `fetch_home_feed` excludes that post for A and **not** for B | Policy is one migration; the function keeps working, just without suppression |
| Over-suppression — an active user exhausts the candidate pool and sees an empty feed | Assert the feed never returns fewer than N rows while unseen candidates exist; the hard exclude must be dropped, not honoured, when the pool runs dry | Threshold constants are in the function body |
| Jitter amplitude too high, ranking feels random | Manual: friends' recent posts must still open the feed | One constant |
| Impressions table growth (rows = users × posts seen) | Row count in the ops dashboard | Primary key is `(user_id, post_id)`, so it is bounded by catalogue size, not by view count. A 90-day prune job is trivial to add |
| `pg_cron` job (phase 4) drifts or dies, `hot_score` goes stale | `hot_score_updated_at` max age surfaced on `/studio/ops` | Candidate generation falls back to the live scan |

A bad outcome looks like: users report the feed is empty, or repetitive in a *new* way (same
strangers rather than same friends). Both are visible within one testing session.

## Verification

- **Defect #1** — call `fetch_home_feed` twice with different seeds and identical everything
  else; assert the returned `post_id` ordering differs while set membership is largely stable.
  Manually: pull to refresh twice and see the cards move.
- **Defect #2** — insert 3 impressions for a post with no like/play; assert it is absent from
  the next call's page 1, and present again after `last_seen_at` is aged past 7 days.
- **Pagination coherence** — page through an entire session with a fixed seed; assert zero
  duplicate `post_id`s across pages and that the union matches a single large-limit call.
- **Diversity** — seed one author with 20 posts; assert no page of 12 contains more than 2.
- **RLS** — as user B, assert user A's impressions are unreadable, and that A's suppression
  does not affect B's feed. This is the test that catches the `SECURITY INVOKER` trap.
- **Latency (phase 4)** — feed-skeleton time. The consolidation in `20260707000000` took this
  from ~3.2–3.6s to a single round-trip; phases 1–3 must not regress it, and phase 4 should
  improve p95 as the catalogue grows.

## Alternatives

| Alternative | Why rejected |
|---|---|
| **`ORDER BY random()` on refresh** | Fixes the symptom, destroys pagination (a row can repeat on every page) and destroys ranking. The seeded jitter is the same idea done coherently. |
| **Client-side shuffle of the returned page** | Only reorders the 12 rows already fetched. The user's complaint is that they never see *different* posts, not that these twelve are in the wrong order. |
| **Keep strict buckets, add seen-suppression only** | Fixes defect #2 but leaves #1, #3 and #4. Worth noting it is the cheapest possible slice if only one phase can ship. |
| **Materialized view for trending** | Refresh takes a lock on the home screen's read path. A plain column updated by `pg_cron` gives the same precomputation with no lock. |
| **Move ranking into an edge function** | Ranking is a join over five tables; pulling rows out of Postgres to score them in TypeScript is strictly slower. The 2s edge CPU cap that ruled out waveform decode (ADR-0003) applies here too. |
| **Third-party feed/rec service** | Contradicts [ADR-0004](../../decisions/0004-supabase-direct-no-api-tier.md) (Supabase direct, no API tier) and adds a vendor for a problem that is 200 lines of SQL at this scale. |

## Open questions for ratification

1. **Cold start.** A brand-new user with no friends gets discovery-pool content only. With
   roughly twenty closed testers, a hand-picked shelf beats any algorithm — should this
   proposal include `posts.is_featured` and a curated starter set, or should new users get pure
   trending?
2. **Privacy posture.** Phase 1 introduces per-user "what you were shown" tracking. It is
   self-scoped, never aggregated across users, and never exposed to another account — but it is
   a new category of data in a product whose privacy stance has been deliberately tight, and it
   likely warrants a line in `docs/privacy-policy.html`. This should be a conscious decision,
   not a side effect of a feed fix.

---

> **Proposals require human ratification before becoming work.** The board proposes; it does not
> schedule. A ratified proposal becomes a Jira Epic linked back to this document.
