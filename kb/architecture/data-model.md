---
tier: 1
owner: principal-data
consumers: [P-DA, BE, QA, DC]
last_verified: 2026-07-20
verify_every: 9999d
verified_by: generated
visibility: public
supersedes: []
related_adrs: []
---

# Data Model

> **GENERATED FILE — DO NOT EDIT.**
> Produced by `npm run kb:generate`. Edits are overwritten on the next run.
> To change this document, change the generator or the source it reads.

Reconstructed from 35 migration(s) in `supabase/migrations/`.

## ⚠️ This schema is incomplete

**8 table(s) are referenced by migrations but never created in this
repository.** They predate the migration directory and were created directly in the hosted
project. Their columns, constraints, and policies exist only in production.

| Table referenced but not defined here | Altered by migrations? | Indexed here? |
|---|:--:|:--:|
| `follows` | no | yes (1) |
| `friendships` | no | yes (2) |
| `playlists` | yes (4) | yes (1) |
| `post_comments` | yes (1) | yes (2) |
| `post_views` | yes (1) | yes (2) |
| `posts` | yes (2) | yes (2) |
| `profiles` | yes (5) | no |
| `tracks` | yes (1) | no |

The consequence is that **this database cannot be rebuilt from this repository**, and the
authorization model on those tables cannot be reviewed from source. Constitution P51 says
production state that exists nowhere in the repository is state we cannot reason about,
review, or restore. Closing this requires a baseline schema dump.

## Tables defined in this repository

19 table(s).

### `activity_notifications`

RLS enabled · realtime · defined in `20260608000000_activity_notifications.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `recipient_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `type` | `text not null check (type in ( 'like','comment','repost','play_milestone', 'new_fan','friend_accepted','friend_rejected'))` |
| `actor_id` | `uuid references public.profiles(id) on delete set null` |
| `post_id` | `uuid references public.posts(id) on delete cascade` |
| `agg_key` | `text` |
| `agg_count` | `int not null default 1` |
| `payload` | `jsonb not null default '{}'::jsonb` |
| `is_read` | `boolean not null default false` |
| `created_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

**Indexes**

- **unique** `activity_notifications_agg_uq` `(recipient_id, agg_key) where agg_key is not null`
- `activity_notifications_recipient_idx` `(recipient_id, updated_at desc)`
- `activity_notifications_unread_idx` `(recipient_id) where is_read = false`

### `album_tracks`

RLS enabled · defined in `20260616000000_albums_and_playlist_visibility.sql`

| Column | Definition |
|---|---|
| `album_id` | `uuid not null references public.albums(id) on delete cascade` |
| `track_id` | `uuid not null references public.tracks(id) on delete cascade` |
| `position` | `integer not null check (position >= 0)` |
| `added_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (album_id, track_id)`

**Indexes**

- `album_tracks_track_idx` `(track_id)`
- **unique** `album_tracks_one_album_per_track` `(track_id)`
- **unique** `album_tracks_album_position` `(album_id, position)`

### `albums`

RLS enabled · defined in `20260616000000_albums_and_playlist_visibility.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `uploader_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `title` | `text not null check (char_length(trim(title)) between 1 and 120)` |
| `description` | `text` |
| `cover_art_url` | `text` |
| `release_date` | `date` |
| `created_at` | `timestamptz not null default now()` |

**Indexes**

- `albums_uploader_idx` `(uploader_id, created_at desc)`

### `conversation_members`

RLS enabled · realtime · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `conversation_id` | `uuid references conversations(id) on delete cascade` |
| `user_id` | `uuid references profiles(id) on delete cascade` |
| `role` | `text default 'member' check (role in ('admin', 'member'))` |
| `last_read_at` | `timestamptz default now()` |
| `joined_at` | `timestamptz default now()` |

**Table constraints**

- `primary key (conversation_id, user_id)`

**Indexes**

- `(unnamed)` `(user_id)`

### `conversations`

RLS enabled · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `kind` | `text not null check (kind in ('dm', 'group'))` |
| `name` | `text` |
| `avatar_url` | `text` |
| `created_by` | `uuid references profiles(id) on delete set null` |
| `last_message_at` | `timestamptz` |
| `last_message_preview` | `text` |
| `created_at` | `timestamptz default now()` |

### `jam_queue`

RLS enabled · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `jam_room_id` | `uuid references jam_rooms(id) on delete cascade` |
| `track_id` | `uuid references tracks(id)` |
| `suggested_by` | `uuid references profiles(id)` |
| `position` | `integer` |
| `upvotes` | `integer default 0` |
| `added_at` | `timestamptz default now()` |

**Indexes**

- `(unnamed)` `(jam_room_id, position)`

### `jam_room_members`

RLS enabled · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `jam_room_id` | `uuid references jam_rooms(id) on delete cascade` |
| `user_id` | `uuid references profiles(id) on delete cascade` |
| `role` | `text default 'listener' check (role in ('host', 'listener'))` |
| `permissions` | `jsonb default '{"can_play_pause":false` |
| `joined_at` | `timestamptz default now()` |

