-- fetch_home_feed: a post you have seen fades, whether or not you liked or played it
--
-- Redefines the ranker from 20260816030000_home_feed_candidates.sql. Signature,
-- return shape, cursor semantics, grants and every other term are unchanged; this
-- is a behaviour change only, so every shipped app keeps working and simply gets
-- a fresher order. Two changes, both in how already-seen posts are scored:
--
-- 1. ENGAGEMENT NO LONGER EXEMPTS FROM BUCKET 4. A post shown on 3+ separate
--    occasions in the last week used to be demoted only if the viewer had never
--    played or liked it. Product decision (2026-10-07): the feed should feel fresh,
--    and a liked track is already in the viewer's playlist, so seen means seen.
--    Observed on a real account: a post seen on 19 occasions — played and liked —
--    kept opening the feed.
--
-- 2. THE SEEN PENALTY KEEPS GROWING. `seen_fraction` caps at 4 sightings (-2.0),
--    so in a small feed where everything has been seen 4+ times, every post carried
--    the same penalty and nothing ranked as fresher. `seen_beyond` adds up to -1.0
--    more on a log scale from 4 to 20 sightings. Posts seen 4 or fewer times score
--    exactly as before.
--
-- Still DEMOTION, never exclusion (see 20260816000000): bucket 4 sorts last but is
-- never empty-filtered, so an active viewer cannot be served an empty feed.
-- `affinity_authors` still reads plays and likes — liking someone's post still
-- raises that AUTHOR's other posts; it just no longer shields the post itself.
--
-- Reversible: re-running the function definition from 20260816030000 restores the
-- old behaviour exactly. No data is written or changed.

