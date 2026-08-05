---
tier: 1
owner: principal-data
consumers: [P-DA, BE, QA, DC]
last_verified: 2026-08-05
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

Reconstructed from 68 migration(s) in `supabase/migrations/`.

## ⚠️ This schema is incomplete

**0 table(s) are referenced by migrations but never created in this
repository.** They predate the migration directory and were created directly in the hosted
project. Their columns, constraints, and policies exist only in production.

The consequence is that **this database cannot be rebuilt from this repository**, and the
authorization model on those tables cannot be reviewed from source. Constitution P51 says
production state that exists nowhere in the repository is state we cannot reason about,
review, or restore. Closing this requires a baseline schema dump.

## Tables defined in this repository

34 table(s).

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

**Triggers**

- `trg_conversation_members_freeze_identity` — before update (`20260722000000_liv10_authorization_guards.sql`)

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

**Triggers**

- `trg_conversations_freeze_derived` — before update (`20260722180000_fix_comment_like_counts_and_conversation_drift.sql`)

### `deleted_accounts`

RLS enabled · defined in `20260730000000_liv74_delete_messages_and_deletion_ledger.sql`

| Column | Definition |
|---|---|
| `id` | `bigint generated always as identity primary key` |
| `email_sha256` | `text` |
| `username` | `text` |
| `deleted_at` | `timestamptz not null default now()` |

**Indexes**

- `deleted_accounts_username_idx` `(username)`
- `deleted_accounts_email_idx` `(email_sha256)`

### `device_tokens`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` |
| `token` | `text not null` |
| `platform` | `text not null default 'android'` |
| `device_id` | `text not null` |
| `created_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

**Table constraints**

- `unique (user_id, device_id)`
- `constraint device_tokens_platform_check check (platform in ('android', 'ios'))`

**Indexes**

- `device_tokens_user_id_idx` `(user_id)`

### `follows`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `follower_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `following_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `kind` | `text not null default 'star'` |
| `created_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (follower_id, following_id)`
- `constraint follows_check check (follower_id <> following_id)`
- `constraint follows_kind_check check (kind = 'star')`

**Indexes**

- `follows_following_id_idx` `(following_id, created_at desc)`
- `idx_follows_follower_kind` `(follower_id, kind, following_id)`

**Triggers**

- `trg_follows_profile_counts` — after insert or delete (`20260722120000_capture_counter_triggers.sql`)

### `friendships`

RLS enabled · realtime · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `user_a_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `user_b_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `status` | `text not null` |
| `requested_by` | `uuid not null references public.profiles(id) on delete cascade` |
| `created_at` | `timestamptz not null default now()` |
| `accepted_at` | `timestamptz` |

**Table constraints**

- `primary key (user_a_id, user_b_id)`
- `constraint friendships_check check (user_a_id < user_b_id)`
- `constraint friendships_check1 check (requested_by = user_a_id or requested_by = user_b_id)`
- `constraint friendships_status_check check (status in ('pending', 'accepted', 'blocked'))`

**Indexes**

- `friendships_status_idx` `(status)`
- `friendships_user_b_idx` `(user_b_id)`
- `idx_friendships_user_a_status` `(user_a_id, status)`
- `idx_friendships_user_b_status` `(user_b_id, status)`

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
- `trg_messages_freeze_identity` — before update (`20260729000000_liv78_msg_update_with_check.sql`)
- `after_message_delete` — after delete (`20260730000000_liv74_delete_messages_and_deletion_ledger.sql`)

### `notification_preferences`

RLS enabled · defined in `20260803120000_notification_preferences.sql`

| Column | Definition |
|---|---|
| `user_id` | `uuid primary key references auth.users(id) on delete cascade` |
| `social` | `boolean not null default true` |
| `activity` | `boolean not null default true` |
| `messages` | `boolean not null default true` |
| `jam` | `boolean not null default true` |
| `updated_at` | `timestamptz not null default now()` |

### `ops_users`

RLS enabled · defined in `20260805000000_waitlist_ops_dashboard.sql`

| Column | Definition |
|---|---|
| `user_id` | `uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` |
| `note` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

### `playlist_posts`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `playlist_id` | `uuid not null references public.playlists(id) on delete cascade` |
| `post_id` | `uuid not null references public.posts(id) on delete cascade` |
| `added_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (playlist_id, post_id)`

### `playlists`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `user_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `name` | `text not null` |
| `created_at` | `timestamptz not null default now()` |
| `visibility` | `playlist_visibility not null default 'public'` |
| `cover_emoji` | `text` |
| `cover_color` | `text` |
| `cover_color_2` | `text` |

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `visibility` | `public.playlist_visibility not null default 'public'` | `20260616000000_albums_and_playlist_visibility.sql` |
| `cover_emoji` | `text` | `20260616000002_playlist_emoji_cover.sql` |
| `cover_color` | `text` | `20260616000002_playlist_emoji_cover.sql` |
| `cover_color_2` | `text` | `20260616000003_playlist_cover_gradient.sql` |

