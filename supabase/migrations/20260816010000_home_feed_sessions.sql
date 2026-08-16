-- ============================================================================
-- Home feed: a session, so refresh means something
-- ============================================================================
--
-- PROP-0010 phase 2. Phase 1 stopped the feed repeating itself; this is the half
-- that makes PULLING TO REFRESH visibly re-rank.
--
-- The defect: `fetch_home_feed` is a pure function of (viewer graph, posts table,
-- wall-clock hour). Two calls seconds apart return a byte-identical page, so
-- `handleRefresh` replaces the list with one equal to what is already on screen and
-- nothing appears to happen.
--
-- ── The session, and why it is not just "add randomness" ────────────────────
--
-- `ORDER BY random()` would fix the symptom and destroy pagination: a row can then
-- appear on every page, or on none. The ordering has to be STABLE while the viewer
-- scrolls and DIFFERENT the next time they pull down. That is a session.
--
-- The client mints `{ seed, startedAt }` on cold open and on every refresh, and
-- sends both with every page of that session:
--
--   · `p_seed` keys a deterministic per-post jitter. Same post, same seed, same
--     nudge — every page of the session agrees on the order.
--   · `p_session_started_at` FREEZES the decay origin. Today `now()` advances
--     between page 1 and page 3, so the scores the cursor was issued against are
--     not the scores the next page is compared to — rows can be skipped or
--     repeated. Freezing it is a pagination correctness fix that the refresh
--     behaviour happens to need anyway.
--
-- No session table, no cache tier: both values are parameters, so the function
-- stays a single stateless round-trip.
--
-- `p_session_started_at` IS UNTRUSTED. It arrives from a client that can send
-- anything, and it is the denominator of the decay. A far-past value flattens the
-- ranking to raw engagement; a far-future value makes `age` negative and the scores
-- explode. It is clamped to [now() - 1 hour, now()] — long enough for a genuinely
-- long scroll, short enough that the worst a caller can do is see a slightly staler
-- ordering than everyone else. The suppression window deliberately keeps using the
-- real now(), so no parameter can widen or narrow it.
--
-- ── Every bucket now scores on ONE scale, and this is load-bearing ───────────
--
-- Not in the proposal, and found while implementing it. Buckets 1 and 2 sorted on
-- `EXTRACT(EPOCH FROM created_at)` — around 1.7e9 — while buckets 3 and 4 sorted on
-- a decayed engagement ratio around 0.01–5. Both work, because ordering is
-- within-bucket and the two scales never meet.
--
-- A JITTER TERM MAKES THEM MEET. One amplitude cannot serve both: ±0.15 is
-- invisible against 1.7e9 (friends' posts would never re-order, so refresh would
-- still look dead for exactly the viewer whose feed is mostly friends) and ±15% of
-- an epoch is eight years. So recency becomes `exp(-age/τ)` in (0,1] — MONOTONIC IN
-- AGE, therefore the same reverse-chronological order as before, just rescaled —
-- and trending is divided to sit in the same range. One scale, one amplitude, and
-- the diversity penalties below are expressible in the same units.
--
-- ── Exponential decay replaces the power law ────────────────────────────────
--
-- `engagement / (age_hours + 2)^1.3` has a fat tail: a post with real engagement
-- stays competitive for weeks, which is the other half of why the same trending
-- posts kept coming back. `exp(-age/τ)` does not. τ = 36h for people the viewer
-- follows (a friend's upload should survive a day and a half of not opening the
-- app) and 12h for strangers.
--
-- ── Diversity is a PENALTY, not a cap ───────────────────────────────────────
--
-- "No more than 2 cards per author per page" cannot be expressed in a keyset-
-- paginated score: a hard cap depends on what else is on the page, and the page is
-- exactly what the cursor has not decided yet. A per-author rank penalty is a
-- property of the POST, so it composes with the cursor and stays stable across
-- pages. A prolific author's fifth post ranks as though it were a day older, rather
-- than being banished.
--
-- Signature changes (two new parameters), so the old function must be dropped
-- rather than replaced. Old app versions keep working: they send the original
-- arguments by name and the new ones take their defaults, which reproduce the
-- unseeded ordering.
-- ============================================================================

DROP FUNCTION IF EXISTS public.fetch_home_feed(integer, integer, double precision, uuid);

