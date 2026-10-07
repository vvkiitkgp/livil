-- ============================================================================
-- "People you may know" never empty — a fallback section for search_discover_people
-- ============================================================================
--
-- 'friends' only reaches friends-of-friends, so an account with no friends saw no people
-- suggestions at all. This adds a third section, 'people', for everyone a mutual friend
-- does NOT reach, ranked by:
--   1. artists starred in common with the caller (shared taste), then
--   2. fans (followers_count), then
--   3. newest.
-- The app shows 'friends' first and fills the rest of "People you may know" from 'people'.
-- `mutual_count` on a 'people' row is the number of artists in common (0 = no shared
-- taste; the app shows no reason line then).
--
-- Same exclusions as 'friends': the caller, their friends, verified accounts (artists have
-- their own list), anyone dismissed with the X, blocked pairs, half-onboarded accounts.
--
-- WHAT IT REVEALS: who stars which artist is already readable by any signed-in user
-- (`follows` SELECT is `using (true)`, and list_profile_stars exposes it), so "N artists in
-- common" is derivable today. Listing unverified accounts to strangers is what search
-- already does for any typed letter; the order (fans, then join time) is not returned.
--
-- PRODUCTION COMPATIBILITY: `create or replace` with an IDENTICAL signature and return
-- shape — the new section is a new VALUE of `section`, not a new column. The 2.1.2 app
-- never calls this function. A build that does but predates 'people' ignores unknown
-- sections (fetchDiscoverPeople only reads 'friends' / 'artists'), so it is unaffected.
-- Requires 20261007000000 (suggestion_dismissals) to be applied first.

create or replace function public.search_discover_people(p_limit int default 5)
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
    -- Artists the caller stars, and everyone else who stars any of them: shared taste.
    -- `follows` is readable by every signed-in user, so this is public information.
    my_stars as (
      select fo.following_id as aid
        from public.follows fo
       where fo.follower_id = me and fo.kind = 'star'
    ),
    shared_taste as (
      select fo.follower_id as pid, count(distinct fo.following_id)::int as n
        from public.follows fo
        join my_stars ms on ms.aid = fo.following_id
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
         -- Dismissed with the X: never suggested to this caller again.
         and not exists (
           select 1 from public.suggestion_dismissals d
            where d.user_id = me and d.dismissed_user_id = p.id
         )
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
         -- Dismissed with the X: never suggested to this caller again.
         and not exists (
           select 1 from public.suggestion_dismissals d
            where d.user_id = me and d.dismissed_user_id = p.id
         )
         and not public.is_blocked_between(me, p.id)
       order by coalesce(s.n, 0) desc, p.followers_count desc nulls last, p.id
       limit lim
    )
    union all
    (
      -- 'people': the fallback that keeps "People you may know" filled when the caller
      -- has few or no friends. Anyone NOT reachable through a mutual friend (those are
      -- 'friends' above), ranked by artists starred in common, then fans, then newest.
      -- mutual_count = artists in common. Same exclusions as 'friends'.
      select 'people'::text, p.id, p.username, p.display_name, p.avatar_url, coalesce(t.n, 0)
        from public.profiles p
        left join shared_taste t on t.pid = p.id
       where p.id <> me
         and p.username_set
         and not exists (select 1 from friends_of_friends fof where fof.pid = p.id)
         and not exists (select 1 from my_friends mf where mf.fid = p.id)
         and not exists (select 1 from verified v where v.pid = p.id)
         and not exists (
           select 1 from public.suggestion_dismissals d
            where d.user_id = me and d.dismissed_user_id = p.id
         )
         and not public.is_blocked_between(me, p.id)
       order by coalesce(t.n, 0) desc, p.followers_count desc nulls last,
                p.created_at desc nulls last, p.id
       limit lim
    );
end;
$$;

do $$
begin
  if pg_get_function_result('public.search_discover_people(int)'::regprocedure)
     <> 'TABLE(section text, user_id uuid, username text, display_name text, avatar_url text, mutual_count integer)' then
    raise exception 'search_discover_people return shape changed — shipped app builds read it';
  end if;
  if has_function_privilege('anon', 'public.search_discover_people(int)', 'execute') then
    raise exception 'anon can execute search_discover_people';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.search_discover_people(int)'::regprocedure) is not true then
    raise exception 'search_discover_people must stay SECURITY DEFINER';
  end if;
end $$;
