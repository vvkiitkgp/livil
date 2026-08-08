-- Restore block_user's declared body in production.
--
-- The last of the drift from 20260808100000. That migration was applied to
-- production with two comment lines missing from this function's body, because
-- the SQL was retyped on its way to the database rather than copied. Postgres
-- stores prosrc verbatim, so the parity fingerprint differs while the behaviour
-- does not — the same cause as 20260808130000, which repaired the other three
-- and missed this one because the failing diff was read from a truncated log.
--
-- Byte-identical to the definition in 20260808100000, extracted from that file
-- rather than retyped. A fresh apply is unaffected: it already produces this
-- body, and re-declaring it is a no-op there. The statement exists for
-- production, where it is a repair.
--
-- The revoke is repeated defensively. CREATE OR REPLACE preserves an existing
-- ACL rather than re-applying Supabase's default privileges, so this should not
-- be necessary — but the cost of being wrong about that is an anon-callable
-- SECURITY DEFINER function, and the cost of the line is nothing.

create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_block_self'; end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (me, target_user_id)
  on conflict do nothing;

  -- Any status, not just 'accepted': a pending request in either direction must
  -- go too, or unblocking would resurrect a request the blocker never accepted.
  select lo, hi into v_lo, v_hi from public._friendship_pair(me, target_user_id);
  delete from public.friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  -- Stars are one-way, so both directions must be cleared explicitly.
  delete from public.follows
   where (follower_id = me and following_id = target_user_id)
      or (follower_id = target_user_id and following_id = me);
end;
$$;

revoke execute on function public.block_user(uuid) from anon;
