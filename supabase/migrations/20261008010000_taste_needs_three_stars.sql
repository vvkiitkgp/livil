-- ============================================================================
-- "Artists in common" needs at least 3 stars
-- ============================================================================
--
-- The 'people' fallback in search_discover_people ranks by artists starred in common.
-- With ONE star that ranking is exactly "this artist's fans", and dismissing each batch
-- with the X pages through the whole list — a browsable fan list of someone else, which
-- the product rules out (fans are owner-only, decision 2026-09-30; list_my_fans).
--
-- Fix, two rules, both needed:
--   1. the caller must star at least 3 artists, and
--   2. a candidate counts as "taste" only when they share at least 2 of them.
-- Rule 1 alone is bypassed by starring the target plus two accounts nobody else stars
-- (stars are not limited to artists — add_star accepts any profile): every match is then
-- a fan of the target with 1 in common, ranked first. Rule 2 removes all 1-in-common rows,
-- so fillers that match nobody yield nothing, and popular fillers yield a mix of several
-- audiences rather than one artist's fans. Below either bar, `mutual_count` is 0 and the
-- order falls back to fans, then newest.
--
-- No data was exposed either way (`follows` is readable by every signed-in user); this
-- closes a convenient route to a product boundary, not a hole.
--
-- PRODUCTION COMPATIBILITY: identical signature and return shape; only the ranking of the
-- 'people' section changes. The 2.1.2 store app never calls this function.

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
         -- Taste only counts once the caller stars 3+ artists (20261008010000).
         and (select count(*) from my_stars) >= 3
       group by 1
      -- …and only for someone sharing 2+ of them: one shared artist is "a fan of X", and
      -- ranking by it re-creates X's fan list (see header).
      having count(distinct fo.following_id) >= 2
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
         -- A friend request already in flight, either way round: the suggestion has done
         -- its job (or the other person is in your Friend Requests). Not a dismissal — a
         -- cancelled or refused request makes them suggestible again on its own.
         and not exists (
           select 1 from public.friendships pf
            where pf.status = 'pending'
              and pf.user_a_id = least(me, p.id) and pf.user_b_id = greatest(me, p.id)
         )
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
         -- A friend request already in flight, either way round: the suggestion has done
         -- its job (or the other person is in your Friend Requests). Not a dismissal — a
         -- cancelled or refused request makes them suggestible again on its own.
         and not exists (
           select 1 from public.friendships pf
            where pf.status = 'pending'
              and pf.user_a_id = least(me, p.id) and pf.user_b_id = greatest(me, p.id)
         )
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
end $$;