CREATE OR REPLACE FUNCTION public.fetch_home_feed(
  p_limit integer DEFAULT 15,
  p_cursor_bucket integer DEFAULT NULL,
  p_cursor_sort_key double precision DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_seed bigint DEFAULT 0,
  p_session_started_at timestamptz DEFAULT NULL
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
  session AS (
    SELECT
      GREATEST(
        LEAST(
          COALESCE(p_session_started_at, now()),
          now()
        ),
        now() - interval '1 hour'
      ) AS origin,
      COALESCE(p_seed, 0) AS seed
  ),
  friend_authors AS (
    SELECT CASE WHEN f.user_a_id = m.uid THEN f.user_b_id ELSE f.user_a_id END AS author_id
    FROM public.friendships f
    CROSS JOIN me m
    WHERE f.status = 'accepted'
      AND (f.user_a_id = m.uid OR f.user_b_id = m.uid)
  ),
  star_authors AS (
    SELECT fo.following_id AS author_id
    FROM public.follows fo
    CROSS JOIN me m
    WHERE fo.follower_id = m.uid
      AND fo.kind = 'star'
  ),
  affinity_authors AS (
    SELECT p.author_id
    FROM public.post_views pv
    JOIN public.posts p ON p.id = pv.post_id
    CROSS JOIN me m
    WHERE pv.user_id = m.uid
    UNION
    SELECT p.author_id
    FROM public.post_likes pl
    JOIN public.posts p ON p.id = pl.post_id
    CROSS JOIN me m
    WHERE pl.user_id = m.uid
  ),
  seen AS (
    SELECT
      pi.post_id,
      pi.seen_count,
      -- Shown on 3+ separate occasions in the last week. Engagement no longer
      -- exempts (20261009000000): a liked track is in the viewer's playlist, and
      -- the feed's job is what they have NOT seen.
      (
        pi.seen_count >= 3
        AND pi.last_seen_at > now() - interval '7 days'
      ) AS seen_enough
    FROM public.post_impressions pi
    CROSS JOIN me m
    WHERE pi.user_id = m.uid
  ),
  -- RETRIEVE. Every branch is index-servable and bounded, and every time window is
  -- pinned to the session origin so the pool does not shift under a scroll. RLS
  -- still applies (SECURITY INVOKER), so an invisible post is never a candidate.
  candidates AS (
    -- 1a. People the viewer knows.
    SELECT p.id
    FROM public.posts p
    CROSS JOIN session s
    WHERE p.author_id IN (
            SELECT author_id FROM friend_authors
            UNION SELECT author_id FROM star_authors)
      AND p.created_at > s.origin - interval '30 days'
      AND p.created_at <= s.origin
    UNION
    -- 1b. The viewer's own posts. Not covered by the graph above — nobody is their
    --     own friend — and a creator not seeing their own upload would read as the
    --     upload having failed.
    SELECT p.id
    FROM public.posts p
    CROSS JOIN session s
    CROSS JOIN me m
    WHERE p.author_id = m.uid
      AND p.created_at > s.origin - interval '30 days'
      AND p.created_at <= s.origin
    UNION
    -- 2. Whatever is doing well anywhere. The one time-varying branch; see header.
    (SELECT p.id
     FROM public.posts p
     CROSS JOIN session s
     WHERE p.hot_score > 0
       AND p.created_at <= s.origin
     ORDER BY p.hot_score DESC
     LIMIT 200)
    UNION
    -- 3. The newest posts regardless of score, so an upload from a minute ago is
    --    reachable before any rollup has seen it — and so a stalled refresh job
    --    costs reach rather than correctness.
    (SELECT p.id
     FROM public.posts p
     CROSS JOIN session s
     WHERE p.created_at <= s.origin
     ORDER BY p.created_at DESC
     LIMIT 100)
    UNION
    -- 4. Anything already shown to this viewer recently, so a suppressed post is
    --    still DEMOTED rather than absent. Bounded to the suppression window: past
    --    seven days the demotion has expired anyway and the post competes normally
    --    through the branches above.
    SELECT sn.post_id
    FROM seen sn
    CROSS JOIN session s
    WHERE EXISTS (
      SELECT 1 FROM public.post_impressions pi
      CROSS JOIN me m
      WHERE pi.post_id = sn.post_id
        AND pi.user_id = m.uid
        AND pi.last_seen_at > s.origin - interval '7 days'
    )
  ),
  base AS (
    SELECT
      b.post_id,
      b.author_id,
      COALESCE(b.track_id, b.post_id) AS group_key,
      b.seen_enough,
      (
          2.5 * b.affinity
        + 1.0 * (ln(1.0 + b.engagement) / 6.0)
        + 1.5 * exp(-LEAST(b.age_hours / CASE WHEN b.affinity > 0 THEN 36.0 ELSE 12.0 END, 700.0))
        + 0.4 * b.discovery
        - 2.0 * b.seen_fraction
        - 1.0 * b.seen_beyond
      ) AS base_score
    FROM (
      SELECT
        p.id AS post_id,
        p.author_id,
        p.track_id,
        GREATEST(
          EXTRACT(EPOCH FROM (s.origin - p.created_at)) / 3600.0,
          0.0
        )::double precision AS age_hours,
        (p.likes_count::double precision * 2.0
          + p.reposts_count::double precision * 3.0
          + p.comments_count::double precision
          + p.views_count::double precision / 10.0) AS engagement,
        GREATEST(
          CASE WHEN p.author_id IN (SELECT author_id FROM friend_authors)   THEN 1.0 ELSE 0.0 END,
          CASE WHEN p.author_id IN (SELECT author_id FROM star_authors)     THEN 0.7 ELSE 0.0 END,
          CASE WHEN p.author_id IN (SELECT author_id FROM affinity_authors) THEN 0.4 ELSE 0.0 END
        )::double precision AS affinity,
        CASE
          WHEN p.author_id IN (SELECT author_id FROM friend_authors)   THEN 0.0
          WHEN p.author_id IN (SELECT author_id FROM star_authors)     THEN 0.0
          WHEN p.author_id IN (SELECT author_id FROM affinity_authors) THEN 0.0
          ELSE 1.0
        END::double precision AS discovery,
        LEAST(COALESCE(sn.seen_count, 0), 4)::double precision / 4.0 AS seen_fraction,
        -- Keeps growing past 4 sightings (0 at 4, ~0.5 at 8, 1.0 at 20+), so a
        -- post seen 19 times ranks below one seen 4 times. The first 4 sightings
        -- are scored exactly as before.
        LEAST(
          ln(1.0 + GREATEST(COALESCE(sn.seen_count, 0) - 4, 0)) / ln(17.0),
          1.0
        )::double precision AS seen_beyond,
        COALESCE(sn.seen_enough, false) AS seen_enough
      -- The only structural change in this function: the ranker now reads the
      -- candidate pool instead of the whole table.
      FROM candidates c
      JOIN public.posts p ON p.id = c.id
      CROSS JOIN session s
      LEFT JOIN seen sn ON sn.post_id = p.id
      WHERE (SELECT uid FROM me) IS NOT NULL
    ) b
  ),
  diversified AS (
    SELECT
      d.post_id,
      CASE WHEN d.seen_enough THEN 4 ELSE 1 END AS feed_bucket,
      (
        d.base_score
        - LEAST(d.author_rank - 1, 5)::double precision * 0.25
        - LEAST(d.group_rank - 1, 3)::double precision * 1.0
        + CASE WHEN d.seed = 0 THEN 0.0 ELSE
            0.15 * (
              hashtextextended(d.post_id::text, d.seed)::double precision
              / 9223372036854775807.0
            )
          END
      ) AS sort_key
    FROM (
      SELECT
        base.*,
        s.seed,
        row_number() OVER (PARTITION BY base.author_id ORDER BY base.base_score DESC, base.post_id DESC) AS author_rank,
        row_number() OVER (PARTITION BY base.group_key ORDER BY base.base_score DESC, base.post_id DESC) AS group_rank
      FROM base
      CROSS JOIN session s
    ) d
  ),
  page AS (
    SELECT s.post_id, s.feed_bucket, s.sort_key
    FROM diversified s
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

REVOKE ALL ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz) FROM public;
REVOKE EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz) TO authenticated;
