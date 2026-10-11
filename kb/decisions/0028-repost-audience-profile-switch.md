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
| **Status** | **Accepted** — owner-directed 2026-10-09; migrations `20261019000000_reposts_audience.sql` (switch, off for all) and `20261020000000_reposts_public_by_default.sql` (applied 2026-10-10) |
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
   null` (default false after step 1, true after step 2). It is read LIVE by the posts read policy through the DEFINER helper
   `reposts_public(author)`, so flipping it hides or reveals every repost that person has
   made, past ones included. Nothing is stamped on the posts. Edited in Settings → Privacy &
   data → "Show my reposts to everyone".
2. **Everyone by default, for existing accounts too — in a second step.** The owner chose
   everyone-by-default, including existing accounts and past reposts. It lands in two
   migrations so the switch can ship and be tested first:
   - `20261019000000_reposts_audience` — the switch, starting **off (friends only) for
     everyone**: applying it changes nobody's visibility. A trigger stamps
     `reposts_public_set_at` whenever the owner changes the value.
   - `20261020000000_reposts_public_by_default` — default true, and on for every profile whose
     owner never chose (`reposts_public_set_at IS NULL`); a choice is never overridden. Not
     reversible in effect: flipping back re-hides posts, not from anyone who saw them.
3. **Step 2 was held until the app with the switch was widely installed** — applied
   2026-10-10, owner's call, once 2.1.3 (77) was live on both stores. At that point the
   last 24 hours showed every active Android user and 2 of 5 iPhone users on 2.1.3; the
   three on 2.1.2 had no reposts of their own, and the owner accepted that they would see
   3–4 Spotify reposts as "author removed" cards until they updated.
   (`supabase/held-migrations.txt`). Builds ≤ 2.1.2 have no switch, their guide says reposts
   are for friends, and they draw a SPOTIFY repost as a false "the author removed this post"
   tombstone (ADR-0027 accepted that only for the reposter's friends). Order: step 1 any time
   → ship the build → 100% on both stores, most people updated → step 2. Until step 2 the only
   public reposts belong to people who turned the switch on themselves.
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
- **One migration, applied after the release.** Rejected 2026-10-09: the switch could not be
  tested before shipping (there is no staging). Split into steps 1 and 2 instead.
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
