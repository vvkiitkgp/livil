-- ============================================================================
-- Spotify reposts (ADR-0027)
-- ============================================================================
--
-- A Spotify repost is a `posts` row with kind = 'repost' whose media is a Spotify track
-- instead of a Livil upload. It lives in `posts` deliberately — likes, comments, reports,
-- the Repost pill, the activity feed and friends-only visibility all key on posts.id and
-- work for it without a parallel set of tables. The cost is that the row has no
-- `track_id`, so this migration makes that column nullable and pins down exactly when it
-- may be null.
--
-- WHAT IS STORED: only the 22-character Spotify track id. Never the title, artist or
-- artwork — Spotify's Developer Terms allow only temporary caching of its metadata, so the
-- app resolves it at display time through the `spotify` edge function.
--
-- PLAYBACK: none in Livil. A Spotify repost is opened in the Spotify app. Nothing here
-- lets it reach the play queue, playlists, Jam, stories or the recently-played list.
--
-- ── Old app versions (production compatibility) ─────────────────────────────
-- Every existing row keeps track_id set, so nothing an installed app reads today changes.
-- A Spotify repost created by a newer app reaches an older one as a repost with no track
-- and no original post, which the shipped PostCard (2.1.x) draws as its "original was
-- removed" tombstone with likes and comments. Accepted by the maintainer (2026-10-08): the
-- user base is small and will be asked to update before the feature is switched on —
-- and the switch (section 2b) is enforced by this database, so nothing can be created
-- before then.
--
-- ADDITIVE ONLY: a new nullable column, a relaxed NOT NULL, two CHECKs that every
-- existing row satisfies, an off-by-default switch, and trigger guards. No row is
-- rewritten, and with the switch off (the default) no Spotify repost can be created.
-- ============================================================================

-- ── 1. The column ───────────────────────────────────────────────────────────
alter table public.posts add column if not exists spotify_track_id text;

-- Spotify's base-62 track id. Anything else is not a Spotify track id, and refusing it here
-- means the app can build the open.spotify.com URL from the stored value without escaping.
alter table public.posts drop constraint if exists posts_spotify_track_id_format;
alter table public.posts add constraint posts_spotify_track_id_format check (
  spotify_track_id is null or spotify_track_id ~ '^[A-Za-z0-9]{22}$'
);

-- ── 2. Exactly one media source ─────────────────────────────────────────────
-- A post serves a Livil track OR a Spotify track, never both and never neither. A Spotify
-- post is always a repost of nothing in Livil (no original_post_id) and has no clip:
-- Livil cannot play it, so there is no window to choose.
alter table public.posts alter column track_id drop not null;

alter table public.posts drop constraint if exists posts_media_source_check;
alter table public.posts add constraint posts_media_source_check check (
  (track_id is not null and spotify_track_id is null)
  or (
    track_id is null
    and spotify_track_id is not null
    and kind = 'repost'
    and original_post_id is null
    and clip_start_sec is null
    and clip_end_sec is null
  )
);

-- ── 2b. The switch — enforced HERE, not just hidden in the app ──────────────
-- While it is off, the database refuses to store a Spotify repost, whatever the client
-- sends: a hidden button is not a rule, and posts_insert_own checks only author_id. This is
-- what protects people still on an old app (which draw a Spotify repost as a tombstone)
-- until the owner decides enough of them have updated.
--
-- Flipped by the owner in the SQL editor:
--   update public.app_switches set enabled = true, updated_at = now()
--    where key = 'spotify_reposts';
--
-- Deny-all to clients: RLS on, no policies. Read only through the function below.
create table if not exists public.app_switches (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.app_switches enable row level security;
revoke all on public.app_switches from anon, authenticated;

insert into public.app_switches (key, enabled) values ('spotify_reposts', false)
on conflict (key) do nothing;

-- The app asks this to decide whether to show "Repost from Spotify". Signed-in users only.
create or replace function public.spotify_reposts_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select enabled from public.app_switches where key = 'spotify_reposts'),
    false
  );
$function$;

revoke execute on function public.spotify_reposts_enabled() from public, anon;
grant execute on function public.spotify_reposts_enabled() to authenticated;

create or replace function public.posts_spotify_switch_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.spotify_track_id is not null and not public.spotify_reposts_enabled() then
    raise exception 'Spotify reposts are not switched on'
      using errcode = '42501';
  end if;
  return new;
end $function$;

revoke execute on function public.posts_spotify_switch_guard() from public, anon, authenticated;

drop trigger if exists trg_posts_spotify_switch_guard on public.posts;
create trigger trg_posts_spotify_switch_guard
  before insert on public.posts
  for each row execute function public.posts_spotify_switch_guard();

