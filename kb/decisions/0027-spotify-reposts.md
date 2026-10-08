---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-09
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0001, 0004, 0008]
---

# ADR-0027 — Spotify reposts: a track-less repost, opened in Spotify, never played by Livil

| | |
|---|---|
| **Status** | **Accepted** — owner-directed 2026-10-08; built on `spotify-integration` (migration `20261013000000`, edge function `spotify`) |
| **Date** | 2026-10-08 |
| **Domain** | data + client (with security, playback) |
| **Decided by** | owner, after a proposal round with principal-security, principal-client, principal-data, principal-playback and a policy research pass (developer.spotify.com terms, policy, design guidelines, quota modes) |

---

## Context

The owner wanted Spotify in Livil: sign in with Spotify, Spotify songs in search, and Spotify
links reposted to the feed. Spotify's platform, as of October 2026, decides most of it:

- **No playback by third parties.** There is no audio API, `preview_url` is null for apps
  created after November 2024, and streaming Spotify audio through another player is
  prohibited. App Remote / Web Playback count as "Streaming" and need Premium.
- **Development mode is capped at 5 allow-listed users** (February 2026); extended quota
  requires a registered business and ≥250k monthly active users (May 2025). Anything that
  needs a Spotify *user* login is therefore unshippable to the public for Livil today.
- **What any app may do:** show Spotify track metadata with Spotify's logo and a link back,
  artwork unaltered; search with an app-only ("client credentials") token in its own
  section, never interleaved with another service's content; cache metadata only
  temporarily.
- **Never, at any size:** sync Spotify audio with visual media, mix it with other audio,
  analyse it, or replicate Spotify's core experience.

## Decision

1. **A Spotify repost is a `posts` row** with `kind = 'repost'`, `track_id` null and a
   `spotify_track_id` (22-char base-62). Exactly one media source is enforced by
   `posts_media_source_check`; a Spotify post has no `original_post_id` and no clip. It
   follows every repost rule for free — friends-only visibility (`posts_select_authenticated`),
   likes, comments, reports, delete — because all of those key on `posts.id`.
2. **Only the id is stored.** Title, artists and artwork are resolved at display time by the
   `spotify` edge function (client-credentials token, in-memory one-hour cache; oEmbed
   fallback without credentials). Nothing Spotify-owned is persisted.
3. **Livil never plays it.** Tapping play pauses Livil (the single engine, ADR-0001) and opens
   `https://open.spotify.com/track/<id>`. Every queue builder filters with
   `isPlayableInLivil`; the database refuses Spotify posts in `playlist_posts`,
   `jam_suggestions` and `post_views` (`reject_spotify_post()`).
4. **Spotify search is its own "On Spotify" section** under the Livil results, never ranked
   with them. The repost screen searches or takes a pasted link; reposting a friend's
   Spotify repost locks the song.
5. **A database switch gates creation**: `app_switches('spotify_reposts')`, off by default,
   read by the app through `spotify_reposts_enabled()` and **enforced on insert** by
   `trg_posts_spotify_switch_guard` — a switch only the client reads hides a button, it does
   not stop a direct PostgREST insert (security review, 2026-10-09). Off → "+ Track" / "+" go
   straight to Upload as before, the chooser and the Repost pill on Spotify cards are hidden,
   and the database refuses any Spotify repost. Existing ones keep their likes and comments.
   Flipped by the owner in the SQL editor; the app re-reads it on returning to the foreground.
6. **No Spotify sign-in and no "Connect Spotify"** — blocked by the 5-user cap, and Spotify's
   `/me` email is unverified, which makes it unsafe as an account-linking key.

## Consequences

- `posts.track_id` is nullable. Every function that joins `posts` → `tracks` was checked on a
  full local replay: inner joins (ops, creator stats, search) exclude Spotify posts; the home
  feed already emits `track: null` and groups by `COALESCE(track_id, post_id)`;
  `user_recent_tracks_record_play` gained a null guard.
- **Old apps (≤ 2.1.x)** receive a Spotify repost as a repost with no track and no original
  post, which the shipped `PostCard` renders as its "original removed" tombstone with likes
  and comments. Accepted by the owner: the user base is small, and people are asked to update
  (via the planned ops broadcast) before the switch is turned on — which the database
  enforces, so no Spotify repost can exist before then.
- The app does **not** add `spotify_track_id` to `POST_SELECT` or the feed RPC. It looks the id
  up in a second query only for track-less reposts (`attachSpotifyTrackIds`), so a build
  shipped before the migration is applied keeps working.
- The `spotify` edge function budgets each user by upstream calls (a 20-id lookup costs 20),
  turns away an over-budget caller before verifying their token, and stops calling the Web
  API for `Retry-After` when Spotify answers 429 (cards fall back to oEmbed meanwhile).
  Transient failures are left out of `tracks` responses so the app retries rather than
  caching "unavailable".
- Ops has no tool to remove a Spotify repost yet (`ops_take_down_track` acts on a track).
  Reports on one reach the queue; removal is by SQL until an ops action exists.
- Spotify's logo must be its official file. `SpotifyLogo` is a placeholder wordmark to be
  replaced before public release (same lesson as Sign in with Apple).

## Rejected alternatives

- **Separate `external_posts` table.** Zero old-app exposure, but likes, comments, reports,
  notifications and reposts would all need parallel tables and client paths. Rejected once
  the owner asked for full repost parity.
- **Spotify Embed in a WebView.** A second audio source and possibly a second media session
  inside our process (the ADR-0001 "carousel" class of bug), previews only on Android, and a
  new native dependency.
- **App Remote SDK.** Premium-only, inside the 5-user cap, a new native module with no healthy
  New-Architecture wrapper, and it still cannot sit in Livil's queue or Jam.
- **Storing metadata.** Spotify allows only temporary caching; storing the id and resolving
  live keeps us inside the terms and means a card cannot be forged by the client.

## Revisit when

- Livil qualifies for extended quota (then "Connect Spotify" becomes possible).
- Spotify changes its developer terms on caching, search or playback.
- Old-app share of the user base is negligible (the tombstone fallback stops mattering).
