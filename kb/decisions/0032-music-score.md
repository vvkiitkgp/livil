---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-17
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [ADR-0027]
---

# ADR-0032 — Show a music score on every profile, computed nightly from history

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-10-17 |
| **Domain** | data |
| **Decided by** | human (owner) |

---

## Context

The owner wanted a score on each profile that rewards using Livil. In the same conversation,
users were reported to find the app "over-engineered" and its text "too much to read". The
first-run guide runs to 16 cards, and every dialog explains itself at length.

The 30 days before the decision show what people actually do. About 30 people listened.
Friendships, chat (13 people) and Spotify reposts (13) carried the app. Stories, Jams,
playlists, albums, Stars, comments and Livil-native reposts each had one or two users.

Recording each activity already exists: `post_views`, `spotify_opens`, `post_likes`,
`post_comments`, `posts`, `tracks`, `messages` and `jam_rooms`. A play counts after 3 seconds
and every loop counts again, so a raw play count is trivially farmed.

## Decision

- **One number per person, shown to every signed-in user, and the app says nothing about
  it.** It is a small tag under the @name, marked with the Livil logo, with no label and nothing to
  tap. (The logo is our own mark; a stock icon such as Phosphor's Pulse cannot be owned —
  owner, 2026-10-18.) How it grows is
  explained at livil-music.com/score, not in the app.
- **Recomputed from scratch every night** (`refresh_music_scores()`, pg_cron 22:00 UTC).
  `music_score_points()` sums each person's whole history, using IST calendar days and daily
  caps:
  - listen to a song (a Livil play, or opening a Spotify song): 1 per song per day, up to
    50 a day
  - like: 1
  - comment: 2, up to 20 a day
  - share a song in chat: 2, up to 10 a day
  - repost: 5 per song, up to 10 a day
  - upload: 25, up to 3 a day; only a published song (an upload post exists, media not
    `pending://`)
  - someone else plays your upload: 1 per listener per song per day
  - someone likes your repost: 1 per like, up to 50 a day (not your own)
  - someone comments on your repost: 2 per person per repost, up to 25 people a day (not your
    own)
  - host a Jam that played 5+ minutes by the server heartbeat (`last_played_at` /
    `host_clock_at`): 5, up to 3 a day
- **The table is read-only to the app.** RLS lets signed-in users select, except across a
  block, and nobody write. Only the definer refresh writes.
- **Days come from the server's clock.** 20261105000000 stamps `created_at` on posts,
  tracks, messages and likes, and Jam start/end times, for API callers, and keeps them fixed.
  Otherwise backdating rows walks around every daily cap.

## Alternatives considered

- **Accumulate points live, with triggers on each activity table.** Rejected for three
  reasons:
  - Undo (unlike, delete, take-down) would need a matching reverse trigger everywhere.
  - Changing a rule could never re-score the past.
  - A live public number would tell strangers when someone is active, and the app never
    shows "online".
- **Explain the score in the app** (a sheet listing every activity, designed and
  discarded). It is exactly the "too much to read" the owner asked to remove.
- **Start everyone at 0.** Rejected: it erases the early users' history.

## Consequences

- A score changes once a day, so a new user sees no tag (score 0) until the night after
  their first activity.
- Adding an activity is one more branch in `music_score_points()` and a re-run. Every past
  score updates with it.
- Each night the refresh scans every activity table in full. That is trivial at today's
  size (hundreds of rows). Revisit if `post_views` reaches the millions.
- Jam *members* earn nothing, because `jam_room_members` rows are deleted on leave, so no
  history exists. Only hosts are counted.

## Dissent

None recorded.

## Revisit when

- the nightly refresh takes over a few seconds;
- a "vibe" between two friends or an invite bonus is built (both were designed on
  2026-10-17 and then parked);
- people ask what the number means often enough that the in-app silence costs more than
  it saves.
