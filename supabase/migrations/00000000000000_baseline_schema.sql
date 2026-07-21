-- ============================================================================
-- BASELINE SCHEMA — the 12 tables that predate the migration directory
-- ============================================================================
--
-- WHY THIS EXISTS (closes D-08)
--
-- These tables were created by hand in the Supabase dashboard before this
-- migration directory existed. Their structure and — more importantly — their
-- row-level security policies lived ONLY in the hosted project. That meant the
-- authorization model for the most important tables in the product could not be
-- reviewed, diffed, or restored from source (Constitution P51), and the database
-- could not be rebuilt from this repository at all.
--
-- Root cause, confirmed 2026-07-21: `supabase_migrations.schema_migrations` was
-- EMPTY. Every earlier migration in this directory was applied by hand, outside
-- the migration system. The directory was a changelog, not a source of truth.
--
-- HOW THIS WAS PRODUCED
--
-- Reflected from production (project fqzrmqnlgjeuxzinbqvs) on 2026-07-21 via
-- pg_catalog. This is a description of what IS, not a design of what should be —
-- oddities below are recorded faithfully rather than tidied, because a baseline
-- that "improves" things silently is not a baseline.
--
-- HOW TO USE IT
--
--   * Applying to the existing production database is a NO-OP. Every statement is
--     guarded with `if not exists` / `drop policy if exists`.
--   * On an empty database it recreates these tables so the full migration set
--     can be replayed — which is what makes migration CI possible.
--   * It intentionally does NOT create: auth.users (Supabase owns it), storage
--     buckets, the tables that later migrations already create, or the RPCs and
--     triggers those migrations define.
--
-- ORDERING: this file sorts first (timestamp all zeroes) so it runs before every
-- other migration.
-- ============================================================================

-- ── Enum used by playlists ──────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'playlist_visibility') then
    create type playlist_visibility as enum ('public', 'friends', 'private');
  end if;
end $$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per auth user. `username_set` gates the OAuth onboarding flow and is
-- made immutable by a trigger defined in a later migration.
create table if not exists public.profiles (
  id uuid not null primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  bio text,
  followers_count integer default 0,
  following_count integer default 0,
  created_at timestamptz default now(),
  last_seen_at timestamptz,
  show_activity boolean default true,
  fans_seen_at timestamptz,
  links text[] not null default '{}'::text[],
  username_set boolean not null default false
  -- NOTE: profiles_links_max_10 is deliberately NOT declared here.
  --
  -- A baseline describes the state BEFORE the migration set runs, so it must not
  -- contain anything a later migration adds. Postgres has no
  -- `ADD CONSTRAINT IF NOT EXISTS`, so a constraint present in both places makes
  -- the replay fail — which is exactly what CI caught on its first run.
  --
  -- 20260607000000_edit_profile_schema.sql adds this constraint without dropping
  -- first, so it must be absent here. Five other constraints (posts_clip_range_check,
  -- post_views_pkey, posts_original_post_id_fkey, posts_kind_shape_check,
  -- playlists_user_id_fkey) DO drop-then-add, so they are safe to declare here and
  -- are kept — they make this file readable as a description of the schema.
);

-- ── tracks ──────────────────────────────────────────────────────────────────
-- The uploaded media artifact. Note tracks_media_shape_check: an audio track must
-- have audio_url; a video track must have video_url AND no audio_url — the audio
-- of a video post is decoded from the video file itself (ADR-0001).
create table if not exists public.tracks (
  id uuid not null primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  audio_url text,
  video_url text,
  cover_art_url text,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  media_kind text not null,
  thumbnail_url text,
  waveform_peaks jsonb,
  constraint tracks_title_check check (char_length(title) between 1 and 120),
  constraint tracks_description_check check (char_length(description) <= 2000),
  constraint tracks_media_kind_check check (media_kind in ('audio', 'video')),
  constraint tracks_media_shape_check check (
    (media_kind = 'audio' and audio_url is not null)
    or (media_kind = 'video' and video_url is not null and audio_url is null)
  )
);

