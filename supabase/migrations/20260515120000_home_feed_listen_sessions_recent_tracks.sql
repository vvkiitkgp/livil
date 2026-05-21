-- Home feed ranking + friend listening + library recent plays
--
-- NOTE: Bucket 3 (“trending”) still scans all posts today — acceptable early-on,
-- but at very large scale you’ll likely want a precomputed trending surface (MATVIEW,
-- nightly rollup column, or a dedicated ranking job feeding `posts.hot_score`).
-- Applied to project itmtmeobsclhyczidjct (Livil). Regenerate types after changes.

CREATE INDEX IF NOT EXISTS idx_posts_created_at_id_desc ON public.posts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON public.posts (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.listen_sessions (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  track_title text NOT NULL,
  artist_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.listen_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY listen_sessions_select_circle
  ON public.listen_sessions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_a_id = auth.uid() AND f.user_b_id = listen_sessions.user_id)
          OR (f.user_b_id = auth.uid() AND f.user_a_id = listen_sessions.user_id)
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.follows fo
      WHERE fo.follower_id = auth.uid()
        AND fo.following_id = listen_sessions.user_id
        AND fo.kind = 'star'
    )
  );

CREATE POLICY listen_sessions_upsert_own
  ON public.listen_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY listen_sessions_update_own
  ON public.listen_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.user_recent_tracks (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.tracks (id) ON DELETE CASCADE,
  played_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_user_recent_tracks_user_played
  ON public.user_recent_tracks (user_id, played_at DESC);

ALTER TABLE public.user_recent_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_recent_tracks_select_own
  ON public.user_recent_tracks
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_recent_tracks_insert_own
  ON public.user_recent_tracks
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_recent_tracks_update_own
  ON public.user_recent_tracks
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_recent_tracks_delete_own
  ON public.user_recent_tracks
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.fetch_home_feed(
  p_limit integer DEFAULT 15,
  p_cursor_bucket integer DEFAULT NULL,
  p_cursor_sort_key double precision DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  post_id uuid,
  feed_bucket integer,
  sort_key double precision,
  viewer_has_liked boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    ranked.post_id,
    ranked.feed_bucket,
    ranked.sort_key,
    COALESCE(pl.post_id IS NOT NULL, false) AS viewer_has_liked
  FROM (
    SELECT
      p.id AS post_id,
      fb.feed_bucket,
      CASE
        WHEN fb.feed_bucket IN (1, 2) THEN EXTRACT(EPOCH FROM p.created_at)::double precision
        ELSE (
          (p.likes_count::double precision * 2.0
            + p.reposts_count::double precision * 3.0
            + p.comments_count::double precision
            + p.views_count::double precision / 10.0)
          / POWER(
            GREATEST(EXTRACT(EPOCH FROM (timezone('utc', now()) - p.created_at)) / 3600.0, 0.0) + 2.0,
            1.3
          )
        )
      END AS sort_key
    FROM posts p
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM friendships f
            WHERE f.status = 'accepted'
              AND (
                (f.user_a_id = auth.uid() AND f.user_b_id = p.author_id)
                OR (f.user_b_id = auth.uid() AND f.user_a_id = p.author_id)
              )
          ) THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM follows fo
            WHERE fo.follower_id = auth.uid()
              AND fo.following_id = p.author_id
              AND fo.kind = 'star'
          ) THEN 2
          ELSE 3
        END AS feed_bucket
    ) fb
    WHERE auth.uid() IS NOT NULL
  ) ranked
  LEFT JOIN post_likes pl
    ON pl.post_id = ranked.post_id
   AND pl.user_id = auth.uid()
  WHERE
    p_cursor_bucket IS NULL
    OR (
      ranked.feed_bucket > p_cursor_bucket
      OR (ranked.feed_bucket = p_cursor_bucket AND ranked.sort_key < p_cursor_sort_key)
      OR (
        ranked.feed_bucket = p_cursor_bucket
        AND ranked.sort_key = p_cursor_sort_key
        AND ranked.post_id < p_cursor_id
      )
    )
  ORDER BY ranked.feed_bucket ASC, ranked.sort_key DESC, ranked.post_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_friend_listen_stories()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  track_title text,
  artist_name text,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    ls.track_title,
    ls.artist_name,
    ls.updated_at
  FROM listen_sessions ls
  JOIN profiles p ON p.id = ls.user_id
  WHERE auth.uid() IS NOT NULL
    AND ls.user_id <> auth.uid()
    AND (
      EXISTS (
        SELECT 1
        FROM friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.user_a_id = auth.uid() AND f.user_b_id = ls.user_id)
            OR (f.user_b_id = auth.uid() AND f.user_a_id = ls.user_id)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM follows fo
        WHERE fo.follower_id = auth.uid()
          AND fo.following_id = ls.user_id
          AND fo.kind = 'star'
      )
    )
  ORDER BY ls.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_friend_listen_stories() TO authenticated;
