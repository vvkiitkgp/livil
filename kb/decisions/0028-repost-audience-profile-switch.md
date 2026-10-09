---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-09
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0027]
---

# ADR-0028 — Repost audience is a per-profile switch, everyone by default

| | |
|---|---|
| **Status** | **Accepted** — owner-directed 2026-10-09; migration `20261019000000_reposts_audience.sql` |
| **Date** | 2026-10-09 |
| **Domain** | data + client (with security) |
| **Decided by** | owner |

---

## Context

Since `20260809000000` every repost has been friends-only: `posts_select_authenticated` let a
non-friend read uploads but never reposts ("uploads and albums public, reposts and playlists
between friends"). With Spotify reposts (ADR-0027) a repost became the main way to post a
song Livil does not have, and the owner wanted those posts to reach people beyond a user's
friends, while still letting someone keep their reposts to friends.

## Decision

1. **One switch per person, not a choice per repost.** `profiles.reposts_public boolean not
   null default true`. It is read LIVE by the posts read policy through the DEFINER helper
   `reposts_public(author)`, so flipping it hides or reveals every repost that person has
   made, past ones included. Nothing is stamped on the posts. Edited in Settings → Privacy &
   data → "Show my reposts to everyone".
2. **Everyone by default, for existing accounts too.** Every profile, including those that
   reposted under the friends-only rule, starts at `true`. The owner chose this knowing that
   past reposts become visible to every signed-in user when the migration is applied.
   Not reversible in effect: flipping the column back re-hides the posts, but not from
   anyone who already saw them.
3. **Applied only once the app with the switch is widely installed.** Builds ≤ 2.1.2 have no
   switch, their guide says reposts are for friends, and they draw a SPOTIFY repost as a
   false "the author removed this post" tombstone (ADR-0027 accepted that only for the
   reposter's friends). Order: ship the build → live at 100% on both stores, most people
   updated → apply the migration. The new app hides the switch until then.
4. **"Everyone" means signed-in Livil users.** The policy stays `to authenticated`, and the
   public share page (`shared_post_public`) stays uploads-only — a repost is still never a
   public URL (`20260901000000`, `kb/architecture/post-sharing.md`). Blocks still hide
   everything in both directions.
5. **Public reposts reach the Home feed like uploads.** No feed change: `fetch_home_feed` is
   INVOKER, so its hot/newest/affinity candidate sources (starred people included) pick up
   whatever the policy allows. Its per-track grouping (`COALESCE(track_id, post_id)`)
   collapses Livil reposts of one song; Spotify reposts (no `track_id`) are not grouped — a
   follow-up could group them by `spotify_track_id`.
6. **`record_post_impressions` repeats the predicate by hand** (it is DEFINER and bypasses
   RLS). It is redefined in the same migration with the identical predicate; otherwise a
   public repost shown to a stranger would never be recorded as seen and never fade.

## Alternatives considered

- **Per-repost Friends / Everyone picker** (proposed first). Rejected by the owner: the
  audience is a property of the person, not of each post.
- **Existing accounts stay friends-only, new accounts default to everyone.** Proposed as the
  privacy-preserving default; the owner chose everyone-for-all (decision 2).
- **Profile-only reach (keep strangers' reposts out of Home).** Would need a feed predicate
  change; rejected — public reposts are meant to be discovered.

## Consequences

- The friends-only empty state on a profile ("Reposts are for friends") now appears only for
  people who switched to friends only; `profile_tab_counts` is unchanged and still true.
- Old apps render strangers' public Livil reposts normally, but Spotify reposts as a false
  tombstone — hence decision 3.
- Known gap (follow-up): a stranger who already holds a friends-only repost's id can still
  like it, comment, read its comments and record a play by calling the API directly —
  likes/comments/plays never checked post visibility. Pre-existing, made reachable here.
- `supabase/tests/rls/repost-audience.test.sql` pins the rule; `spotify-reposts.test.sql`
  2e/2f now follow the switch.
- The first-run guide's Friends card no longer lists reposts as something friendship unlocks.
