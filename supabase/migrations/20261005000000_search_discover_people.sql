-- ============================================================================
-- search_discover_people — suggested friends and artists on the empty Search tab
-- ============================================================================
--
-- Two short lists, both derived from the caller's own FRIENDS:
--
--   · 'friends' — people who are friends with your friends but not with you: friends of
--                 friends, ranked by how many mutual friends you share. Unverified only;
--                 verified accounts are artists and belong in the other list.
--   · 'artists' — verified accounts, ranked by how many of your friends STAR them (are their
--                 fans). Artists you already star are left out. Verified artists none of
--                 your friends star still fill the list after those, most fans first, so a
--                 new account with no friends yet sees popular artists instead of nothing.
--
-- `mutual_count` is the ranking number itself — mutual friends for 'friends', friends who
-- star them for 'artists' — so the row can say "2 mutual friends" / "3 friends are fans".
-- It is a COUNT only; who those friends are is never returned.
--
-- WHY THAT COUNT IS NOT NEW INFORMATION. Accepted friendships are public to any signed-in
-- viewer (list_profile_friends, 20260930010000) and so is who a person stars
-- (list_profile_stars, 20260930020000). Both counts are derivable today by opening each of
-- your friends' profiles; this computes them in one place. The owner-only list is FANS
-- (list_my_fans) — and this never lists anyone's fans: it counts, among YOUR friends only,
-- who stars an artist.
--
-- WHY DEFINER. Friendship rows are readable only by their participants
-- (friendships_select), so friends-of-friends cannot be computed under caller rights, and
-- `profile_badges` is deny-all. A DEFINER function bypasses the `profiles` SELECT policy
-- too, so it re-applies `is_blocked_between` itself, in both directions, exactly as that
-- policy does.
--
-- BLOCKS BETWEEN THIRD PARTIES need no filter here because `block_user` DELETES the pair's
-- friendship and stars, and every path that creates them refuses a blocked pair — so a
-- friend can never be blocked with me, nor count toward someone they are blocked with. If
-- blocking ever becomes a soft hide that leaves those rows in place, this function (and
-- list_profile_friends) must filter them explicitly.
--
-- NOT RETURNED: badge award time / ordinal (award order must stay unrecoverable — see
-- 20260919000000), join time, fan counts, or the identities behind `mutual_count`.
--
-- LEFT OUT OF BOTH: the caller; anyone blocked with the caller; accounts that have not
-- picked a username yet (`username_set = false` — a new Google sign-in mid-onboarding).
-- 'friends' also leaves out accepted friends. Pending requests stay in, so the Add button
-- on the row shows the real "requested" state.
--
-- The return shape changed during review (mutual_count added), and `create or replace`
-- cannot change a return type — hence the drop, harmless if it never existed.

drop function if exists public.search_discover_people(int);

create function public.search_discover_people(p_limit int default 5)
returns table (
  section       text,
  user_id       uuid,
  username      text,
  display_name  text,
  avatar_url    text,
  mutual_count  int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me  uuid := auth.uid();
  -- Clamped: this feeds a fixed-size screen section, and an unclamped limit would turn the
  -- function into a way to page through every account in one call.
  lim int  := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  if me is null then
    return;
  end if;

  return query
    with my_friends as (
      select case when f.user_a_id = me then f.user_b_id else f.user_a_id end as fid
        from public.friendships f
       where f.status = 'accepted'
         and (f.user_a_id = me or f.user_b_id = me)
    ),
    -- Each friend's own accepted friends, counted once per shared friend.
    friends_of_friends as (
      select case when f.user_a_id = mf.fid then f.user_b_id else f.user_a_id end as pid,
             count(distinct mf.fid)::int as n
        from my_friends mf
        join public.friendships f
          on f.status = 'accepted'
         and (f.user_a_id = mf.fid or f.user_b_id = mf.fid)
       group by 1
    ),
    starred_by_friends as (
      select fo.following_id as pid, count(distinct fo.follower_id)::int as n
        from public.follows fo
        join my_friends mf on mf.fid = fo.follower_id
       where fo.kind = 'star'
       group by 1
    ),
    verified as (
      select pb.user_id as pid
        from public.profile_badges pb
       where pb.badge = 'verified'
         and pb.revoked_at is null
         and pb.user_id is not null
    )
    (
      select 'friends'::text, p.id, p.username, p.display_name, p.avatar_url, fof.n
        from friends_of_friends fof
        join public.profiles p on p.id = fof.pid
       where p.id <> me
         and p.username_set
         and not exists (select 1 from my_friends mf where mf.fid = p.id)
         and not exists (select 1 from verified v where v.pid = p.id)
         and not public.is_blocked_between(me, p.id)
       -- id breaks ties so the order is total and stable between visits.
       order by fof.n desc, p.id
       limit lim
    )
    union all
    (
      select 'artists'::text, p.id, p.username, p.display_name, p.avatar_url, coalesce(s.n, 0)
        from verified v
        join public.profiles p on p.id = v.pid
        left join starred_by_friends s on s.pid = p.id
       where p.id <> me
         and p.username_set
         and not exists (
           select 1 from public.follows mine
            where mine.follower_id = me and mine.following_id = p.id and mine.kind = 'star'
         )
         and not public.is_blocked_between(me, p.id)
       order by coalesce(s.n, 0) desc, p.followers_count desc nulls last, p.id
       limit lim
    );
end;
$$;

revoke all     on function public.search_discover_people(int) from public;
revoke execute on function public.search_discover_people(int) from anon;
grant  execute on function public.search_discover_people(int) to authenticated;

comment on function public.search_discover_people(int) is
  'Empty Search tab suggestions for the caller. ''friends'': unverified friends-of-friends, not already friends, by mutual friend count. ''artists'': verified accounts the caller does not star, by how many of the caller''s friends star them, then fan count. mutual_count is that ranking number only — never who. Excludes the caller, blocked pairs and accounts without a chosen username. Limit clamped to 1..20 per section. Empty for a signed-out caller.';

do $$
begin
  if has_function_privilege('anon', 'public.search_discover_people(int)', 'execute') then
    raise exception 'anon can execute search_discover_people — revoke did not take';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.search_discover_people(int)'::regprocedure) is not true then
    raise exception 'search_discover_people must be SECURITY DEFINER — friendships and profile_badges are unreadable under caller rights';
  end if;
end $$;
