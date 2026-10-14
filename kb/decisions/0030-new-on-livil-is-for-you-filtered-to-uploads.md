---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-14
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0027, 0029]
---

# ADR-0030 — New on Livil is For you, filtered to uploads

| | |
|---|---|
| **Status** | **Accepted** — owner-directed 2026-10-14; migration `20261026000000_new_on_livil_feed.sql`, `useHomeFeed`, `HomeFeedTabs`, HomeScreen |
| **Date** | 2026-10-14 |
| **Domain** | data (feed ranking) + client (Home) |
| **Decided by** | owner |

---

## Context

Most of what the Home feed shows is reposts, many of them Spotify reposts (ADR-0027), so the
songs people upload to Livil itself — the platform's own music — were easy to scroll past.
The owner wanted a dedicated place for uploads without changing For you. A cover-tile shelf
and a "See all" screen were drawn and set aside in favour of the owner's own design.

## Decision

1. **Home gets sticky "For you | New on Livil" tabs below the Friends stories.** For you is
   unchanged. New on Livil shows **uploads only** — never a repost of any kind — with the same
   post cards. Playing from it queues uploads only.
2. **The same algorithm, structurally.** The ranker moved verbatim into
   `home_feed_ranked(p_uploads_only, …)`; `fetch_home_feed` and `fetch_new_on_livil` are thin
   wrappers over it (filter off / on). A future ranking change reaches both tabs; they cannot
   drift. The filter sits inside the hot-score and newest branches as well as at the join,
   because those branches have a LIMIT that reposts would otherwise spend.
3. **The tab bar is drawn twice**: in the list, and as a pinned copy over the list that takes
   over once the in-list one would pass under the floating top bar. FlatList's
   `stickyHeaderIndices` sticks to the list's own top edge, which is under the top bar
   whenever that is showing.
4. **A dot on New on Livil** when an upload newer than the viewer's last visit exists,
   compared in server time (the newest upload's `created_at`, stored per account on the
   device), so a wrong phone clock cannot re-light it.
5. **Pushes can open the tab**: data `route: App, tab: new_on_livil` (the New music pushes);
   Home always opens on For you otherwise.

## Alternatives considered

- **A "New on Livil" shelf of cover tiles (+ See all screen).** Drawn; set aside by the owner
  for the tab, which reuses the post cards and the queue.
- **A copy of `fetch_home_feed` with a filter.** Rejected: two rankers drift the first time
  one is tuned. The wrapper refactor was verified row-for-row against the previous function
  on a seeded replay (150 rows, three viewers, zero differences) and the four existing feed
  suites pass unchanged.
- **An optional parameter on `fetch_home_feed`.** Rejected: adding a defaulted argument
  creates a second overload, and PostgREST cannot choose between them for the call shipped
  apps already make.

## Consequences

- Every shipped app keeps calling `fetch_home_feed` and gets the same rows.
- The pool has no time limit beyond For you's own (newest 100 uploads, 30 days of the graph,
  the hot 200), so at today's volume the tab is never empty.
- `notification_preferences.new_music` (default on) arrives with the same migration: the
  switch for the New music pushes (a friend's new song; the weekly roundup).