-- ── posts ───────────────────────────────────────────────────────────────────
-- The feed entity. A track is uploaded once and may appear in many posts.
-- original_post_id is ON DELETE SET NULL so a repost outlives its original.
create table if not exists public.posts (
  id uuid not null primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  track_id uuid not null references public.tracks(id) on delete cascade,
  original_post_id uuid references public.posts(id) on delete set null,
  caption text,
  views_count integer not null default 0,
  likes_count integer not null default 0,
  reposts_count integer not null default 0,
  comments_count integer not null default 0,
  created_at timestamptz not null default now(),
  clip_start_sec numeric(10,3),
  clip_end_sec numeric(10,3),
  constraint posts_kind_check check (kind in ('upload', 'repost')),
  constraint posts_kind_shape_check check (
    (kind = 'upload' and original_post_id is null) or kind = 'repost'
  ),
  constraint posts_clip_range_check check (
    (clip_start_sec is null and clip_end_sec is null)
    or (clip_start_sec is not null and clip_end_sec is not null
        and clip_start_sec >= 0 and clip_end_sec > clip_start_sec)
  )
);

-- ── engagement ──────────────────────────────────────────────────────────────
create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id uuid not null primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  parent_comment_id uuid references public.post_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  like_count integer not null default 0,
  constraint post_comments_body_check check (length(body) > 0)
);

-- Surrogate `id` primary key rather than (post_id, user_id): a user may play the
-- same post more than once and each play is counted (see 20260607000005).
create table if not exists public.post_views (
  id uuid not null primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  played_at timestamptz not null default now()
);

-- ── social graph ────────────────────────────────────────────────────────────
-- TWO INDEPENDENT SYSTEMS, not variants of one another:
--   friendships — mutual, negotiated, gates DMs/jams/stories
--   follows     — one-directional; kind is constrained to 'star'
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'star',
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_check check (follower_id <> following_id),
  constraint follows_kind_check check (kind = 'star')
);

-- user_a_id < user_b_id is enforced so a pair has exactly one row regardless of
-- who initiated; _friendship_pair() orders the ids before any lookup.
create table if not exists public.friendships (
  user_a_id uuid not null references public.profiles(id) on delete cascade,
  user_b_id uuid not null references public.profiles(id) on delete cascade,
  status text not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a_id, user_b_id),
  constraint friendships_check check (user_a_id < user_b_id),
  constraint friendships_check1 check (requested_by = user_a_id or requested_by = user_b_id),
  constraint friendships_status_check check (status in ('pending', 'accepted', 'blocked'))
);

-- ── playlists ───────────────────────────────────────────────────────────────
create table if not exists public.playlists (
  id uuid not null primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  visibility playlist_visibility not null default 'public',
  cover_emoji text,
  cover_color text,
  cover_color_2 text
);

create table if not exists public.playlist_posts (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, post_id)
);

-- ── credits ─────────────────────────────────────────────────────────────────
-- A collaborator is either a real profile OR a free-text name, never both.
create table if not exists public.track_collaborators (
  id uuid not null primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  custom_name text,
  role text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint collab_user_xor_custom check (
    (user_id is not null and custom_name is null)
    or (user_id is null and custom_name is not null)
  ),
  constraint track_collaborators_role_check check (char_length(role) between 1 and 40),
  constraint track_collaborators_status_check check (status in ('pending', 'accepted', 'declined'))
);

-- ── push ────────────────────────────────────────────────────────────────────
-- References auth.users directly rather than profiles: a device token must
-- survive independently of profile state.
create table if not exists public.device_tokens (
  id uuid not null primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  device_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id),
  constraint device_tokens_platform_check check (platform in ('android', 'ios'))
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists posts_author_id_created_at_idx on public.posts (author_id, created_at desc);
create index if not exists posts_author_id_kind_created_at_idx on public.posts (author_id, kind, created_at desc);
create index if not exists posts_original_post_id_idx on public.posts (original_post_id);
create index if not exists posts_track_id_idx on public.posts (track_id);
create index if not exists tracks_uploader_created_idx on public.tracks (uploader_id, created_at desc);
create index if not exists post_likes_user_id_idx on public.post_likes (user_id, created_at desc);
create index if not exists post_comments_post_id_idx on public.post_comments (post_id, created_at);
create index if not exists follows_following_id_idx on public.follows (following_id, created_at desc);
create index if not exists friendships_status_idx on public.friendships (status);
create index if not exists friendships_user_b_idx on public.friendships (user_b_id);
create index if not exists track_collab_track_idx on public.track_collaborators (track_id);
create index if not exists track_collab_user_status_idx on public.track_collaborators (user_id, status) where user_id is not null;
create index if not exists device_tokens_user_id_idx on public.device_tokens (user_id);

