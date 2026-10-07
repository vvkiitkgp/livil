-- ============================================================================
-- Hide never-confirmed accounts from other users (ADR-0025, change 1 of 2)
-- ============================================================================
--
-- Email sign-up creates the profile BEFORE the address is confirmed, and an unconfirmed
-- user can never sign in — yet their profile showed up in search, @mentions, "People you
-- may know" (whose fallback ranks newest first, so a fresh sign-up topped everyone's
-- list) and could be sent friend requests that would stay pending forever.
--
-- Read-time, by decision: NO trigger on auth.users and NO change to handle_new_user —
-- anything inside GoTrue's sign-up / confirm transaction that raises would break sign-up
-- or confirmation for everyone (ADR-0025, Alternatives).
--
--   1. profiles.email_confirmed — a CACHE that only matters when true. Backfilled here;
--      new rows default false. A stale false is harmless: the policy falls through to
--      auth_email_confirmed(), which reads auth.users. Change 2 (the nightly purge) also
--      heals the cache.
--   2. auth_email_confirmed(uuid) — one PK read of auth.users, boolean only.
--   3. profiles_select_authenticated additionally requires confirmation (self always
--      visible). CASE, not OR, so cached-true rows never pay the auth.users probe.
--   4. search_discover_people (DEFINER, bypasses RLS) filters on auth.users directly.
--   5. send_friend_request refuses a missing OR unconfirmed target with one error,
--      user_not_found, so the error is not an existence oracle.
--
-- PRODUCTION COMPATIBILITY: only SELECT visibility of never-confirmed accounts narrows
-- (none has ever signed in). No client inserts profiles. Shipped 2.1.2 already tolerates
-- a hidden profile exactly as it tolerates a blocked one (ADR-0025 rollout, step 2), and
-- shows send_friend_request's raw error inline, as it does for 'blocked'.
-- search_discover_people keeps its signature and return shape. Reversible: restore the
-- previous policy and function bodies (20261008010000 / 20260808130000).

begin;

-- 1. The cache ------------------------------------------------------------------------
-- Default TRUE for the add (so no existing row is momentarily hidden), backfill false for
-- the unconfirmed, then default FALSE for every future sign-up. The reverse order would
-- make each new unconfirmed sign-up visible (ADR-0025, Alternatives).
alter table public.profiles
  add column if not exists email_confirmed boolean not null default true;

update public.profiles p
   set email_confirmed = false
  from auth.users u
 where u.id = p.id
   and u.email_confirmed_at is null;

alter table public.profiles alter column email_confirmed set default false;

-- 2. The authority ----------------------------------------------------------------------
create or replace function public.auth_email_confirmed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user_id
       and u.email_confirmed_at is not null
  );
$$;

-- RLS evaluates as the caller, so `authenticated` must execute it. Supabase grants anon
-- directly, so revoking from public alone would leave anon able to call it.
revoke execute on function public.auth_email_confirmed(uuid) from public, anon;
grant execute on function public.auth_email_confirmed(uuid) to authenticated;

-- 3. The perimeter ----------------------------------------------------------------------
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (
      (case when email_confirmed then true else public.auth_email_confirmed(id) end)
      and (
        not public.is_blocked_between(auth.uid(), id)
        or public.shares_conversation_with(auth.uid(), id)
      )
    )
  );

-- 4. Suggestions ------------------------------------------------------------------------
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
         -- Never-confirmed sign-ups are not suggestible (ADR-0025). Read from auth.users,
         -- never the profiles.email_confirmed cache alone.
         and exists (select 1 from auth.users au where au.id = p.id and au.email_confirmed_at is not null)
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
         -- Never-confirmed sign-ups are not suggestible (ADR-0025). Read from auth.users,
         -- never the profiles.email_confirmed cache alone.
         and exists (select 1 from auth.users au where au.id = p.id and au.email_confirmed_at is not null)
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
         -- Never-confirmed sign-ups are not suggestible (ADR-0025). Read from auth.users,
         -- never the profiles.email_confirmed cache alone.
         and exists (select 1 from auth.users au where au.id = p.id and au.email_confirmed_at is not null)
       order by coalesce(t.n, 0) desc, p.followers_count desc nulls last,
                p.created_at desc nulls last, p.id
       limit lim
    );
end;
$$;


-- 5. Friend requests --------------------------------------------------------------------
create or replace function public.send_friend_request(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_befriend_self'; end if;
  -- Missing and never-confirmed targets get the SAME error, so this is not a way to
  -- probe whether an account exists (ADR-0025).
  if not exists (
    select 1 from auth.users u
     where u.id = target_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'user_not_found';
  end if;
  if public.is_blocked_between(me, target_user_id) then
    raise exception 'blocked';
  end if;

  select lo, hi into v_lo, v_hi from public._friendship_pair(me, target_user_id);

  select * into v_existing from public.friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'already_friends';
    end if;
    -- pending row already exists; idempotent no-op
    return;
  end if;

  insert into public.friendships (user_a_id, user_b_id, requested_by, status)
  values (v_lo, v_hi, me, 'pending');
end;
$$;

-- Self-checks ---------------------------------------------------------------------------
do $$
begin
  if pg_get_function_result('public.search_discover_people(int)'::regprocedure)
     <> 'TABLE(section text, user_id uuid, username text, display_name text, avatar_url text, mutual_count integer)' then
    raise exception 'search_discover_people return shape changed — shipped app builds read it';
  end if;
  if has_function_privilege('anon', 'public.search_discover_people(int)', 'execute') then
    raise exception 'anon can execute search_discover_people';
  end if;
  if has_function_privilege('anon', 'public.auth_email_confirmed(uuid)', 'execute') then
    raise exception 'anon can execute auth_email_confirmed';
  end if;
  if not has_function_privilege('authenticated', 'public.auth_email_confirmed(uuid)', 'execute') then
    raise exception 'authenticated cannot execute auth_email_confirmed — the profiles policy would fail';
  end if;
  -- The only cache error that LEAKS visibility: cached true for an unconfirmed account.
  if exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
     where p.email_confirmed and u.email_confirmed_at is null
  ) then
    raise exception 'profiles.email_confirmed is true for an unconfirmed account';
  end if;
end $$;

commit;