CREATE FUNCTION public.fetch_home_feed(
  p_limit integer DEFAULT 15,
  p_cursor_bucket integer DEFAULT NULL,
  p_cursor_sort_key double precision DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  -- Both default to the degenerate session — no jitter, origin = now — so a caller
  -- that does not know about sessions gets the old deterministic ordering rather
  -- than an error.
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
  -- Resolved ONCE, so every row of every page of this session is scored against the
  -- same instant. See the header for why the clamp is not optional.
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
  -- Shown at least 3 times, on separate occasions, in the last week, and never
  -- acted on (bucket 4). Introduced in 20260816000000; unchanged here.
  --
  -- Deliberately uses the real now(), NOT the session origin: the suppression
  -- window is a privacy-adjacent behavioural rule, and a client-supplied timestamp
  -- must not be able to shift it.
  suppressed AS (
    SELECT pi.post_id
    FROM public.post_impressions pi
    CROSS JOIN me m
    WHERE pi.user_id = m.uid
      AND pi.seen_count >= 3
      AND pi.last_seen_at > now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.post_likes pl
        WHERE pl.post_id = pi.post_id AND pl.user_id = m.uid
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.post_views pv
        WHERE pv.post_id = pi.post_id AND pv.user_id = m.uid
      )
  ),
  -- Bucket, and the score BEFORE diversity and jitter. Kept separate so the
  -- per-author ordering below ranks on merit rather than on the nudge.
  base AS (
    SELECT
      b.post_id,
      b.author_id,
      -- Reposts share their original's track, so this groups a track with every
      -- repost of it. Falls back to the post id for a post with no track, which
      -- then groups only with itself.
      COALESCE(b.track_id, b.post_id) AS group_key,
      b.feed_bucket,
      -- THE EXPONENT IS CLAMPED, and it is not decoration. Postgres `exp()` RAISES
      -- `value out of range: underflow` past about -709 rather than returning zero,
      -- so an unclamped `exp(-age/12)` starts throwing once any visible post is
      -- older than ~355 days — and it throws for the WHOLE query, meaning every
      -- viewer's feed 500s the day the catalogue gets old enough. Found by the
      -- mutation run on this migration, not by the app. At 700 the value is ~1e-304,
      -- which is zero for every purpose here.
      CASE
        WHEN b.feed_bucket IN (1, 2)
          -- Monotonic in age → identical ordering to the old epoch sort, on a scale
          -- the jitter and the penalties can actually reach. τ = 36h.
          THEN exp(-LEAST(b.age_hours / 36.0, 700.0))
        ELSE
          -- Log-damped so one viral post cannot outrank a viewer's whole circle,
          -- divided by 6 to land in roughly the same 0..1 range as the branch above
          -- (ln(1+E)=6 is E≈400 engagement points — a very strong post). τ = 12h.
          (ln(1.0 + b.engagement) / 6.0) * exp(-LEAST(b.age_hours / 12.0, 700.0))
      END AS base_score
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
        CASE
          WHEN p.id IN (SELECT post_id FROM suppressed) THEN 4
          WHEN p.author_id IN (SELECT author_id FROM friend_authors) THEN 1
          WHEN p.author_id IN (SELECT author_id FROM star_authors) THEN 2
          ELSE 3
        END AS feed_bucket
      FROM public.posts p
      CROSS JOIN session s
      WHERE (SELECT uid FROM me) IS NOT NULL
    ) b
  ),
  -- Diversity + the session nudge.
  --
  -- Both ranks are computed over the WHOLE candidate set rather than per page, which
  -- is what keeps them stable as the cursor advances — a post's penalty must not
  -- change depending on which page it lands on.
  diversified AS (
    SELECT
      d.post_id,
      d.feed_bucket,
      (
        d.base_score
        -- One author's run of uploads should interleave with everyone else's, not
        -- bury them. 0.12 per extra post ≈ four or five hours of apparent age each;
        -- capped so a back catalogue cannot push a score arbitrarily negative.
        - LEAST(d.author_rank - 1, 8)::double precision * 0.12
        -- The same track arriving five times through a repost chain is one thing to
        -- listen to. Heavier, because unlike two songs by one artist these are
        -- genuinely redundant.
        - LEAST(d.group_rank - 1, 4)::double precision * 0.35
        -- Deterministic in (post, seed): stable for every page of this session,
        -- different the next time the viewer pulls down. Small on purpose — it
        -- re-orders near-ties, it does not overrule recency or affinity.
        --
        -- hashtextextended is stable within a server, which is all this needs: a
        -- session never outlives the connection pool it was scored against.
        --
        -- Seed 0 means NO jitter rather than "jitter keyed on zero" — hashing zero
        -- would still shuffle. It is the parameter default, so a caller that knows
        -- nothing about sessions gets the previous ordering exactly, and the tests
        -- have a way to assert the underlying sort without the nudge on top.
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
  -- Apply the keyset cursor + ordering + limit BEFORE hydrating, so the jsonb
  -- build and joins below run for only the page's rows.
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

REVOKE ALL ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz) FROM public;
REVOKE EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid, bigint, timestamptz) TO authenticated;
