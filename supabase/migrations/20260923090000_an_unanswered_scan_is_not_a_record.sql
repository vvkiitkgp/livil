-- ============================================================================
-- An abandoned upload should not leave a permanent row in the moderation queue
-- ============================================================================
--
-- 20260923070000 removed `track_copyright_scans.track_id`'s cascade so that a rights
-- declaration survives its track being deleted. That is right, and it had a consequence
-- that was not thought through.
--
-- `createTrack` deliberately does NOT record a cancellation. Its comment says why, and
-- the reasoning is worth keeping: retaining "this person started an upload that matched,
-- then thought better of it" is a note about somebody who published nothing, which is a
-- surveillance question this feature has no business answering. That worked because the
-- unanswered scan row cascaded away with the track the rollback deleted.
--
-- With the cascade gone it no longer does. Every cancelled upload would now leave an
-- unanswered match in `ops_copyright_scans` — which filters on exactly
-- `acknowledgement is null` — pointing at a track that does not exist, forever, and no
-- operator action can clear it because answering is the uploader's to do.
--
-- ── THE LINE, AND WHY IT IS DRAWN HERE ─────────────────────────────────────
--
-- A scan row is evidence from the moment somebody ANSWERS it. Before that it is a
-- provider's opinion about a file that was never published:
--
--   acknowledgement IS NOT NULL  -> a declaration was made. Keep it forever, through the
--                                   track's deletion and the account's. That is the whole
--                                   point of 20260923070000.
--   acknowledgement IS NULL      -> nobody ever claimed anything. When the track goes,
--                                   this goes with it.
--
-- Note this is strictly narrower than the cascade it replaces: the old behaviour deleted
-- ANSWERED rows too, which is the defect that was fixed.
--
-- ── WHY A TRIGGER AND NOT CLIENT CODE ──────────────────────────────────────
--
-- The rollback path in `createTrack` could delete the row itself, but `track_copyright_scans`
-- has no DELETE policy and should not get one — a policy letting an uploader delete scan
-- rows is a policy letting them delete the ones they already answered. Binding it to the
-- track's deletion means it also covers account deletion, operator deletion, and every
-- path added later, none of which run that client code.

create or replace function public.track_scans_drop_unanswered()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- SECURITY DEFINER because the deleter is whoever deleted the TRACK — an uploader
  -- rolling back, or an operator — and neither has (or should have) delete rights on
  -- this table.
  delete from public.track_copyright_scans
   where track_id = old.id
     and acknowledgement is null;
  return old;
end;
$function$;

comment on function public.track_scans_drop_unanswered() is
  'A scan nobody answered is a provider opinion about an unpublished file, not a record. '
  'It goes when its track goes. An ANSWERED scan is a declaration and outlives both the '
  'track and the account.';

revoke all on function public.track_scans_drop_unanswered() from public;

drop trigger if exists trg_track_scans_drop_unanswered on public.tracks;
create trigger trg_track_scans_drop_unanswered
  AFTER DELETE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.track_scans_drop_unanswered();

-- ── Verify ──────────────────────────────────────────────────────────────────
--
-- Exercised, not inspected — the defect this repairs was itself introduced by reasoning
-- about a mechanism instead of running it.
do $verify$
declare
  v_user  uuid := '0c0c0c0c-0000-0000-0000-00000000000f';
  v_kept  uuid := '0c0c0c0c-1111-0000-0000-00000000000a';
  v_gone  uuid := '0c0c0c0c-1111-0000-0000-00000000000b';
  v_n     int;
begin
  -- BOTH inserts tolerate the row already being there, and that is not defensiveness
  -- for its own sake. Production carries an `on_auth_user_created` trigger on
  -- `auth.users` which creates the profile automatically — and that trigger exists ONLY
  -- in production. No migration creates it (20260722160000 merely mentions it in a
  -- comment), so a local replay and CI both run against an `auth.users` that has no such
  -- trigger. The first version of this block inserted the profile unconditionally: it
  -- passed every local run and failed on the real database with a duplicate key.
  insert into auth.users (id, email)
  values (v_user, 'verify-unanswered@livil.invalid')
  on conflict (id) do nothing;

  insert into public.profiles (id, username)
  values (v_user, 'verify_unanswered_tmp')
  on conflict (id) do nothing;

  insert into public.tracks (id, uploader_id, title, media_kind, audio_url) values
    (v_kept, v_user, 'answered',   'audio', 'https://verify.invalid/a.mp3'),
    (v_gone, v_user, 'unanswered', 'audio', 'https://verify.invalid/b.mp3');

  -- One answered (a declaration was made), one never answered.
  insert into public.track_copyright_scans
    (track_id, provider, scanned_media_url, status, match_found,
     acknowledgement, acknowledged_at, acknowledged_by,
     accepted_responsibility, granted_streaming_licence)
  values (v_kept, 'verify', 'https://verify.invalid/a.mp3', 'complete', true,
          'self_recorded', now(), v_user, true, true);

  insert into public.track_copyright_scans
    (track_id, provider, scanned_media_url, status, match_found)
  values (v_gone, 'verify', 'https://verify.invalid/b.mp3', 'complete', true);

  delete from public.tracks where id in (v_kept, v_gone);

  select count(*) into v_n from public.track_copyright_scans where track_id = v_gone;
  if v_n <> 0 then
    raise exception 'VERIFY: an abandoned upload still leaves a row in the moderation queue';
  end if;

  select count(*) into v_n from public.track_copyright_scans where track_id = v_kept;
  if v_n <> 1 then
    raise exception 'VERIFY: deleting a track destroyed a declaration that WAS given';
  end if;

  -- Leave nothing behind. Everything above is scratch.
  delete from public.track_copyright_scans where track_id in (v_kept, v_gone);
  delete from public.profiles  where id = v_user;
  delete from auth.users       where id = v_user;
end
$verify$;
