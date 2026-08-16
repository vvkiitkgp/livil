-- ============================================================================
-- Home feed: one score, instead of three walls
-- ============================================================================
--
-- PROP-0010 phase 3.
--
-- THE DEFECT. Bucketing was strict: EVERY friend post outranked EVERY starred-artist
-- post, which outranked all trending. One friend on an upload spree owned the entire
-- feed, and a stranger's genuinely excellent post could not reach the viewer until
-- their whole circle had been exhausted. Rank order was decided before quality,
-- recency or engagement were consulted at all.
--
-- THE CHANGE. Affinity becomes a TERM in an additive score rather than a partition:
--
--   score =  2.5 · affinity      friend 1.0 · starred 0.7 · played-before 0.4 · else 0
--          + 1.0 · engagement    ln(1 + weighted counts) / 6
--          + 1.5 · freshness     exp(-age / τ),  τ = 36h with affinity, 12h without
--          + 0.4 · discovery     an author the viewer has never played
--          - 2.0 · seen          min(impressions, 4) / 4
--          -       diversity     per-author and per-track rank penalties
--          + 0.15· jitter        the session nudge (phase 2)
--
-- WHAT THIS VISIBLY CHANGES, and it is worth being plain about it: a friend's
-- week-old post can now be outranked by a stranger's fresh, strongly-engaged one.
-- 2.5·1.0 + 1.5·exp(-168/36) = 2.51 against 1.0·1.0 + 1.5·1.0 = 2.50. That is the
-- point of the change, not a side effect of it — but it is the first time this feed
-- has ever put a stranger above a friend, and if it turns out to be wrong the lever
-- is the 2.5, in one place.
--
-- ── The cursor, and why feed_bucket survives ────────────────────────────────
--
-- The obvious move is to drop `feed_bucket` and page on (score, post_id). It would
-- BREAK EVERY INSTALLED APP: the client reads `feed_bucket` off the last row to
-- build its cursor, and a missing column yields `p_cursor_bucket => null`, which
-- this function reads as "no cursor" — so page 2 would be page 1, forever, for
-- anyone who has not updated. A feed that silently never advances is a worse defect
-- than the one being fixed.
--
-- So the column stays, and it stays the LEADING sort key — but it now carries one
-- distinction instead of four: 1 = ranked normally, 4 = seen enough (phase 1's
-- suppression). Affinity has moved into the score; suppression has not, and should
-- not, because a demotion expressed as "subtract a big number" needs that number to
-- exceed the whole score range, and every future term added to the score is another
-- chance for that arithmetic to quietly stop holding. A separate leading key cannot
-- drift. The cursor shape, the return shape and the client are all unchanged.
--
-- ── The discovery slot is a BONUS, not a slot ───────────────────────────────
--
-- PROP-0010 asked for "at least 1-2 cards per page from an author you have never
-- played". That cannot be expressed here, for the same reason a hard per-author cap
-- could not in phase 2: a reserved slot is a property of the PAGE, and under keyset
-- pagination the page is exactly what has not been decided when the score is
-- computed. Reserving one would require ranking the whole feed per request, which is
-- the cost model this function was consolidated to escape.
--
-- What is expressible is a bonus, and it turns out to matter less than expected: the
-- additive model already lets a fresh, well-engaged stranger beat a stale friend
-- post, which is most of what the reserved slot was for. The 0.4 is a nudge on top,
-- and it is honest to record that it is a nudge.
-- ============================================================================

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
  -- Resolved once, so every row of every page of this session is scored against the
  -- same instant. Clamped because it is client-supplied (phase 2).
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
  -- Authors the viewer has actually listened to or liked before. This is the term
  -- that was missing entirely: the old ranking knew who you had FOLLOWED and nothing
  -- about who you had LISTENED TO, which on a music app is the stronger signal and
  -- the one people give without thinking about it.
  --
  -- Reads the viewer's own rows only. `post_views` became own-row readable in
  -- 20260816000000; without that policy this CTE returns empty under SECURITY
  -- INVOKER and the term silently disappears.
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
  -- The viewer's own impression rows, and whether each has crossed the suppression
  -- threshold. Scoped to the viewer FIRST so the engagement probes run over a handful
  -- of rows rather than once per post in the table.
  seen AS (
    SELECT
      pi.post_id,
      pi.seen_count,
      (
        pi.seen_count >= 3
        AND pi.last_seen_at > now() - interval '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM public.post_likes pl
          WHERE pl.post_id = pi.post_id AND pl.user_id = m.uid
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.post_views pv
          WHERE pv.post_id = pi.post_id AND pv.user_id = m.uid
        )
      ) AS seen_enough
    FROM public.post_impressions pi
    CROSS JOIN me m
    WHERE pi.user_id = m.uid
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
        -- Half-life is longer for people the viewer has a relationship with: a
        -- friend's upload should survive a day and a half of not opening the app,
        -- a stranger's trending post should not.
        --
        -- The exponent is clamped because Postgres exp() RAISES on underflow past
        -- about -709 rather than returning zero — unclamped, the whole query starts
        -- erroring for every viewer once any visible post is about a year old.
        + 1.5 * exp(-LEAST(b.age_hours / CASE WHEN b.affinity > 0 THEN 36.0 ELSE 12.0 END, 700.0))
        + 0.4 * b.discovery
        -- Graded, and applied even to posts engagement exempts from suppression:
        -- having played something is a reason not to BANISH it, not a reason to keep
        -- putting it back at the top.
        - 2.0 * b.seen_fraction
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
        -- GREATEST, not a sum. Summing would let someone who is both a friend and a
        -- starred artist outrank every other friend for a reason nobody chose.
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
        COALESCE(sn.seen_enough, false) AS seen_enough
      FROM public.posts p
      CROSS JOIN session s
      LEFT JOIN seen sn ON sn.post_id = p.id
      WHERE (SELECT uid FROM me) IS NOT NULL
    ) b
  ),
  diversified AS (
    SELECT
      d.post_id,
      -- 1 = ranked, 4 = seen enough. See the header for why this stays the leading
      -- sort key rather than folding into the score as a large negative constant.
      CASE WHEN d.seen_enough THEN 4 ELSE 1 END AS feed_bucket,
      (
        d.base_score
        -- Rescaled from phase 2 alongside the score: the spread these compete against
        -- is now roughly three times wider, so the same nudge in absolute terms would
        -- have been a third of the nudge in practice. 0.25 is about seven hours of
        -- apparent age for a post from someone the viewer follows.
        - LEAST(d.author_rank - 1, 5)::double precision * 0.25
        -- Heavier: two songs by one artist are two things to listen to, the same
        -- track arriving five times through a repost chain is one.
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
