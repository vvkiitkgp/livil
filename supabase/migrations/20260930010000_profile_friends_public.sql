-- ============================================================================
-- profile_friends — anyone's friends list is public to signed-in users
-- ============================================================================
--
-- Product decision 2026-09-29: tapping "Friends" on ANY profile opens that
-- person's friends list, whether or not the viewer is their friend.
--
-- friendships_select admits only the two participants, so from a caller-rights
-- query a third party sees none of someone else's friendships. That also made
-- the profile's Friends pill quietly wrong: getFollowCounts counted friendships
-- under RLS, so another person's profile read 0 (or 1, if you were friends).
--
-- The RLS policy is deliberately NOT widened. friendships also holds PENDING
-- rows (who asked whom, and who has not answered) and 'blocked' status; a
-- policy loose enough to list accepted friends would expose those too. These
-- two DEFINER functions return accepted friendships only, and only the columns
-- a profile row already shows.
--
-- ── WHAT IS STILL WITHHELD ──────────────────────────────────────────────────
--
--   * A BLOCKED pair (viewer ↔ profile owner, either direction) gets nothing:
--     an empty list and a zero count. Same rule as profile_tab_counts.
--   * A friend who is blocked with the VIEWER (either direction) is left out of
--     the list and the count. profiles_select_authenticated already hides that
--     person's profile from the viewer; listing them through a third party's
--     friends would route around the block.
--   * WHEN two people became friends (accepted_at) — it orders the list only.
--   * anon cannot call either function.
--
-- The count is defined as the size of the list, so the pill and the screen can
-- never disagree.
--
-- Nothing is stored or rewritten. Forward-only and idempotent.
-- ============================================================================

create or replace function public.list_profile_friends(p_user_id uuid)
returns table (
  user_id       uuid,
  username      text,
  display_name  text,
  avatar_url    text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_user_id is null then
    return;
  end if;

  if public.is_blocked_between(me, p_user_id) then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.friendships f
    join public.profiles p
      on p.id = case when f.user_a_id = p_user_id then f.user_b_id else f.user_a_id end
    where f.status = 'accepted'
      and (f.user_a_id = p_user_id or f.user_b_id = p_user_id)
      and (p.id = me or not public.is_blocked_between(me, p.id))
    -- Newest friendships first; id breaks ties so the order is total. accepted_at
    -- orders the list but is not returned: when two people became friends is not
    -- part of what was made public.
    order by f.accepted_at desc nulls last, p.id;
end;
$$;

revoke all on function public.list_profile_friends(uuid) from public;
revoke execute on function public.list_profile_friends(uuid) from anon;
grant execute on function public.list_profile_friends(uuid) to authenticated;

comment on function public.list_profile_friends(uuid) is
  'Accepted friends of any profile, for any signed-in viewer. DEFINER because friendships_select admits only participants. Returns nothing for a blocked pair and omits friends blocked with the viewer. Pending/blocked friendship rows are never returned, nor is accepted_at.';

create or replace function public.profile_friend_count(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from public.list_profile_friends(p_user_id);
$$;

revoke all on function public.profile_friend_count(uuid) from public;
revoke execute on function public.profile_friend_count(uuid) from anon;
grant execute on function public.profile_friend_count(uuid) to authenticated;

comment on function public.profile_friend_count(uuid) is
  'Size of list_profile_friends(p_user_id) — defined that way so the profile pill and the friends list cannot disagree.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.list_profile_friends(uuid)', 'execute') then
    raise exception 'anon can execute list_profile_friends — revoke did not take';
  end if;
  if has_function_privilege('anon', 'public.profile_friend_count(uuid)', 'execute') then
    raise exception 'anon can execute profile_friend_count — revoke did not take';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.list_profile_friends(uuid)'::regprocedure) is not true then
    raise exception 'list_profile_friends must be SECURITY DEFINER — under caller rights friendships_select hides every row that is not the caller''s own';
  end if;
end $$;