**Indexes**

- `playlists_owner_vis_idx` `(user_id, visibility)`

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

### `post_comments`

RLS enabled · realtime · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `post_id` | `uuid not null references public.posts(id) on delete cascade` |
| `author_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `body` | `text not null` |
| `parent_comment_id` | `uuid references public.post_comments(id) on delete cascade` |
| `created_at` | `timestamptz not null default now()` |
| `like_count` | `integer not null default 0` |

**Table constraints**

- `constraint post_comments_body_check check (length(body) > 0)`

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `like_count` | `int not null default 0` | `20260607000004_post_comments_likes_reports.sql` |

**Indexes**

- `post_comments_post_id_idx` `(post_id, created_at)`
- `post_comments_top_sort_idx` `(post_id, parent_comment_id, like_count desc, created_at desc)`
- `post_comments_parent_idx` `(parent_comment_id)`

**Triggers**

- `trg_post_comments_count` — after insert or delete (`20260722120000_capture_counter_triggers.sql`)
- `trg_post_comments_freeze_post_id` — before update (`20260722140000_freeze_counter_identity_columns.sql`)

### `post_likes`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `post_id` | `uuid not null references public.posts(id) on delete cascade` |
| `user_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `created_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (post_id, user_id)`

**Indexes**

- `post_likes_user_id_idx` `(user_id, created_at desc)`

**Triggers**

- `trg_post_likes_count` — after insert or delete (`20260722120000_capture_counter_triggers.sql`)

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

### `post_views`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `post_id` | `uuid not null references public.posts(id) on delete cascade` |
| `user_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `played_at` | `timestamptz not null default now()` |

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `id` | `uuid not null default gen_random_uuid()` | `20260607000005_post_views_multi_play.sql` |

**Indexes**

- `post_views_post_id_idx` `(post_id)`
- `post_views_user_id_played_at_idx` `(user_id, played_at desc)`
- `post_views_post_id_played_at_idx` `(post_id, played_at desc)`

**Triggers**

- `trg_post_views_count` — after insert (`20260722120000_capture_counter_triggers.sql`)

### `posts`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `author_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `kind` | `text not null` |
| `track_id` | `uuid not null references public.tracks(id) on delete cascade` |
| `original_post_id` | `uuid references public.posts(id) on delete set null` |
| `caption` | `text` |
| `views_count` | `integer not null default 0` |
| `likes_count` | `integer not null default 0` |
| `reposts_count` | `integer not null default 0` |
| `comments_count` | `integer not null default 0` |
| `created_at` | `timestamptz not null default now()` |
| `clip_start_sec` | `numeric(10,3)` |
| `clip_end_sec` | `numeric(10,3)` |

**Table constraints**

- `constraint posts_kind_check check (kind in ('upload', 'repost'))`
- `constraint posts_kind_shape_check check (
    (kind = 'upload' and original_post_id is null) or kind = 'repost'
  )`
- `constraint posts_clip_range_check check (
    (clip_start_sec is null and clip_end_sec is null)
    or (clip_start_sec is not null and clip_end_sec is not null
        and clip_start_sec >= 0 and clip_end_sec > clip_start_sec)
  )`

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `clip_start_sec` | `numeric(10` | `20260530000001_repost_and_stories.sql` |
| `clip_end_sec` | `numeric(10` | `20260530000001_repost_and_stories.sql` |

**Indexes**

