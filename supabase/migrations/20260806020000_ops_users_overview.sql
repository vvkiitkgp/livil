-- Who is actually on Livil, for /studio/ops.
--
-- SAME SHAPE AS ops_team_messages(): SECURITY DEFINER because the email lives in `auth.users`
-- which no client may read, gated on is_ops() in the body because definer rights bypass RLS,
-- and returning EMPTY rather than raising for a non-ops caller so /studio/ops keeps working
-- without a route guard.
--
-- "STARS" AND "FANS" ARE THE SAME THING. `follows_kind_check` permits exactly one value —
-- `kind = 'star'` — so a star IS the follow relationship under Livil's own vocabulary. One
-- column, not two; two would imply a distinction the schema does not make.
--
-- COUNTED FROM THE SOURCE TABLES, NOT FROM profiles.followers_count. That denormalised
-- counter is maintained by triggers and can drift: `posts.views_count` was found 196 above
-- the actual row count earlier in this project's life. An ops dashboard whose job is to tell
-- you the truth should not read a cache of it. At 50 profiles the subqueries are free; revisit
-- if this ever gets slow, and prefer a materialised view over trusting the counter.

CREATE OR REPLACE FUNCTION public.ops_users_overview()
RETURNS TABLE (
  id             uuid,
  display_name   text,
  username       text,
  email          text,
  created_at     timestamptz,
  last_seen_at   timestamptz,
  tracks_count   bigint,
  posts_count    bigint,
  stars_count    bigint,
  friends_count  bigint,
  likes_received bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_ops() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.display_name,
      p.username,
      u.email::text,
      p.created_at,
      p.last_seen_at,
      -- Songs uploaded: tracks, not posts. A repost creates a post but no track, so counting
      -- posts would credit an artist for someone else's work.
      (SELECT count(*) FROM public.tracks t  WHERE t.uploader_id = p.id),
      (SELECT count(*) FROM public.posts  po WHERE po.author_id  = p.id),
      -- Stars received, i.e. how many people follow them.
      (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id),
      -- Friendship is symmetric and stored once, so both sides must be checked. Pending
      -- requests are excluded: a request nobody accepted is not a friend.
      (SELECT count(*) FROM public.friendships fr
        WHERE fr.status = 'accepted' AND (fr.user_a_id = p.id OR fr.user_b_id = p.id)),
      (SELECT count(*) FROM public.post_likes pl
         JOIN public.posts p2 ON p2.id = pl.post_id
        WHERE p2.author_id = p.id)
    FROM public.profiles p
    -- LEFT JOIN: profiles cascades from auth.users so an orphan should be impossible, but an
    -- inner join would silently drop a user from the roster if one ever existed, and a roster
    -- that quietly omits people is worse than one showing a blank email.
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.created_at DESC;
END;
$$;

-- REVOKE ALL ... FROM public does NOT remove the direct grant Supabase's default privileges
-- give anon on every new public function. Both are needed; the second is the one that works.
REVOKE ALL     ON FUNCTION public.ops_users_overview() FROM public;
REVOKE EXECUTE ON FUNCTION public.ops_users_overview() FROM anon;
GRANT  EXECUTE ON FUNCTION public.ops_users_overview() TO authenticated;

COMMENT ON FUNCTION public.ops_users_overview() IS
  'Ops-only roster: every profile with its email, join date and activity counts computed from source tables. Returns empty for a non-ops caller.';