**Table constraints**

- `primary key (jam_room_id, user_id)`

### `jam_rooms`

RLS enabled · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `conversation_id` | `uuid references conversations(id) on delete cascade` |
| `host_id` | `uuid references profiles(id)` |
| `status` | `text default 'active' check (status in ('active', 'ended'))` |
| `current_track_id` | `uuid references tracks(id)` |
| `playback_position_ms` | `bigint default 0` |
| `is_playing` | `boolean default false` |
| `host_clock_at` | `timestamptz` |
| `started_at` | `timestamptz default now()` |
| `ended_at` | `timestamptz` |

**Indexes**

- `(unnamed)` `(conversation_id) where status = 'active'`

### `listen_sessions`

RLS enabled · defined in `20260515120000_home_feed_listen_sessions_recent_tracks.sql`

| Column | Definition |
|---|---|
| `user_id` | `uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE` |
| `track_title` | `text NOT NULL` |
| `artist_name` | `text NOT NULL` |
| `updated_at` | `timestamptz NOT NULL DEFAULT timezone('utc', now())` |

### `message_reactions`

RLS enabled · realtime · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `message_id` | `uuid references messages(id) on delete cascade` |
| `user_id` | `uuid references profiles(id) on delete cascade` |
| `emoji` | `text not null` |
| `created_at` | `timestamptz default now()` |

**Table constraints**

- `primary key (message_id, user_id, emoji)`

**Indexes**

- `(unnamed)` `(message_id)`

### `messages`

RLS enabled · realtime · defined in `20260528000000_chat_jam.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `conversation_id` | `uuid references conversations(id) on delete cascade not null` |
| `sender_id` | `uuid references profiles(id)` |
| `kind` | `text default 'text' check (kind in ('text', 'track_share', 'jam_invite', 'sticker', 'system'))` |
| `body` | `text` |
| `metadata` | `jsonb` |
| `reply_to_id` | `uuid references messages(id)` |
| `created_at` | `timestamptz default now()` |
| `deleted_at` | `timestamptz` |

**Indexes**

- `(unnamed)` `(conversation_id, created_at desc)`

**Triggers**

- `after_message_insert` — after insert (`20260528000000_chat_jam.sql`)

### `post_comment_likes`

RLS enabled · realtime · defined in `20260607000004_post_comments_likes_reports.sql`

| Column | Definition |
|---|---|
| `comment_id` | `uuid not null references public.post_comments(id) on delete cascade` |
| `user_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `created_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (comment_id, user_id)`

**Triggers**

- `trg_post_comment_likes_count` — after insert or delete (`20260607000004_post_comments_likes_reports.sql`)

### `post_comment_reports`

RLS enabled · defined in `20260607000004_post_comments_likes_reports.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `comment_id` | `uuid not null references public.post_comments(id) on delete cascade` |
| `reporter_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `reason` | `text not null check (reason in ('spam','harassment','hate','misinformation','other'))` |
| `details` | `text` |
| `created_at` | `timestamptz not null default now()` |

**Indexes**

- `post_comment_reports_reporter_idx` `(reporter_id)`

### `post_reports`

RLS enabled · defined in `20260607000007_post_reports.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `post_id` | `uuid not null references public.posts(id) on delete cascade` |
| `reporter_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `reason` | `text not null check (reason in ('spam','harassment','hate','misinformation','other'))` |
| `details` | `text` |
| `created_at` | `timestamptz not null default now()` |

**Indexes**

- `post_reports_reporter_idx` `(reporter_id)`
- `post_reports_post_idx` `(post_id)`

### `profiles_private`

RLS enabled · defined in `20260607000000_edit_profile_schema.sql`

| Column | Definition |
|---|---|
| `user_id` | `uuid primary key references auth.users(id) on delete cascade` |
| `date_of_birth` | `date` |
| `phone_number` | `text` |
| `updated_at` | `timestamptz not null default now()` |

### `stories`

RLS enabled · defined in `20260530000001_repost_and_stories.sql`

| Column | Definition |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `author_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `track_id` | `uuid not null references public.tracks(id) on delete cascade` |
| `original_post_id` | `uuid not null references public.posts(id) on delete cascade` |
| `comment` | `text` |
| `clip_start_sec` | `numeric(10, 3) not null` |
| `clip_end_sec` | `numeric(10, 3) not null` |
| `created_at` | `timestamptz not null default now()` |
| `expires_at` | `timestamptz not null default (now() + interval '24 hours')` |

**Table constraints**

- `constraint stories_clip_check check (
    clip_start_sec >= 0
    and clip_end_sec > clip_start_sec
    and (clip_end_sec - clip_start_sec) <= 10
  )`

**Indexes**

- `stories_active_idx` `(expires_at desc, author_id)`

### `story_views`

RLS enabled · defined in `20260530000001_repost_and_stories.sql`

| Column | Definition |
|---|---|
| `story_id` | `uuid not null references public.stories(id) on delete cascade` |
| `viewer_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `viewed_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (story_id, viewer_id)`