- `posts_author_id_created_at_idx` `(author_id, created_at desc)`
- `posts_author_id_kind_created_at_idx` `(author_id, kind, created_at desc)`
- `posts_original_post_id_idx` `(original_post_id)`
- `posts_track_id_idx` `(track_id)`
- `idx_posts_created_at_id_desc` `(created_at DESC, id DESC)`
- `idx_posts_author_created` `(author_id, created_at DESC)`

**Triggers**

- `trg_post_reposts_count` — after insert or delete (`20260722120000_capture_counter_triggers.sql`)
- `trg_posts_freeze_counter_identity` — before update (`20260722140000_freeze_counter_identity_columns.sql`)
- `trg_posts_clamp_counters_on_insert` — before insert (`20260722160000_counters_are_not_client_writable.sql`)

### `profiles`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key references auth.users(id) on delete cascade` |
| `username` | `text not null unique` |
| `display_name` | `text` |
| `avatar_url` | `text` |
| `bio` | `text` |
| `followers_count` | `integer default 0` |
| `following_count` | `integer default 0` |
| `created_at` | `timestamptz default now()` |
| `last_seen_at` | `timestamptz` |
| `show_activity` | `boolean default true` |
| `fans_seen_at` | `timestamptz` |
| `links` | `text[] not null default '{}'::text[]` |
| `username_set` | `boolean not null default false` |

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `last_seen_at` | `timestamptz` | `20260528000000_chat_jam.sql` |
| `show_activity` | `boolean default true` | `20260528000000_chat_jam.sql` |
| `fans_seen_at` | `timestamptz` | `20260530000000_relationships.sql` |
| `links` | `text[] not null default '{}'` | `20260607000000_edit_profile_schema.sql` |
| `username_set` | `boolean NOT NULL DEFAULT false` | `20260628000000_profiles_username_set_and_oauth_onboarding.sql` |
| `comments_friends_only` | `boolean not null default false` | `20260803000000_profiles_comments_friends_only.sql` |

**Indexes**

- **unique** `profiles_username_lower_key` `(lower(username))`

**Triggers**

- `trg_enforce_username_immutable` — BEFORE UPDATE (`20260628000000_profiles_username_set_and_oauth_onboarding.sql`)
- `trg_profiles_freeze_counters` — before update (`20260722160000_counters_are_not_client_writable.sql`)
- `trg_enforce_username_reservation` — before insert or update (`20260730000000_liv74_delete_messages_and_deletion_ledger.sql`)

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

**Triggers**

- `stories_pin_expiry_trg` — before insert or update (`20260724120000_prop0004_harden_stories.sql`)

### `story_views`

RLS enabled · defined in `20260530000001_repost_and_stories.sql`

