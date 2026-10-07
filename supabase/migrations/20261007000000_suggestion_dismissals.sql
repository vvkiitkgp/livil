-- ============================================================================
-- suggestion_dismissals — the X on a suggested person or artist
-- ============================================================================
--
-- The empty Search tab suggests people and artists (search_discover_people,
-- 20261005000000). The X on a row hides that account from ALL of the caller's suggestion
-- sections for good — one list, because "don't suggest this account to me" means the same
-- thing whichever section it appeared in. Stored server-side, not on the device, so "never again" survives a reinstall, a
-- second phone, and the sign-out wipe of device storage.
--
-- PRIVATE TO THE DISMISSER. Who you waved away is nobody else's business — least of all
-- the person dismissed. Owner-only SELECT and INSERT; no UPDATE (a dismissal has nothing to
-- edit). No DELETE policy yet: there is no "undo" in the app, and adding the policy later
-- is purely additive.
--
-- Hides a SUGGESTION only. The person can still be found by search and added normally;
-- this is not a block and changes nothing they can see or do.
--
-- PRODUCTION COMPATIBILITY: adds one table and re-creates search_discover_people with an
-- IDENTICAL signature and return shape (only extra exclusions), so the 2.1.2 app (which
-- never calls it) and any build that does are unaffected until a dismissal exists.

create table if not exists public.suggestion_dismissals (
  user_id            uuid not null references public.profiles(id) on delete cascade,
  dismissed_user_id  uuid not null references public.profiles(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (user_id, dismissed_user_id),
  constraint suggestion_dismissals_not_self check (user_id <> dismissed_user_id)
);

comment on table public.suggestion_dismissals is
  'Accounts the user asked never to be suggested again (X on the Search tab), across every suggestion section. Owner-only. Excluded by search_discover_people. Not a block.';

alter table public.suggestion_dismissals enable row level security;

drop policy if exists suggestion_dismissals_select_own on public.suggestion_dismissals;
create policy suggestion_dismissals_select_own on public.suggestion_dismissals
  for select to authenticated
  using (user_id = auth.uid());

-- `with check` on auth.uid(): nobody can dismiss a suggestion on someone else's behalf.
drop policy if exists suggestion_dismissals_insert_own on public.suggestion_dismissals;
create policy suggestion_dismissals_insert_own on public.suggestion_dismissals
  for insert to authenticated
  with check (user_id = auth.uid());

revoke all on public.suggestion_dismissals from anon;

-- Same function as 20261005000000 (see its header for the design), plus the dismissal
-- exclusion in the 'friends' and 'artists' sections. `create or replace` keeps its grants.
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
