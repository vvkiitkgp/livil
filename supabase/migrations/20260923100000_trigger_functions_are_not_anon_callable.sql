-- ============================================================================
-- Four SECURITY DEFINER trigger functions were left reachable by `anon`
-- ============================================================================
--
-- Caught by `scripts/check-definer-anon-grants.mjs`, which is right and which the four
-- migrations that introduced these functions all failed in the same way:
--
--     revoke all on function public.x() from public;
--
-- `PUBLIC` is the pseudo-role meaning "the default grant". Supabase separately grants
-- EXECUTE to the `anon` ROLE, and revoking the former leaves the latter untouched. The
-- REVOKE reads like it closed the door and does not.
--
-- A SECURITY DEFINER function runs with its OWNER's rights, so an `anon` grant is an
-- unauthenticated caller executing inside them. `track_scans_drop_unanswered` performs a
-- DELETE; `posts_block_taken_down` is the trigger that stops a taken-down track being
-- reinstated by inserting a post.
--
-- ── WHY REVOKING IS SAFE FOR A TRIGGER FUNCTION ────────────────────────────
--
-- PostgreSQL checks EXECUTE on a trigger function when the TRIGGER IS CREATED, not each
-- time it fires. The trigger fires as part of the DML regardless of what the writing role
-- may execute directly, so taking EXECUTE away does not disarm it.
--
-- That claim is not taken on faith here. An earlier migration in this same feature
-- revoked `moderating_now()` and broke every track title edit with "permission denied",
-- because that one IS called from a policy body by the caller. The verify block at the
-- bottom performs real writes as `authenticated` and fails if any trigger stopped firing
-- or started refusing.
--
-- Each of these is a trigger function and NOTHING should call it directly, so EXECUTE is
-- withdrawn from `authenticated` as well.

revoke execute on function public.posts_block_taken_down()            from anon, authenticated;
revoke execute on function public.terms_acceptances_verify_track()    from anon, authenticated;
revoke execute on function public.track_copyright_scans_snapshot()    from anon, authenticated;
revoke execute on function public.track_scans_drop_unanswered()       from anon, authenticated;

do $verify$
declare
  v_user  uuid := '0a0a0a0a-0000-0000-0000-00000000000e';
  v_track uuid := '0a0a0a0a-1111-0000-0000-00000000000e';
  v_n     int;
begin
  -- 1. The grant is actually gone. `has_function_privilege` is the same question the
  --    CI script asks, so a pass here means a pass there.
  if has_function_privilege('anon', 'public.track_scans_drop_unanswered()', 'EXECUTE')
     or has_function_privilege('anon', 'public.posts_block_taken_down()', 'EXECUTE')
     or has_function_privilege('anon', 'public.terms_acceptances_verify_track()', 'EXECUTE')
     or has_function_privilege('anon', 'public.track_copyright_scans_snapshot()', 'EXECUTE')
  then
    raise exception 'VERIFY: a SECURITY DEFINER trigger function is still anon-callable';
  end if;

  -- 2. The triggers still FIRE. This is the half that the moderating_now() incident
  --    proves cannot be assumed: revoking looked harmless there too.
  insert into auth.users (id, email)
  values (v_user, 'verify-revoke@livil.invalid') on conflict (id) do nothing;
  insert into public.profiles (id, username)
  values (v_user, 'verify_revoke_tmp') on conflict (id) do nothing;

  insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
  values (v_track, v_user, 'revoke probe', 'audio', 'https://verify.invalid/r.mp3');

  -- track_copyright_scans_snapshot must still populate the snapshot columns.
  insert into public.track_copyright_scans
    (track_id, provider, scanned_media_url, status, match_found)
  values (v_track, 'verify', 'https://verify.invalid/r.mp3', 'complete', true);

  select count(*) into v_n from public.track_copyright_scans
   where track_id = v_track and track_uploader_id = v_user and track_title = 'revoke probe';
  if v_n <> 1 then
    raise exception 'VERIFY: the snapshot trigger stopped firing after the revoke';
  end if;

  -- track_scans_drop_unanswered must still clear an unanswered scan with its track.
  delete from public.tracks where id = v_track;
  select count(*) into v_n from public.track_copyright_scans where track_id = v_track;
  if v_n <> 0 then
    raise exception 'VERIFY: the unanswered-scan trigger stopped firing after the revoke';
  end if;

  delete from public.profiles where id = v_user;
  delete from auth.users  where id = v_user;
end
$verify$;
