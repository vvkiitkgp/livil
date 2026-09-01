-- ============================================================================
-- Home feed: retrieve, then rank
-- ============================================================================
--
-- PROP-0010 phase 4. No behaviour change is intended here — this is the cost
-- model.
--
-- THE PROBLEM, recorded as a known limitation in both earlier feed migrations
-- (20260515120000:3-5 and 20260707000000:26-28): the ranker scores EVERY row in
-- `posts` on every page fetch. Phases 2 and 3 made that worse rather than better —
-- two window functions now sort the whole table, and phase 3 added a scan of the
-- viewer's own play history on top. Every scoring term is another multiple of a
-- full scan, so the design was getting more expensive exactly as it got better.
--
-- THE FIX is the standard two-stage shape: RETRIEVE a few hundred plausible posts
-- using indexes, then RANK only those. The ranking expression is copied across
-- unchanged, deliberately — this migration should be provable by the phase 1-3
-- tests continuing to pass, and anything it changed would show up there as a
-- failure rather than as an improvement.
--
-- ── Candidate generation, and what each branch is for ───────────────────────
--
--   1. everyone the viewer actually knows, plus themselves, last 30 days
--   2. the top 200 by `hot_score` — whatever is doing well anywhere
--   3. the newest 100 posts, unconditionally
--   4. anything the viewer has been shown in the last week
--
-- Branch 3 is not redundant with branch 2, and it is the branch that makes this
-- safe. `hot_score` is a ROLLUP: a post uploaded a minute ago has not been scored
-- yet, and if the refresh job is not running it will never be. Branch 3 means a
-- brand-new post is always reachable, and a completely stale `hot_score` degrades
-- the feed's reach rather than breaking it. Branch 4 keeps phase 1's "demoted, not
-- dropped" promise true — a suppressed post that is not a candidate is not demoted,
-- it is gone.
--
-- ── Time windows use the SESSION ORIGIN, not now() ──────────────────────────
--
-- Not cosmetic. Candidate generation is the one part of this query that can change
-- WHICH posts exist between page 1 and page 3 of the same scroll, and a post
-- entering or leaving the pool mid-session is a post silently skipped or repeated.
-- Pinning every window to the frozen origin (phase 2) removes that for branches 1,
-- 3 and 4 entirely: within one session they are deterministic sets.
--
-- WHAT REMAINS, stated rather than hidden: branch 2 reads `hot_score`, which the
-- refresh job rewrites every ten minutes, so a post can cross the top-200 boundary
-- mid-session. The exposure is the boundary only, the pool is ~400 against a client
-- that pages twelve at a time and rarely goes past sixty, and closing it properly
-- means storing the candidate set per session — server state, which this function
-- has stayed free of on purpose. Revisit if paging past ~200 becomes normal.
--
-- ── pg_cron is NOT installed by this migration ─────────────────────────────
--
-- VERIFIED, not assumed (ADR-0008 §97 asked for exactly this query to be run):
-- `pg_cron` 1.6.4 is AVAILABLE and NOT INSTALLED on the Mumbai project — checked
-- against fqzrmqnlgjeuxzinbqvs on 2026-08-16, matching the debt register note that
-- ADR-0009 §69 cites.
--
-- Enabling an extension is a project-level decision and this is a feed migration;
-- it schedules the job only if pg_cron is ALREADY installed, and otherwise prints
-- the two statements an operator needs. The alternative — `create extension` inside
-- this file — would install a scheduler as a side effect of a ranking change, which
-- is precisely the kind of thing ADR-0008 and ADR-0009 both declined to do.
--
-- If the job never runs, `hot_score` freezes at whatever the backfill below wrote.
-- That is a REACH regression, not an outage (branch 3), and it is observable rather
-- than silent: `hot_score_updated_at` carries the answer and belongs on /studio/ops
-- next to the other staleness numbers.
-- ============================================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS hot_score double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hot_score_updated_at timestamptz;

COMMENT ON COLUMN public.posts.hot_score IS
  'Rollup used ONLY to pick candidates for the home feed — never to rank them. '
  'Maintained by refresh_post_hot_scores(); zero for posts older than 30 days.';
COMMENT ON COLUMN public.posts.hot_score_updated_at IS
  'When hot_score was last recomputed. A stale value degrades feed reach, not '
  'correctness — surface the max age on /studio/ops rather than trusting the job.';

-- PARTIAL, because the only query is "the best few, right now" and posts past the
-- 30-day window are zeroed by the job below — so they leave the index rather than
-- sitting in it forever. Keeps the index proportional to what is actually live.
CREATE INDEX IF NOT EXISTS posts_hot_score_idx
  ON public.posts (hot_score DESC)
  WHERE hot_score > 0;