-- ── Row-level security ──────────────────────────────────────────────────────
-- RLS is the authorization perimeter for this product; there is no API tier
-- (ADR-0004). Every policy below is reflected from production as of 2026-07-21.
--
-- READ MODEL: profiles, posts, tracks, post_likes, post_comments, post_views,
-- track_collaborators and follows are readable by ANY authenticated user
-- (`using (true)` scoped `to authenticated`). Writes are owner-scoped throughout.
-- friendships and playlists are the exceptions — both restrict reads.

alter table public.profiles            enable row level security;
alter table public.tracks              enable row level security;
alter table public.posts               enable row level security;
alter table public.post_likes          enable row level security;
alter table public.post_comments       enable row level security;
alter table public.post_views          enable row level security;
alter table public.follows             enable row level security;
alter table public.friendships         enable row level security;
alter table public.playlists           enable row level security;
alter table public.playlist_posts      enable row level security;
alter table public.track_collaborators enable row level security;
alter table public.device_tokens       enable row level security;

-- profiles
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- tracks
drop policy if exists "tracks_select_authenticated" on public.tracks;
create policy "tracks_select_authenticated" on public.tracks
  for select to authenticated using (true);
drop policy if exists "tracks_insert_own" on public.tracks;
create policy "tracks_insert_own" on public.tracks
  for insert to authenticated with check (uploader_id = auth.uid());
drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own" on public.tracks
  for update to authenticated using (uploader_id = auth.uid()) with check (uploader_id = auth.uid());
drop policy if exists "tracks_delete_own" on public.tracks;
create policy "tracks_delete_own" on public.tracks
  for delete to authenticated using (uploader_id = auth.uid());

-- posts
drop policy if exists "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated" on public.posts
  for select to authenticated using (true);
drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts
  for delete to authenticated using (author_id = auth.uid());

-- post_likes
drop policy if exists "post_likes_select_authenticated" on public.post_likes;
create policy "post_likes_select_authenticated" on public.post_likes
  for select to authenticated using (true);
drop policy if exists "post_likes_insert_self" on public.post_likes;
create policy "post_likes_insert_self" on public.post_likes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "post_likes_delete_self" on public.post_likes;
create policy "post_likes_delete_self" on public.post_likes
  for delete to authenticated using (user_id = auth.uid());

-- post_comments
drop policy if exists "post_comments_select_authenticated" on public.post_comments;
create policy "post_comments_select_authenticated" on public.post_comments
  for select to authenticated using (true);
drop policy if exists "post_comments_insert_self" on public.post_comments;
create policy "post_comments_insert_self" on public.post_comments
  for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "post_comments_update_self" on public.post_comments;
create policy "post_comments_update_self" on public.post_comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "post_comments_delete_self" on public.post_comments;
create policy "post_comments_delete_self" on public.post_comments
  for delete to authenticated using (author_id = auth.uid());

-- post_views (insert-only from the client; no update or delete policy exists,
-- so those operations are denied by default)
drop policy if exists "post_views_select_authenticated" on public.post_views;
create policy "post_views_select_authenticated" on public.post_views
  for select to authenticated using (true);
drop policy if exists "post_views_insert_self" on public.post_views;
create policy "post_views_insert_self" on public.post_views
  for insert to authenticated with check (user_id = auth.uid());

-- follows
-- NOTE: production also carried unscoped duplicates of the insert/delete policies
-- (follows_insert / follows_delete alongside follows_insert_self /
-- follows_delete_self). Only the `to authenticated` versions are reproduced here.
-- The unscoped SELECT counterpart was the D-10 anon-read exposure, dropped in
-- 20260720192324.
drop policy if exists "follows_select_authenticated" on public.follows;
create policy "follows_select_authenticated" on public.follows
  for select to authenticated using (true);
drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self" on public.follows
  for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "follows_delete_self" on public.follows;
create policy "follows_delete_self" on public.follows
  for delete to authenticated using (follower_id = auth.uid());