### `user_recent_tracks`

RLS enabled · defined in `20260515120000_home_feed_listen_sessions_recent_tracks.sql`

| Column | Definition |
|---|---|
| `user_id` | `uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE` |
| `track_id` | `uuid NOT NULL REFERENCES public.tracks (id) ON DELETE CASCADE` |
| `played_at` | `timestamptz NOT NULL DEFAULT timezone('utc', now())` |

**Table constraints**

- `PRIMARY KEY (user_id, track_id)`

**Indexes**

- `idx_user_recent_tracks_user_played` `(user_id, played_at DESC)`

### `waitlist`

RLS enabled · defined in `20260718000000_waitlist_table.sql`

| Column | Definition |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `email` | `text NOT NULL UNIQUE` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## Partial knowledge of undefined tables

What migrations added to tables whose base definition is not in this repository.

### `follows` *(base definition unknown)*

- index `idx_follows_follower_kind` `(follower_id, kind, following_id)`

### `friendships` *(base definition unknown)*

- index `idx_friendships_user_a_status` `(user_a_id, status)`
- index `idx_friendships_user_b_status` `(user_b_id, status)`

### `playlists` *(base definition unknown)*

| Column added | Definition | Migration |
|---|---|---|
| `visibility` | `public.playlist_visibility not null default 'public'` | `20260616000000_albums_and_playlist_visibility.sql` |
| `cover_emoji` | `text` | `20260616000002_playlist_emoji_cover.sql` |
| `cover_color` | `text` | `20260616000002_playlist_emoji_cover.sql` |
| `cover_color_2` | `text` | `20260616000003_playlist_cover_gradient.sql` |

- index `playlists_owner_vis_idx` `(user_id, visibility)`

### `post_comments` *(base definition unknown)*

| Column added | Definition | Migration |
|---|---|---|
| `like_count` | `int not null default 0` | `20260607000004_post_comments_likes_reports.sql` |

- index `post_comments_top_sort_idx` `(post_id, parent_comment_id, like_count desc, created_at desc)`
- index `post_comments_parent_idx` `(parent_comment_id)`

### `post_views` *(base definition unknown)*

| Column added | Definition | Migration |
|---|---|---|
| `id` | `uuid not null default gen_random_uuid()` | `20260607000005_post_views_multi_play.sql` |

- index `post_views_post_id_idx` `(post_id)`
- index `post_views_user_id_played_at_idx` `(user_id, played_at desc)`

### `posts` *(base definition unknown)*

| Column added | Definition | Migration |
|---|---|---|
| `clip_start_sec` | `numeric(10` | `20260530000001_repost_and_stories.sql` |
| `clip_end_sec` | `numeric(10` | `20260530000001_repost_and_stories.sql` |

- index `idx_posts_created_at_id_desc` `(created_at DESC, id DESC)`
- index `idx_posts_author_created` `(author_id, created_at DESC)`

### `profiles` *(base definition unknown)*

| Column added | Definition | Migration |
|---|---|---|
| `last_seen_at` | `timestamptz` | `20260528000000_chat_jam.sql` |
| `show_activity` | `boolean default true` | `20260528000000_chat_jam.sql` |
| `fans_seen_at` | `timestamptz` | `20260530000000_relationships.sql` |
| `links` | `text[] not null default '{}'` | `20260607000000_edit_profile_schema.sql` |
| `username_set` | `boolean NOT NULL DEFAULT false` | `20260628000000_profiles_username_set_and_oauth_onboarding.sql` |

### `tracks` *(base definition unknown)*

| Column added | Definition | Migration |
|---|---|---|
| `waveform_peaks` | `jsonb` | `20260611000000_tracks_waveform_peaks.sql` |

## Realtime publication

Tables published to `supabase_realtime`. Row changes stream to subscribers, gated by the
same row-level security policies that gate ordinary reads.

- `activity_notifications`
- `conversation_members`
- `friendships`
- `message_reactions`
- `messages`
- `post_comment_likes`
- `post_comments`

## Triggers

| Trigger | Table | Timing | Migration |
|---|---|---|---|
| `after_message_insert` | `messages` | after insert | `20260528000000_chat_jam.sql` |
| `trg_post_comment_likes_count` | `post_comment_likes` | after insert or delete | `20260607000004_post_comments_likes_reports.sql` |
| `trg_enforce_username_immutable` | `profiles` | BEFORE UPDATE | `20260628000000_profiles_username_set_and_oauth_onboarding.sql` |

## Related

- Privileged functions: [rpc-reference.md](rpc-reference.md)
- Authorization policies: [../security/rls-policies.md](../security/rls-policies.md)
- Access model and rationale: [../security/model.md](../security/model.md)
