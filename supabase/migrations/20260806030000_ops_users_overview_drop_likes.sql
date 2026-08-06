-- Drop `likes_received` from the roster.
--
-- It is not displayed, and computing it cost a join and a count per user for a number nothing
-- read. Restoring it is one subquery if it ever earns a column.
--
-- DROP THEN CREATE, NOT CREATE OR REPLACE. Changing a function's OUT parameters changes its
-- result type, and Postgres refuses to replace a set-returning function whose signature has
-- moved. The consequence worth knowing: DROP takes the grants with it, so the REVOKE/GRANT
-- block below is not decoration — omit it and the function silently reverts to Supabase's
-- default privileges, which include EXECUTE for anon.

DROP FUNCTION IF EXISTS public.ops_users_overview();

CREATE FUNCTION public.ops_users_overview()
RETURNS TABLE (
  id            uuid,
  display_name  text,
  username      text,
  email         text,
  created_at    timestamptz,
  last_seen_at  timestamptz,
  tracks_count  bigint,
  posts_count   bigint,
  stars_count   bigint,
  friends_count bigint
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
      -- Stars received. `follows_kind_check` permits only kind='star', so a star IS a follow.
      (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id),
      -- Friendship is symmetric and stored once, so both sides must be checked. Pending
      -- requests are excluded: a request nobody accepted is not a friend.
      (SELECT count(*) FROM public.friendships fr
        WHERE fr.status = 'accepted' AND (fr.user_a_id = p.id OR fr.user_b_id = p.id))
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL     ON FUNCTION public.ops_users_overview() FROM public;
REVOKE EXECUTE ON FUNCTION public.ops_users_overview() FROM anon;
GRANT  EXECUTE ON FUNCTION public.ops_users_overview() TO authenticated;

COMMENT ON FUNCTION public.ops_users_overview() IS
  'Ops-only roster: every profile with its email, join date and activity counts computed from source tables. Returns empty for a non-ops caller.';
