-- The media freeze, and the record that has to outlive the track.
--
-- `tracks_freeze_media` is the only thing standing between "this file was scanned and
-- came back clean" and "this file is whatever the uploader last pointed us at". Its first
-- version was read by three reviewers and looked right. It was not: it tested
--
--     not (old.audio_url = placeholder and ...)
--
-- and on a track whose `video_url` was NULL that comparison is NULL, not FALSE, so
-- `if NULL then raise` quietly declined to raise and the EMPTY slot stayed writable for
-- the life of the track.
--
-- The lesson this file encodes: assert on BEHAVIOUR, by writing to the database. A test
-- that re-stated the predicate would have agreed with the bug.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/media-freeze.test.sql
--
-- NOTE: CI grants every table privilege to `authenticated` before these run, so a refusal
-- here cannot be a missing GRANT in disguise.

\set ON_ERROR_STOP on
begin;

-- ── Harness ─────────────────────────────────────────────────────────────────
create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- `others` is caught too: the freeze raises with errcode 42501, which maps to
-- insufficient_privilege, but a CHECK constraint failing first would surface differently
-- and must still read as "refused" rather than crashing the run.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when check_violation        then return false;
  when raise_exception        then return false;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values ('dddddddd-0000-0000-0000-000000000001', 'freeze-uploader@example.com')
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name)
values ('dddddddd-0000-0000-0000-000000000001', 'freeze_uploader', 'Freeze Uploader')
on conflict (id) do nothing;

-- An AUDIO track: `audio_url` filled, `video_url` empty. This shape is the whole point —
-- it is the one the original guard could not see.
insert into public.tracks (id, uploader_id, title, media_kind, audio_url, video_url)
values ('dddddddd-1111-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001',
        'A Clean Song', 'audio', 'https://cdn.example/clean.mp3', null);

-- A track still mid-upload, holding the placeholder. The legal transition must survive.
insert into public.tracks (id, uploader_id, title, media_kind, audio_url, video_url)
values ('dddddddd-1111-0000-0000-000000000002',
        'dddddddd-0000-0000-0000-000000000001',
        'Still Uploading', 'audio', 'pending://placeholder', null);

-- ── 1. The empty slot is frozen too ─────────────────────────────────────────
select pg_temp.assert(
  'the EMPTY video slot on an audio track cannot be filled after the fact',
  pg_temp.allows($$update public.tracks
                      set video_url = 'https://evil.example/injected.mp4'
                    where id = 'dddddddd-1111-0000-0000-000000000001'$$),
  false);

-- ── 2. The filled slot is still frozen (the original guarantee) ─────────────
select pg_temp.assert(
  'the scanned audio file cannot be swapped for another',
  pg_temp.allows($$update public.tracks
                      set audio_url = 'https://evil.example/swapped.mp3'
                    where id = 'dddddddd-1111-0000-0000-000000000001'$$),
  false);

select pg_temp.assert(
  'the scanned audio file cannot be erased either',
  pg_temp.allows($$update public.tracks
                      set audio_url = null
                    where id = 'dddddddd-1111-0000-0000-000000000001'$$),
  false);

-- ── 3. The upload itself still works ────────────────────────────────────────
--
-- The failure mode of over-tightening this trigger is an app that cannot publish at all,
-- which is worse than the hole it closes. Both of these must pass.
select pg_temp.assert(
  'placeholder -> a real URL is still allowed, once',
  pg_temp.allows($$update public.tracks
                      set audio_url = 'https://cdn.example/finished.mp3'
                    where id = 'dddddddd-1111-0000-0000-000000000002'$$),
  true);

select pg_temp.assert(
  'but only once — the second write is refused',
  pg_temp.allows($$update public.tracks
                      set audio_url = 'https://cdn.example/second-thoughts.mp3'
                    where id = 'dddddddd-1111-0000-0000-000000000002'$$),
  false);

select pg_temp.assert(
  'an ordinary title edit is untouched',
  pg_temp.allows($$update public.tracks
                      set title = 'A Clean Song (Remastered)'
                    where id = 'dddddddd-1111-0000-0000-000000000001'$$),
  true);

-- ── 4. The rights record outlives the track — ONCE IT IS A RECORD ───────────
--
-- The line is the acknowledgement, and both sides of it are asserted below. A scan
-- nobody answered is a provider's opinion about a file that was never published; keeping
-- it after its track is gone would park an unanswerable row in the moderation queue
-- forever and retain a note about somebody who published nothing.
insert into public.track_copyright_scans
  (track_id, provider, scanned_media_url, status, match_found, matched_title,
   acknowledgement, acknowledged_at, acknowledged_by,
   accepted_responsibility, granted_streaming_licence)
values ('dddddddd-1111-0000-0000-000000000001', 'audd',
        'https://cdn.example/clean.mp3', 'complete', true, 'Some Famous Recording',
        'self_recorded', now(), 'dddddddd-0000-0000-0000-000000000001', true, true);

select pg_temp.assert(
  'the scan row snapshots the title, so it still names something later',
  (select track_title = 'A Clean Song (Remastered)'
     from public.track_copyright_scans
    where track_id = 'dddddddd-1111-0000-0000-000000000001'),
  true);

select pg_temp.assert(
  'the scan row snapshots the uploader, so it still names WHO declared it',
  (select track_uploader_id = 'dddddddd-0000-0000-0000-000000000001'
     from public.track_copyright_scans
    where track_id = 'dddddddd-1111-0000-0000-000000000001'),
  true);

delete from public.tracks where id = 'dddddddd-1111-0000-0000-000000000001';

select pg_temp.assert(
  'deleting the track does NOT destroy an ANSWERED declaration',
  (select count(*) = 1 from public.track_copyright_scans
    where track_id = 'dddddddd-1111-0000-0000-000000000001'),
  true);

select pg_temp.assert(
  'and the surviving row can still be attributed to a person',
  (select track_uploader_id is not null and track_title is not null
     from public.track_copyright_scans
    where track_id = 'dddddddd-1111-0000-0000-000000000001'),
  true);

-- ── 5. An UNANSWERED scan goes with its track ───────────────────────────────
--
-- The other side of the line. `createTrack` rolls the track back when somebody cancels at
-- the copyright question and deliberately records no answer; without this the abandoned
-- scan would sit in `ops_copyright_scans` — which filters on `acknowledgement is null` —
-- pointing at a track that no longer exists, with nothing any operator could do about it.
insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
values ('dddddddd-1111-0000-0000-000000000003',
        'dddddddd-0000-0000-0000-000000000001',
        'Abandoned Upload', 'audio', 'https://cdn.example/abandoned.mp3');

insert into public.track_copyright_scans
  (track_id, provider, scanned_media_url, status, match_found, matched_title)
values ('dddddddd-1111-0000-0000-000000000003', 'audd',
        'https://cdn.example/abandoned.mp3', 'complete', true, 'Some Famous Recording');

select pg_temp.assert(
  'the unanswered scan exists while its track does',
  (select count(*) = 1 from public.track_copyright_scans
    where track_id = 'dddddddd-1111-0000-0000-000000000003'),
  true);

delete from public.tracks where id = 'dddddddd-1111-0000-0000-000000000003';

select pg_temp.assert(
  'a cancelled upload leaves NOTHING in the moderation queue',
  (select count(*) = 0 from public.track_copyright_scans
    where track_id = 'dddddddd-1111-0000-0000-000000000003'),
  true);

rollback;
