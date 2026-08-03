-- Take can_comment_on_post out of anon's reach.
--
-- Found by the Supabase security advisor immediately after 20260803180000 applied:
--
--   "can_comment_on_post(p_post_id uuid) can be executed by the `anon` role as a
--    SECURITY DEFINER function via /rest/v1/rpc/can_comment_on_post."
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, so the helper arrived
-- callable by anon without anyone choosing that. It is a DEFINER function, so it reads
-- profiles and friendships with the owner's privileges regardless of who calls it.
--
-- WHAT THAT LEAKS. Called with auth.uid() = null, the function returns false exactly
-- when the post's author has set comments_friends_only. So an unauthenticated caller
-- could walk post ids through the REST endpoint and read back, per post, whether its
-- author has restricted their comments — a privacy preference, disclosed to someone who
-- is not even signed in. Not severe, and it exposes no comment content, but it is
-- precisely the shape LIV-10 closed for the activity_* functions and there is no reason
-- to reopen it for this one.
--
-- anon needs no access here: anon has no INSERT policy on post_comments at all, so the
-- helper can never be reached through the policy path as anon. `authenticated` DOES need
-- EXECUTE — RLS evaluates a policy expression as the invoking role, so a signed-in user
-- must be able to run this or every comment insert is denied for the wrong reason
-- (the same failure mode the CI harness's function grant exists to avoid).
--
-- Granted explicitly to authenticated rather than left to the PUBLIC default, so the
-- permission is stated rather than inherited and survives a future PUBLIC revoke.
revoke execute on function public.can_comment_on_post(uuid) from public, anon;
grant  execute on function public.can_comment_on_post(uuid) to authenticated;

-- Assert the property, not that the statements ran. `has_function_privilege` answers the
-- question the advisor actually asked, and would still fail if a later grant re-opened it.
do $$
begin
  if has_function_privilege('anon', 'public.can_comment_on_post(uuid)', 'execute') then
    raise exception 'anon can still execute can_comment_on_post';
  end if;
  if not has_function_privilege('authenticated', 'public.can_comment_on_post(uuid)', 'execute') then
    raise exception
      'authenticated cannot execute can_comment_on_post — every comment insert would be denied by the policy';
  end if;
end $$;
