-- ============================================================================
-- list_blocked_accounts — you may always see WHO you blocked
-- ============================================================================
--
-- Two of my own migrations collided, and the result shipped to a device.
--
-- 20260808100000 + the BlockedAccounts screen read the blocked person's name
-- and avatar with a PostgREST embed:
--
--     .from('blocked_users').select('..., profiles!blocked_users_blocked_id_fkey(...)')
--
-- 20260809000000 then hid blocked users' profiles from the blocker. An embed is
-- a join, and a join obeys the joined table's RLS — so every row of the blocked
-- list rendered as "Unknown" with a "U" avatar. Correct enforcement, useless
-- screen: the one list whose entire purpose is telling you who you blocked
-- became the one list that cannot.
--
-- ── WHY AN RPC AND NOT A PROFILES EXCEPTION ─────────────────────────────────
--
-- The tempting fix is to add "…or I blocked them" to profiles_select. It is
-- wrong. That predicate is true everywhere, so a blocked person would come back
-- in search, in mention pickers, in every profile lookup — re-opening most of
-- what 20260809000000 closed, to fix one screen.
--
-- A DEFINER function scopes the exception to the single question being asked:
-- "who have I blocked?" It answers only for auth.uid()'s own block rows, returns
-- nothing for anyone else, and cannot be aimed at a user id the caller did not
-- block. Same shape as list_incoming_friend_requests.
--
-- Ordered newest first: the block you most want to undo is the one you least
-- meant.
-- ============================================================================

create or replace function public.list_blocked_accounts()
returns table (
  blocked_id   uuid,
  username     text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.blocked_id, p.username, p.display_name, p.avatar_url, b.created_at
  from public.blocked_users b
  left join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

revoke all on function public.list_blocked_accounts() from public;
revoke execute on function public.list_blocked_accounts() from anon;
grant execute on function public.list_blocked_accounts() to authenticated;

comment on function public.list_blocked_accounts() is
  'The caller''s own block list with the blocked users'' names and avatars. DEFINER because 20260809000000 hides those profiles from the blocker, which would otherwise make this screen render every row as "Unknown". Scoped to auth.uid()''s own rows and takes no parameters, so it cannot be aimed at anyone else''s blocks.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.list_blocked_accounts()', 'execute') then
    raise exception 'anon can execute list_blocked_accounts — revoke did not take';
  end if;
  if not has_function_privilege('authenticated', 'public.list_blocked_accounts()', 'execute') then
    raise exception 'authenticated cannot execute list_blocked_accounts';
  end if;
  -- Takes no arguments on purpose: a uuid parameter would be a way to ask about
  -- someone else's block list.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'list_blocked_accounts' and p.pronargs = 0) <> 1 then
    raise exception 'list_blocked_accounts must take zero arguments';
  end if;
end $$;