-- ── The rollup ──────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER, and that is the whole authorization design — RLS is the
-- perimeter (ADR-0004), so this needs no guard of its own:
--
--   · pg_cron runs it as the table owner, who is not subject to RLS, so the
--     scheduled refresh covers every post;
--   · a signed-in caller is held to `posts_update_own`, so the worst they can do is
--     recompute the correct value on their OWN posts — bounded by how much they have
--     uploaded, and idempotent;
--   · `anon` has no UPDATE policy at all and is revoked below as well.
--
-- The first draft was SECURITY DEFINER with `if auth.uid() is not null and not
-- is_ops() then return 0`. Security review called that out and was right: it is an
-- allow-list written as a deny-list, so it PERMITS every principal without a JWT and
-- the only thing standing between an unbounded table rewrite and the anon key — which
-- ships in the app — was a GRANT. Grants are not a control here: `ci.yml` re-runs
-- `grant execute on all functions ... to authenticated` after migrations, and a
-- future DROP+CREATE re-triggers Supabase's default grant to `anon`
-- (20260806040000). Inverting the guard to fail closed would then have locked out the
-- scheduler, since pg_cron has no JWT either and `is_ops()` is false for it.
--
-- Note the reviewer's proposed `current_user IN ('postgres','service_role')` guard
-- would have been WORSE than the original: inside a SECURITY DEFINER body
-- `current_user` is the function OWNER, so it is 'postgres' for every caller and the
-- guard is always true. Verified before rejecting it. Dropping DEFINER removes the
-- question entirely.
CREATE OR REPLACE FUNCTION public.refresh_post_hot_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
declare
  v_touched integer := 0;
  v_aged    integer := 0;
begin
  -- Same log-damped engagement and exponential decay the ranker uses, on a 24-hour
  -- constant: this only has to answer "is this worth LOOKING at", so it sits between
  -- the ranker's 36h for people you know and 12h for people you do not.
  --
  -- The exponent is clamped for the reason 20260816010000 records: Postgres exp()
  -- RAISES on underflow past about -709 rather than returning zero. Bounded here by
  -- the 30-day window too, but the clamp stays — the window is a product decision
  -- and someone will widen it.
  update public.posts p
     set hot_score = ln(
           1.0 + (p.likes_count * 2.0 + p.reposts_count * 3.0
                  + p.comments_count + p.views_count / 10.0)
         ) * exp(-LEAST(
             GREATEST(EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0, 0.0)
             / 24.0, 700.0)),
         hot_score_updated_at = now()
   where p.created_at > now() - interval '30 days';
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  -- Posts that have aged out stop being refreshed, so without this they would keep
  -- whatever score they had on their last day forever and hold their place in the
  -- index. Cheap: the partial index means this only ever visits rows still in it.
  update public.posts p
     set hot_score = 0,
         hot_score_updated_at = now()
   where p.hot_score > 0
     and p.created_at <= now() - interval '30 days';
  GET DIAGNOSTICS v_aged = ROW_COUNT;

  return v_touched + v_aged;
end;
$$;

REVOKE ALL ON FUNCTION public.refresh_post_hot_scores() FROM public;
-- By name, not only from PUBLIC: Supabase's default privileges hand `anon` a DIRECT
-- execute grant on every new function in `public`, and a direct grant survives a
-- revoke from the PUBLIC pseudo-role (20260806040000).
REVOKE EXECUTE ON FUNCTION public.refresh_post_hot_scores() FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_post_hot_scores() TO authenticated;

COMMENT ON FUNCTION public.refresh_post_hot_scores() IS
  'Recomputes posts.hot_score for the last 30 days and zeroes older rows. SECURITY '
  'INVOKER: the scheduler runs as owner and covers everything, a signed-in caller is '
  'held to their own posts by RLS. Feed CANDIDATE selection reads this; ranking never does.';

-- Populate it once, so the feed has candidates from the moment this migration lands
-- rather than from the first time a scheduler runs. auth.uid() is null here, so the
-- guard above lets it through.
SELECT public.refresh_post_hot_scores();

-- ── The schedule, if and only if the extension is already installed ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'refresh-post-hot-scores',
      '*/10 * * * *',
      'SELECT public.refresh_post_hot_scores()'
    );
    RAISE NOTICE 'pg_cron present — refresh-post-hot-scores scheduled every 10 minutes.';
  ELSE
    RAISE NOTICE 'pg_cron NOT installed: posts.hot_score will not refresh on its own.';
    RAISE NOTICE 'The feed still works (candidate branch 3 covers new posts), but its';
    RAISE NOTICE 'reach degrades as scores age. To enable, run as postgres:';
    RAISE NOTICE '  create extension pg_cron with schema pg_catalog;';
    RAISE NOTICE '  select cron.schedule(''refresh-post-hot-scores'', ''*/10 * * * *'',';
    RAISE NOTICE '                       ''select public.refresh_post_hot_scores()'');';
  END IF;
END $$;

-- ── The ranker, unchanged except for what it reads FROM ─────────────────────
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