-- friendships — participants only. Production likewise carries unscoped
-- duplicates of each of these; only the `to authenticated` versions are kept.
drop policy if exists "friendships_select_participants" on public.friendships;
create policy "friendships_select_participants" on public.friendships
  for select to authenticated using (user_a_id = auth.uid() or user_b_id = auth.uid());
drop policy if exists "friendships_insert_participant" on public.friendships;
create policy "friendships_insert_participant" on public.friendships
  for insert to authenticated
  with check (requested_by = auth.uid() and (user_a_id = auth.uid() or user_b_id = auth.uid()));
drop policy if exists "friendships_update_participant" on public.friendships;
create policy "friendships_update_participant" on public.friendships
  for update to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid())
  with check (user_a_id = auth.uid() or user_b_id = auth.uid());
drop policy if exists "friendships_delete_participant" on public.friendships;
create policy "friendships_delete_participant" on public.friendships
  for delete to authenticated using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- playlists — visibility-aware reads; owner-only writes
drop policy if exists "playlists_select" on public.playlists;
create policy "playlists_select" on public.playlists
  for select using (
    user_id = auth.uid()
    or visibility = 'public'::playlist_visibility
    or (visibility = 'friends'::playlist_visibility and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_a_id = auth.uid() and f.user_b_id = playlists.user_id)
          or (f.user_b_id = auth.uid() and f.user_a_id = playlists.user_id))
    ))
  );
drop policy if exists "Users manage own playlists" on public.playlists;
create policy "Users manage own playlists" on public.playlists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- playlist_posts — reads mirror the parent playlist's visibility transitively
drop policy if exists "playlist_posts_select" on public.playlist_posts;
create policy "playlist_posts_select" on public.playlist_posts
  for select using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_posts.playlist_id
        and (p.user_id = auth.uid()
          or p.visibility = 'public'::playlist_visibility
          or (p.visibility = 'friends'::playlist_visibility and exists (
            select 1 from public.friendships f
            where f.status = 'accepted'
              and ((f.user_a_id = auth.uid() and f.user_b_id = p.user_id)
                or (f.user_b_id = auth.uid() and f.user_a_id = p.user_id))
          )))
    )
  );
drop policy if exists "Users manage own playlist posts" on public.playlist_posts;
create policy "Users manage own playlist posts" on public.playlist_posts
  for all using (
    exists (select 1 from public.playlists
            where playlists.id = playlist_posts.playlist_id
              and playlists.user_id = auth.uid())
  );

-- track_collaborators — the uploader manages credits; a tagged user may update
-- their own row (to accept or decline)
drop policy if exists "track_collab_select_authenticated" on public.track_collaborators;
create policy "track_collab_select_authenticated" on public.track_collaborators
  for select to authenticated using (true);
drop policy if exists "track_collab_insert_by_uploader" on public.track_collaborators;
create policy "track_collab_insert_by_uploader" on public.track_collaborators
  for insert to authenticated with check (
    exists (select 1 from public.tracks t
            where t.id = track_collaborators.track_id and t.uploader_id = auth.uid())
  );
drop policy if exists "track_collab_update_by_uploader_or_self" on public.track_collaborators;
create policy "track_collab_update_by_uploader_or_self" on public.track_collaborators
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tracks t
               where t.id = track_collaborators.track_id and t.uploader_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.tracks t
               where t.id = track_collaborators.track_id and t.uploader_id = auth.uid())
  );
drop policy if exists "track_collab_delete_by_uploader" on public.track_collaborators;
create policy "track_collab_delete_by_uploader" on public.track_collaborators
  for delete to authenticated using (
    exists (select 1 from public.tracks t
            where t.id = track_collaborators.track_id and t.uploader_id = auth.uid())
  );

-- device_tokens — strictly owner-scoped on all four operations. Verified
-- 2026-07-21; this resolved D-09, which had flagged the RLS status as unknown.
drop policy if exists "users select own tokens" on public.device_tokens;
create policy "users select own tokens" on public.device_tokens
  for select using (auth.uid() = user_id);
drop policy if exists "users insert own tokens" on public.device_tokens;
create policy "users insert own tokens" on public.device_tokens
  for insert with check (auth.uid() = user_id);
drop policy if exists "users update own tokens" on public.device_tokens;
create policy "users update own tokens" on public.device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users delete own tokens" on public.device_tokens;
create policy "users delete own tokens" on public.device_tokens
  for delete using (auth.uid() = user_id);
