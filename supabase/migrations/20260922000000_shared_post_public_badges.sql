-- ============================================================================
-- shared_post_public — carry the author's badges onto the public share page
-- ============================================================================
--
-- A Livil link shared to WhatsApp opens in the web player, not the app, and that page
-- renders the artist's name. Today it renders it bare: a First 100 founder is badged on
-- every surface inside the app and unbadged on the one page strangers actually see. The
-- badge is the whole point of the badge — it has to survive the share.
--
-- ── WHY THE EXISTING BADGE READER CANNOT BE USED HERE ───────────────────────
--
-- `badges_for_profiles` opens with `if auth.uid() is null then return; end if;` — it
-- returns nothing to an anonymous caller, on purpose. The share page IS an anonymous
-- caller (it calls this function with the anon key). So the badges must come back on
-- the row that is already being fetched, not from a second call that would return
-- zero rows.
--
-- ── WHAT IS WITHHELD, AND WHY ───────────────────────────────────────────────
--
--   * `ordinal`. Nobody may learn they were #2 or #99 — all hundred are the same
--     badge. The column is bookkeeping and is unreachable from every client; this
--     function does not change that.
--   * `awarded_at`. A timestamp is an ordinal with extra steps: sort the founders by
--     it and you have the award order the ordinal was hidden to protect.
--   * Revoked grants (`revoked_at is not null`). A revoked badge is not held.
--
-- `order by pb.badge` is not cosmetic. Without an ORDER BY, Postgres returns rows in
-- heap order, which for an append-only grant table IS award order — the exact leak
-- found in review on `badges_for_profiles`, where the correlation between heap
-- position and ordinal measured 1.0. Two rows per author makes the leak small, not
-- absent. Sorting by the badge name removes it for the same cost as not.
--
-- ── WHY DROP AND RECREATE ───────────────────────────────────────────────────
--
-- Adding a column to a `returns table (...)` changes the function's OUT parameters,
-- and `create or replace function` refuses that with `cannot change return type of
-- existing function`. Migration 20260920000000 learned this the expensive way: the
-- error aborted the file midway, leaving the database half-migrated and the function
-- broken until it was dropped by hand. So the drop is explicit and first.
--
-- DROPPING A FUNCTION DROPS ITS GRANTS. `grant execute ... to anon` below is not a
-- repetition of 20260901000000 — it is a requirement of the drop. Without it the share
-- page would return HTTP 404 from PostgREST for every link, worldwide, until noticed.
--
-- ── BEFORE → AFTER ──────────────────────────────────────────────────────────
--
-- @vvk holds First 100 and shares "Midnight Drive" to WhatsApp. A stranger with no
-- Livil account taps the link:
--
--                     | Before            | After
--   ------------------|-------------------|--------------------------------
--   Name on the page  | @vvk              | @vvk  ★ (gold seal)
--   Badge order shown | n/a               | First 100 before Verified
--   Ordinal visible   | no                | no  (still never leaves the DB)
--
-- Existing data is untouched: this reads `profile_badges`, it does not write to it.
-- The widening is that a signed-OUT visitor holding a post link can now see which
-- badges that post's author holds. Inside the app that is already visible to every
-- signed-in user on the author's profile; this extends it to the share page only, for
-- the one author of the one post whose uuid the visitor already has.
-- ============================================================================

drop function if exists public.shared_post_public(uuid);

create function public.shared_post_public(p_post_id uuid)
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
    -- Empty array, never null, so the page has one shape to render.
    array(
      select pb.badge
        from public.profile_badges pb
       where pb.user_id = p.author_id
         and pb.revoked_at is null
       order by pb.badge
    ),
    t.title,
    t.media_kind,
    t.audio_url,
    t.video_url,
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
  'badge kinds (never the ordinal, never the award time). Granted to anon: this is the '
  'entire anonymous read surface of the database. Columns are enumerated deliberately '
  '— see kb/architecture/post-sharing.md §5.';

-- Required because the DROP above removed the old function's privileges along with it.
-- Written out rather than relying on Supabase''s default grants, for the same reason
-- 20260806040000 gives: a default nobody chose is not a decision.
revoke all    on function public.shared_post_public(uuid) from public;
grant execute on function public.shared_post_public(uuid) to anon, authenticated;
