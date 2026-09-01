-- ============================================================================
-- shared_post_public — the ONLY thing an anonymous visitor may read
-- ============================================================================
--
-- Sharing a post to WhatsApp or an Instagram Story puts a livil-music.com link in
-- front of people who have no Livil account and may never get one. That page has to
-- render the artwork, the title, the artist and a playable file. Today it cannot:
--
--   create policy "posts_select_authenticated" on public.posts
--     for select to authenticated using (true);
--
-- `to authenticated`, so `anon` reads nothing. THAT POLICY IS NOT CHANGED HERE, and
-- the reason is worth stating plainly. Adding `anon` to it is a one-line migration
-- that would work this afternoon and could never be un-shipped: the predicate is a
-- blanket `using (true)`, so the same edit that publishes one shared upload also
-- publishes every repost, every caption and every counter in the table to an
-- unauthenticated `select *`. Nobody would be able to tell scraping from traffic.
--
-- Instead the public surface is ONE function with an enumerated column list. Same
-- shape as profile_tab_counts and activity_record_play; the shape the anon-grant
-- sweep in 20260806040000 was written to keep reviewable.
--
-- ── WHAT IS DELIBERATELY WITHHELD ───────────────────────────────────────────
--
--   * REPOSTS. `kind = 'upload'` is in the WHERE clause, not merely in the app's
--     share menu. A repost is somebody else's share already, and re-sharing one
--     publicly would put a second person's clip choice on a public URL under the
--     original artist's name. The mobile client also hides the Share button on
--     reposts, but a hidden button is not an access control.
--
--   * views_count. Likes and comments are social proof a stranger should see. Play
--     count is business intelligence about a working artist, and handing it to
--     anyone holding a link is a different decision from letting them listen.
--
--   * waveform_peaks, lyrics, comment bodies, collaborator rows, and every
--     viewer-relative field. None of it is rendered by the share page.
--
-- COLUMNS ARE ENUMERATED, NEVER `select *`. This return type is a published API
-- contract with the entire internet. The day someone adds a private column to
-- `posts` or `tracks`, `select *` would publish it silently; an enumerated list
-- makes that change a no-op instead of an incident.
--
-- ── WHAT THIS DOES *NOT* WIDEN ──────────────────────────────────────────────
--
-- The media bytes were already public. Both storage buckets are `public`, and
-- public byte reads bypass RLS entirely — 20260804010000 records the probe: an
-- unauthenticated GET with no apikey returned HTTP 200 and 150905 bytes. So the
-- audio and video URLs this function returns were fetchable by anyone who already
-- had them. What changes is that the *metadata* to make sense of one of them is now
-- reachable by post id.
--
-- The real widening, stated so it is not discovered later: an upload was previously
-- readable by any authenticated Livil account; it is now readable by anyone holding
-- its uuid. A uuid v4 is 122 bits, so the id is a capability rather than a guessable
-- handle — there is no listing endpoint and no way to walk the table. That is the
-- whole of the exposure, and it is the product being asked for.
--
-- ── NO RATE LIMIT, ON PURPOSE ───────────────────────────────────────────────
--
-- A per-caller limit needs a caller, and there is none: auth.uid() is null and
-- Postgres cannot see a trustworthy client IP behind PostgREST. The share page is
-- served through a Vercel function with s-maxage=300, so a link doing well hits this
-- function about twelve times an hour no matter how many people open it. The
-- resource actually worth protecting is Storage egress, and that is guarded on the
-- page (preload="none", tap to play), not here.
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
    -- Uploads only. Enforced here, not in the client. See the header.
    and p.kind = 'upload';
$$;

comment on function public.shared_post_public(uuid) is
  'Public share page read. Returns one upload post''s display metadata by id, or zero '
  'rows for a repost, a deleted post or an unknown id. Granted to anon: this is the '
  'entire anonymous read surface of the database. Columns are enumerated deliberately '
  '— see kb/architecture/post-sharing.md §5.';

-- Supabase''s default privileges issue a DIRECT grant to `anon` and `authenticated` on
-- every new function in `public`, and a direct grant survives `revoke ... from public`
-- (the lesson of 20260806040000). Both statements are written out so the grant is a
-- decision on the page rather than a default nobody chose.
revoke all    on function public.shared_post_public(uuid) from public;
grant execute on function public.shared_post_public(uuid) to anon, authenticated;