| Column | Definition |
|---|---|
| `story_id` | `uuid not null references public.stories(id) on delete cascade` |
| `viewer_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `viewed_at` | `timestamptz not null default now()` |

**Table constraints**

- `primary key (story_id, viewer_id)`

### `track_collaborators`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `track_id` | `uuid not null references public.tracks(id) on delete cascade` |
| `user_id` | `uuid references public.profiles(id) on delete set null` |
| `custom_name` | `text` |
| `role` | `text not null` |
| `status` | `text not null default 'pending'` |
| `created_at` | `timestamptz not null default now()` |

**Table constraints**

- `constraint collab_user_xor_custom check (
    (user_id is not null and custom_name is null)
    or (user_id is null and custom_name is not null)
  )`
- `constraint track_collaborators_role_check check (char_length(role) between 1 and 40)`
- `constraint track_collaborators_status_check check (status in ('pending', 'accepted', 'declined'))`

**Indexes**

- `track_collab_track_idx` `(track_id)`
- `track_collab_user_status_idx` `(user_id, status) where user_id is not null`

### `tracks`

RLS enabled · defined in `00000000000000_baseline_schema.sql`

| Column | Definition |
|---|---|
| `id` | `uuid not null primary key default gen_random_uuid()` |
| `uploader_id` | `uuid not null references public.profiles(id) on delete cascade` |
| `title` | `text not null` |
| `description` | `text` |
| `audio_url` | `text` |
| `video_url` | `text` |
| `cover_art_url` | `text` |
| `duration_seconds` | `integer` |
| `created_at` | `timestamptz not null default now()` |
| `media_kind` | `text not null` |
| `thumbnail_url` | `text` |
| `waveform_peaks` | `jsonb` |

**Table constraints**

- `constraint tracks_title_check check (char_length(title) between 1 and 120)`
- `constraint tracks_description_check check (char_length(description) <= 2000)`
- `constraint tracks_media_kind_check check (media_kind in ('audio', 'video'))`
- `constraint tracks_media_shape_check check (
    (media_kind = 'audio' and audio_url is not null)
    or (media_kind = 'video' and video_url is not null and audio_url is null)
  )`

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `waveform_peaks` | `jsonb` | `20260611000000_tracks_waveform_peaks.sql` |
| `file_size_bytes` | `bigint` | `20260804040000_tracks_file_size.sql` |
| `lyrics` | `text` | `20260805030000_track_lyrics.sql` |
| `lyrics_format` | `text` | `20260805030000_track_lyrics.sql` |

**Indexes**

- `tracks_uploader_created_idx` `(uploader_id, created_at desc)`

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

**Added by later migrations**

| Column | Definition | Migration |
|---|---|---|
| `email_sent_at` | `timestamptz` | `20260805000000_waitlist_ops_dashboard.sql` |
| `email_error` | `text` | `20260805000000_waitlist_ops_dashboard.sql` |
| `email_attempts` | `integer NOT NULL DEFAULT 0` | `20260805000000_waitlist_ops_dashboard.sql` |
| `email_source` | `text CONSTRAINT waitlist_email_source_check CHECK (email_source IN ('auto'` | `20260806000000_waitlist_self_serve_invite.sql` |

**Indexes**

- `waitlist_created_at_desc_idx` `(created_at DESC)`

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
| `trg_conversation_members_freeze_identity` | `conversation_members` | before update | `20260722000000_liv10_authorization_guards.sql` |
| `trg_conversations_freeze_derived` | `conversations` | before update | `20260722180000_fix_comment_like_counts_and_conversation_drift.sql` |
| `trg_follows_profile_counts` | `follows` | after insert or delete | `20260722120000_capture_counter_triggers.sql` |
| `after_message_insert` | `messages` | after insert | `20260528000000_chat_jam.sql` |
| `trg_messages_freeze_identity` | `messages` | before update | `20260729000000_liv78_msg_update_with_check.sql` |
| `after_message_delete` | `messages` | after delete | `20260730000000_liv74_delete_messages_and_deletion_ledger.sql` |
| `trg_post_comment_likes_count` | `post_comment_likes` | after insert or delete | `20260607000004_post_comments_likes_reports.sql` |
| `trg_post_comments_count` | `post_comments` | after insert or delete | `20260722120000_capture_counter_triggers.sql` |
| `trg_post_comments_freeze_post_id` | `post_comments` | before update | `20260722140000_freeze_counter_identity_columns.sql` |
| `trg_post_likes_count` | `post_likes` | after insert or delete | `20260722120000_capture_counter_triggers.sql` |
| `trg_post_views_count` | `post_views` | after insert | `20260722120000_capture_counter_triggers.sql` |
| `trg_post_reposts_count` | `posts` | after insert or delete | `20260722120000_capture_counter_triggers.sql` |
| `trg_posts_freeze_counter_identity` | `posts` | before update | `20260722140000_freeze_counter_identity_columns.sql` |
| `trg_posts_clamp_counters_on_insert` | `posts` | before insert | `20260722160000_counters_are_not_client_writable.sql` |
| `trg_enforce_username_immutable` | `profiles` | BEFORE UPDATE | `20260628000000_profiles_username_set_and_oauth_onboarding.sql` |
| `trg_profiles_freeze_counters` | `profiles` | before update | `20260722160000_counters_are_not_client_writable.sql` |
| `trg_enforce_username_reservation` | `profiles` | before insert or update | `20260730000000_liv74_delete_messages_and_deletion_ledger.sql` |
| `stories_pin_expiry_trg` | `stories` | before insert or update | `20260724120000_prop0004_harden_stories.sql` |

## Related

- Privileged functions: [rpc-reference.md](rpc-reference.md)
- Authorization policies: [../security/rls-policies.md](../security/rls-policies.md)
- Access model and rationale: [../security/model.md](../security/model.md)
