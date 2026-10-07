-- ============================================================================
-- Suggestions follow the friendship lifecycle
-- ============================================================================
--
-- How "People you may know" (search_discover_people) reacts to friend actions:
--
--   send a request (Add) → hidden while the request is PENDING, either direction. Not
--                          recorded as a dismissal, so cancel / refuse brings them back.
--   become friends       → hidden (already: friends are excluded), AND any earlier X
--                          between the two is cleared — becoming friends supersedes it,
--                          so if they later unfriend, each is suggestible again.
--   unfriend             → suggestible again (nothing recorded on the way in).
--   block                → never suggested while blocked, both directions (already:
--                          is_blocked_between). ALSO records a dismissal for the BLOCKER
--                          only, so an unblock does not drop the person straight back
--                          into their suggestions. Nothing is written for the blocked
--                          person: a row in THEIR dismissals would let them discover the
--                          block by reading their own table.
--
-- PRODUCTION COMPATIBILITY: search_discover_people is re-created with an IDENTICAL
-- signature and return shape (one extra exclusion). The two triggers fire on existing
-- write paths (accept_friend_request's UPDATE, block_user's INSERT) that the 2.1.2 app
-- already uses; they only touch suggestion_dismissals, swallow nothing and add no failure
-- mode beyond a primary-key no-op (`on conflict do nothing`), so accepting and blocking
-- behave exactly as before for every app version.

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

-- ── becoming friends clears any earlier X between the two ───────────────────────
create or replace function public.suggestion_dismissals_clear_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- DEFINER: suggestion_dismissals has no DELETE policy (the app never deletes), and the
  -- accepting user must clear the OTHER person's row too.
  delete from public.suggestion_dismissals
   where (user_id = new.user_a_id and dismissed_user_id = new.user_b_id)
      or (user_id = new.user_b_id and dismissed_user_id = new.user_a_id);
  return null;
end;
$$;

revoke execute on function public.suggestion_dismissals_clear_on_accept() from anon;

drop trigger if exists trg_suggestion_dismissals_clear_on_accept on public.friendships;
create trigger trg_suggestion_dismissals_clear_on_accept
after update on public.friendships
for each row
when (new.status = 'accepted' and old.status is distinct from 'accepted')
execute function public.suggestion_dismissals_clear_on_accept();

-- ── blocking keeps the blocked person out of the BLOCKER's suggestions for good ──
create or replace function public.suggestion_dismissals_on_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Blocker's side only — see the header for why never the blocked person's.
  insert into public.suggestion_dismissals (user_id, dismissed_user_id)
  values (new.blocker_id, new.blocked_id)
  on conflict do nothing;
  return null;
end;
$$;

revoke execute on function public.suggestion_dismissals_on_block() from anon;

drop trigger if exists trg_suggestion_dismissals_on_block on public.blocked_users;
create trigger trg_suggestion_dismissals_on_block
after insert on public.blocked_users
for each row
execute function public.suggestion_dismissals_on_block();

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
