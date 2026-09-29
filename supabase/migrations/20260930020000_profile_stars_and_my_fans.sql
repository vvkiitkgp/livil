-- ============================================================================
-- profile stars (public) + my fans (owner-only) — the other two profile lists
-- ============================================================================
--
-- Product decision 2026-09-30, alongside 20260930010000 (friends):
--
--   * STARS — anyone signed in may list the artists a person stars. It answers
--     "what does my friend listen to"; it points at creators, who want to be found.
--   * FANS  — only the OWNER may list their own fans. A browsable list of who
--     follows a given person is people-browsing, not music discovery, and Livil
--     is not meant to feel like a dating app. Others still see the fan COUNT.
--
-- ── WHY SECURITY INVOKER ────────────────────────────────────────────────────
--
-- Unlike friendships, follows is already readable by every authenticated user
-- (follows_select_authenticated: USING true), so neither function needs to see
-- more than its caller can. Invoker rights keep the policies as the boundary and
-- leave no DEFINER body to audit.
--
-- ── WHAT THE FANS RESTRICTION IS, AND IS NOT ────────────────────────────────
--
-- list_my_fans() takes no user id, so it cannot be pointed at someone else. It
-- is a PRODUCT boundary, not a data one: a fan row of Riya is a star row of Sam,
-- and follows stays table-readable, so someone could reconstruct Riya's fans by
-- walking everyone's stars. Tightening follows_select would also break the public
-- stars list (same rows). Accepted — the goal is that the app never offers a
-- browsable fan list of another person.
--
-- ── BLOCKS ──────────────────────────────────────────────────────────────────
--
-- Same rules as list_profile_friends: a blocked pair (viewer ↔ owner) gets an
-- empty stars list, and anyone blocked with the viewer is omitted from either
-- list. (block_user already deletes stars in both directions, so the fans filter
-- is belt-and-braces.)
--
-- Nothing is stored or rewritten. Forward-only and idempotent.
-- ============================================================================

create or replace function public.list_profile_stars(p_user_id uuid)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.follows fo
  join public.profiles p on p.id = fo.following_id
  where auth.uid() is not null
    and fo.follower_id = p_user_id
    and fo.kind = 'star'
    and not public.is_blocked_between(auth.uid(), p_user_id)
    and (p.id = auth.uid() or not public.is_blocked_between(auth.uid(), p.id))
  -- Most recently starred first; id breaks ties so the order is total.
  order by fo.created_at desc nulls last, p.id;
$$;

revoke all on function public.list_profile_stars(uuid) from public;
revoke execute on function public.list_profile_stars(uuid) from anon;
grant execute on function public.list_profile_stars(uuid) to authenticated;

comment on function public.list_profile_stars(uuid) is
  'Artists a profile stars, for any signed-in viewer. INVOKER: follows is already authenticated-readable. Empty for a blocked pair; omits anyone blocked with the viewer.';

create or replace function public.list_my_fans()
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.follows fo
  join public.profiles p on p.id = fo.follower_id
  where auth.uid() is not null
    and fo.following_id = auth.uid()
    and fo.kind = 'star'
    and not public.is_blocked_between(auth.uid(), p.id)
  order by fo.created_at desc nulls last, p.id;
$$;

revoke all on function public.list_my_fans() from public;
revoke execute on function public.list_my_fans() from anon;
grant execute on function public.list_my_fans() to authenticated;

comment on function public.list_my_fans() is
  'The CALLER''s own fans. Takes no user id by design: product decision 2026-09-30 is that only the owner may browse their fan list (a product boundary, not a data one — see migration header).';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.list_profile_stars(uuid)', 'execute') then
    raise exception 'anon can execute list_profile_stars — revoke did not take';
  end if;
  if has_function_privilege('anon', 'public.list_my_fans()', 'execute') then
    raise exception 'anon can execute list_my_fans — revoke did not take';
  end if;
  if (select pronargs from pg_proc where oid = 'public.list_my_fans()'::regprocedure) <> 0 then
    raise exception 'list_my_fans must take no arguments — it must not be pointable at another user';
  end if;
end $$;
