-- ─────────────────────────────────────────────────────────────────────────────
-- Home feed: single-call, precomputed-set ranking
--
-- Supersedes the fetch_home_feed defined in
-- 20260515120000_home_feed_listen_sessions_recent_tracks.sql.
--
-- WHY: the previous version returned only post IDs and (a) ran two correlated
-- EXISTS subqueries PER post (friendship + star-follow) to bucket every row, and
-- (b) forced the client to make 2–3 more sequential round-trips to hydrate the
-- rows (posts select + reposts' original authors). Measured cold AND warm at
-- ~3.2–3.6s of feed-skeleton time (rpc ~1.9s + hydrate ~1.5s + originals ~0.4s),
-- none of it images.
--
-- THIS VERSION:
--   1. Precomputes the viewer's friend-author and star-author SETS once (CTEs),
--      so bucketing is a hash-membership test instead of 2×N subqueries.
--   2. Returns the FULLY-HYDRATED post as jsonb (track + author + original author
--      + viewer_has_liked), so the feed needs ONE round-trip. The client no
--      longer hydrates, resolves originals, or fetches post_likes separately.
--
-- Kept identical on purpose: bucket order (friend=1, star=2, trending=3), the
-- time-decayed trending sort_key, keyset cursor semantics, the LIMIT clamp, and
-- SECURITY INVOKER (so posts/tracks/profiles RLS still gates visibility exactly
-- as the old per-table client queries did).
--
-- NOTE: bucket 3 (trending) still scans all posts to score them — the same
-- known limitation as before; a precomputed hot_score / trending rollup remains
-- the eventual scale fix. Regenerate Supabase types after applying (the RPC
-- return shape changed).
-- Applied to project itmtmeobsclhyczidjct (Livil).
-- ─────────────────────────────────────────────────────────────────────────────

-- Support the precomputed-set lookups (replaces the per-post EXISTS probes).
CREATE INDEX IF NOT EXISTS idx_friendships_user_a_status
  ON public.friendships (user_a_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_user_b_status
  ON public.friendships (user_b_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_follower_kind
  ON public.follows (follower_id, kind, following_id);

-- Return type changes (IDs → hydrated jsonb), so the old function must be dropped.
DROP FUNCTION IF EXISTS public.fetch_home_feed(integer, integer, double precision, uuid);

CREATE FUNCTION public.fetch_home_feed(
  p_limit integer DEFAULT 15,
  p_cursor_bucket integer DEFAULT NULL,
  p_cursor_sort_key double precision DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  feed_bucket integer,
  sort_key double precision,
  post_id uuid,
  post jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  -- The viewer's accepted friends → their author ids (bucket 1).
  friend_authors AS (
    SELECT CASE WHEN f.user_a_id = m.uid THEN f.user_b_id ELSE f.user_a_id END AS author_id
    FROM public.friendships f
    CROSS JOIN me m
    WHERE f.status = 'accepted'
      AND (f.user_a_id = m.uid OR f.user_b_id = m.uid)
  ),
  -- The viewer's starred follows → their author ids (bucket 2).
  star_authors AS (
    SELECT fo.following_id AS author_id
    FROM public.follows fo
    CROSS JOIN me m
    WHERE fo.follower_id = m.uid
      AND fo.kind = 'star'
  ),
  -- Score every visible post: bucket by set membership, then time-decayed sort.
  scored AS (
    SELECT
      b.post_id,
      b.feed_bucket,
      CASE
        WHEN b.feed_bucket IN (1, 2)
          THEN EXTRACT(EPOCH FROM b.created_at)::double precision
        ELSE (
          (b.likes_count::double precision * 2.0
            + b.reposts_count::double precision * 3.0
            + b.comments_count::double precision
            + b.views_count::double precision / 10.0)
          / POWER(
            GREATEST(EXTRACT(EPOCH FROM (timezone('utc', now()) - b.created_at)) / 3600.0, 0.0) + 2.0,
            1.3
          )
        )
      END AS sort_key
    FROM (
      SELECT
        p.id AS post_id,
        p.created_at,
        p.likes_count,
        p.reposts_count,
        p.comments_count,
        p.views_count,
        CASE
          WHEN p.author_id IN (SELECT author_id FROM friend_authors) THEN 1
          WHEN p.author_id IN (SELECT author_id FROM star_authors) THEN 2
          ELSE 3
        END AS feed_bucket
      FROM public.posts p
      WHERE (SELECT uid FROM me) IS NOT NULL
    ) b
  ),
  -- Apply the keyset cursor + ordering + limit BEFORE hydrating, so the jsonb
  -- build and joins below run for only the page's rows.
  page AS (
    SELECT s.post_id, s.feed_bucket, s.sort_key
    FROM scored s
    WHERE
      p_cursor_bucket IS NULL
      OR (
        s.feed_bucket > p_cursor_bucket
        OR (s.feed_bucket = p_cursor_bucket AND s.sort_key < p_cursor_sort_key)
        OR (
          s.feed_bucket = p_cursor_bucket
          AND s.sort_key = p_cursor_sort_key
          AND s.post_id < p_cursor_id
        )
      )
    ORDER BY s.feed_bucket ASC, s.sort_key DESC, s.post_id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50)
  )
  SELECT
    pg.feed_bucket,
    pg.sort_key,
    pg.post_id,
    jsonb_build_object(
      'id', p.id,
      'kind', p.kind,
      'caption', p.caption,
      'created_at', p.created_at,
      'views_count', p.views_count,
      'likes_count', p.likes_count,
      'reposts_count', p.reposts_count,
      'comments_count', p.comments_count,
      'author_id', p.author_id,
      'original_post_id', p.original_post_id,
      'clip_start_sec', p.clip_start_sec,
      'clip_end_sec', p.clip_end_sec,
      'track', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'media_kind', t.media_kind,
        'audio_url', t.audio_url,
        'video_url', t.video_url,
        'cover_art_url', t.cover_art_url,
        'thumbnail_url', t.thumbnail_url,
        'duration_seconds', t.duration_seconds
      ) END,
      'author', jsonb_build_object(
        'id', a.id,
        'username', a.username,
        'display_name', a.display_name,
        'avatar_url', a.avatar_url
      ),
      'original_author', orig.author,
      'viewer_has_liked', (pl.post_id IS NOT NULL)
    ) AS post
  FROM page pg
  JOIN public.posts p ON p.id = pg.post_id
  JOIN public.profiles a ON a.id = p.author_id
  LEFT JOIN public.tracks t ON t.id = p.track_id
  -- Resolve the original uploader for reposts (NULL for uploads, or if the
  -- original is gone / RLS-hidden — matching the old client behaviour).
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'id', oa.id,
      'username', oa.username,
      'display_name', oa.display_name,
      'avatar_url', oa.avatar_url
    ) AS author
    FROM public.posts op
    JOIN public.profiles oa ON oa.id = op.author_id
    WHERE op.id = p.original_post_id
  ) orig ON true
  LEFT JOIN public.post_likes pl
    ON pl.post_id = p.id AND pl.user_id = (SELECT uid FROM me)
  ORDER BY pg.feed_bucket ASC, pg.sort_key DESC, pg.post_id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid) TO authenticated;