-- ── 3. The Spotify track is part of the post's identity ─────────────────────
-- Same reasoning as track_id: repointing a post at another song would keep this author's
-- caption, likes and comments on a different piece of music. Copied from the current
-- definition (20260722160000) with the one new check added.
create or replace function public.posts_freeze_counter_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- kind is never editable. An upload does not become a repost, or the reverse.
  if new.kind is distinct from old.kind then
    raise exception 'posts.kind is immutable'
      using errcode = '42501';
  end if;

  if new.original_post_id is distinct from old.original_post_id then
    -- Allowed only when this is the FK's ON DELETE SET NULL firing: the column is being
    -- cleared, and the post it pointed at no longer exists.
    if not (new.original_post_id is null
            and old.original_post_id is not null
            and not exists (select 1 from public.posts where id = old.original_post_id)) then
      raise exception 'posts.original_post_id is immutable'
        using errcode = '42501';
    end if;
  end if;

  -- Which track a post serves is its identity. Repointing it makes the post a wrapper
  -- around someone else's work while keeping this author's name, caption and play counter.
  -- Unconditional, like `kind`: there is no legitimate writer.
  if new.track_id is distinct from old.track_id then
    raise exception 'posts.track_id is immutable'
      using errcode = '42501';
  end if;

  -- The same rule for a Spotify repost's song (20261013000000).
  if new.spotify_track_id is distinct from old.spotify_track_id then
    raise exception 'posts.spotify_track_id is immutable'
      using errcode = '42501';
  end if;

  -- Counters are maintained by the five counter triggers and by nothing else.
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    if new.views_count    is distinct from old.views_count
    or new.likes_count    is distinct from old.likes_count
    or new.reposts_count  is distinct from old.reposts_count
    or new.comments_count is distinct from old.comments_count then
      raise exception 'posts counters are derived and cannot be set directly'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $function$;

-- ── 4. Livil-only surfaces refuse a Spotify repost ──────────────────────────
-- The app never offers these actions on a Spotify card, but a hidden button is not a rule.
-- Each of these tables feeds Livil's player; a row pointing at a post with no track would
-- reach the engine as an item with no media URL.
create or replace function public.reject_spotify_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if exists (
    select 1 from public.posts
     where id = new.post_id and track_id is null and spotify_track_id is not null
  ) then
    raise exception 'a Spotify repost cannot be added to %', tg_table_name
      using errcode = '22023';
  end if;
  return new;
end $function$;

revoke execute on function public.reject_spotify_post() from public, anon, authenticated;

drop trigger if exists trg_playlist_posts_reject_spotify on public.playlist_posts;
create trigger trg_playlist_posts_reject_spotify
  before insert or update of post_id on public.playlist_posts
  for each row execute function public.reject_spotify_post();

drop trigger if exists trg_jam_suggestions_reject_spotify on public.jam_suggestions;
create trigger trg_jam_suggestions_reject_spotify
  before insert or update of post_id on public.jam_suggestions
  for each row execute function public.reject_spotify_post();

-- A "play" of a Spotify repost is not a Livil play: it happened in another app. Refusing
-- it keeps views_count, hot_score and the listening analytics about Livil listening only.
drop trigger if exists trg_post_views_reject_spotify on public.post_views;
create trigger trg_post_views_reject_spotify
  before insert on public.post_views
  for each row execute function public.reject_spotify_post();

-- ── 5. Recently played tolerates a track-less post ──────────────────────────
-- user_recent_tracks.track_id is NOT NULL. post_views now refuses Spotify posts (above), so
-- this guard is belt-and-braces: should that ever change, recording a view must not fail
-- on a null track. Copied from the current definition with the one condition added.
create or replace function public.user_recent_tracks_record_play()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into user_recent_tracks (user_id, track_id, played_at, last_post_id)
  select new.user_id, p.track_id, new.played_at, p.id
    from posts p
   where p.id = new.post_id
     and p.track_id is not null
  on conflict (user_id, track_id) do update
    set played_at    = greatest(user_recent_tracks.played_at, excluded.played_at),
        last_post_id = case
                         when excluded.played_at >= user_recent_tracks.played_at
                           then excluded.last_post_id
                         else user_recent_tracks.last_post_id
                       end;
  return new;
end $function$;

comment on column public.posts.spotify_track_id is
  'Spotify track id (base-62, 22 chars) for a Spotify repost; null for every Livil post. '
  'Only the id is stored — metadata is resolved at display time (Spotify Developer Terms). '
  'Exactly one of track_id / spotify_track_id is set (posts_media_source_check). ADR-0027.';
