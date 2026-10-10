-- ============================================================================
-- shared_post_public — stop handing the media file to signed-out visitors
-- ============================================================================
--
-- Owner's rule (2026-10-09): listening needs a Livil account. A link shared to WhatsApp
-- shows the post's metadata and a "Listen on Livil" button; it does not play.
--
-- The share page (web/api/share.ts) no longer renders a player and never emits a media
-- URL. That alone is not the rule, because this function is granted to `anon` and the
-- anon key is public by design: anyone could call it directly and get the file's address
-- back, and the storage bucket serves any address it is given. So the URLs stop leaving
-- the database here, where the rule can actually be enforced.
--
-- ── WHY NULL AND NOT A DROPPED COLUMN ───────────────────────────────────────
--
-- `track_audio_url` and `track_video_url` stay in the return type and come back NULL.
-- Removing them would change the function's OUT parameters, which forces a DROP +
-- CREATE (see 20260922000000 for what that costs: the grants go with the drop). Keeping
-- the shape lets `create or replace` swap the body in place, keeps the existing grants,
-- and means anything that reads the old shape gets nulls instead of an error. The share
-- page is the only caller (no shipped mobile build calls this function — checked at
-- releases 2.1.0, 2.1.1, 2.1.2 and on main).
--
-- ── ORDER: APPLY AFTER THE WEB DEPLOY ───────────────────────────────────────
--
-- The share page that shipped BEFORE this change keys its whole media block on the audio
-- URL: given NULL it renders an empty box instead of the cover art, next to a disabled
-- play button. The page that ships WITH this change never reads the URLs. So: Vercel
-- deploy first (it goes out on merge to main), then this migration. Production's body
-- was checked on 2026-10-10 and matches 20260922000000 exactly, so this replaces nothing
-- the repo does not know about.
--
-- ── BEFORE → AFTER ──────────────────────────────────────────────────────────
--
-- @riya shares "Neon Rain" (audio, 3:34). A stranger with no Livil account calls
-- `shared_post_public('<that post id>')` with the public anon key:
--
--                       | Before                                | After
--   --------------------|---------------------------------------|-------------------
--   track_title         | Neon Rain                             | Neon Rain
--   author / badges     | Riya, @riya, First 100                | unchanged
--   cover / thumbnail   | https://…/cover.jpg                   | unchanged
--   duration, clip      | 214, null, null                       | unchanged
--   likes / comments    | 42 / 7                                | unchanged
--   track_audio_url     | https://…/tracks-media/…/audio.mp3    | NULL
--   track_video_url     | NULL (video posts: https://…/v.mp4)   | NULL
--
-- No data is written or changed: this only alters what one read function returns.
-- Signed-in users are unaffected — the app reads tracks through its own RLS-checked
-- queries and never calls this function. The web creator dashboard does not call it
-- either. Reversible by re-running the body from 20260922000000.
--
-- What this does NOT do: the files themselves stay in a public bucket, so a URL someone
-- already copied keeps working. This stops new ones being handed out; locking the bucket
-- is a separate, much larger change (every client streams from those public URLs).
-- ============================================================================

create or replace function public.shared_post_public(p_post_id uuid)
returns table (
  post_id                uuid,
  caption                text,
  created_at             timestamptz,
  likes_count            integer,
  comments_count         integer,
  clip_start_sec         numeric,
  clip_end_sec           numeric,
  author_username        text,
  author_display_name    text,
  author_avatar_url      text,
  author_badges          text[],
  track_title            text,
  track_media_kind       text,
  track_audio_url        text,
  track_video_url        text,
  track_cover_art_url    text,
  track_thumbnail_url    text,
  track_duration_seconds integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.caption,
    p.created_at,
    p.likes_count,
    p.comments_count,
    p.clip_start_sec,
    p.clip_end_sec,
    pr.username,
    pr.display_name,
    pr.avatar_url,
    -- Held badges only, in a stable order that is not the order they were awarded in.
    -- Empty array, never null, so the page has one shape to render. See 20260922000000.
    array(
      select pb.badge
        from public.profile_badges pb
       where pb.user_id = p.author_id
         and pb.revoked_at is null
       order by pb.badge
    ),
    t.title,
    t.media_kind,
    -- Withheld: listening needs an account. See the header.
    null::text,
    null::text,
    t.cover_art_url,
    t.thumbnail_url,
    t.duration_seconds
  from public.posts p
  join public.tracks   t  on t.id  = p.track_id
  join public.profiles pr on pr.id = p.author_id
  where p.id = p_post_id
    -- Uploads only. Enforced here, not in the client. See 20260901000000.
    and p.kind = 'upload';
$$;

comment on function public.shared_post_public(uuid) is
  'Public share page read. Returns one upload post''s display metadata by id, or zero '
  'rows for a repost, a deleted post or an unknown id. Includes the author''s held '
  'badge kinds (never the ordinal, never the award time). track_audio_url and '
  'track_video_url are always NULL: listening needs an account (20261022000000). '
  'Granted to anon: this is the anonymous read surface for posts and tracks. Columns '
  'are enumerated deliberately — see kb/architecture/post-sharing.md §5.';

-- `create or replace` keeps the existing grants; restated so this file says on its own
-- who may call it, rather than relying on what an earlier migration left behind.
revoke all    on function public.shared_post_public(uuid) from public;
grant execute on function public.shared_post_public(uuid) to anon, authenticated;
