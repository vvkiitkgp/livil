-- Streaming renditions (20261115000000_tracks_transcode_renditions.sql).
--
-- A track's media URL is frozen once real (20260922100000). The transcoder, as the
-- service role, may swap it for a rendition in the same <uploader>/<track>/ folder while
-- recording the replaced upload — and NOTHING else may: not a client, not a swap to
-- another folder or another host, not a swap that forgets the original. Clients cannot
-- touch the ledger columns at all.
--
-- URLs are spelled out in full: psql does not substitute :'vars' inside DO blocks.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/transcode-renditions.test.sql

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

grant usage on schema auth to authenticated;
-- CI creates service_role bare. In production it bypasses RLS and may write every table;
-- give the test the same footing, inside this transaction.
grant usage on schema public to service_role;
grant all on public.tracks to service_role;
alter role service_role bypassrls;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   SAM (…a1) uploaded a 4K video (…a1) and a WAV song (…a2).
insert into auth.users (id) values ('ce000000-0000-0000-0000-0000000000a1')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('ce000000-0000-0000-0000-0000000000a1', 'tr_sam', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, video_url, created_at) values
  ('d1000000-0000-0000-0000-0000000000a1', 'ce000000-0000-0000-0000-0000000000a1',
   'Heavy 4K', 'video',
   'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.mov',
   now());
insert into tracks (id, uploader_id, title, media_kind, audio_url, created_at) values
  ('d1000000-0000-0000-0000-0000000000a2', 'ce000000-0000-0000-0000-0000000000a1',
   'Big WAV', 'audio',
   'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a2/audio.wav',
   now());

-- ── Clients stay frozen ─────────────────────────────────────────────────────
select pg_temp.set_user('ce000000-0000-0000-0000-0000000000a1');
set local role authenticated;

do $$ begin
  update tracks
     set video_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.h264.mp4',
         original_media_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.mov'
   where id = 'd1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL  #1 the uploader could swap their own video_url';
exception when insufficient_privilege then
  raise notice 'ok    #1 the uploader cannot swap video_url, even to a same-folder rendition';
end $$;

-- The ledger is not theirs: the write goes through (RLS: own row) but the values are kept.
update tracks set transcode_status = 'done', transcode_error = 'nope',
                  original_media_url = 'https://evil.example/x'
 where id = 'd1000000-0000-0000-0000-0000000000a1';
insert into tracks (id, uploader_id, title, media_kind, audio_url, created_at,
                    transcode_status, original_media_url) values
  ('d1000000-0000-0000-0000-0000000000a3', 'ce000000-0000-0000-0000-0000000000a1',
   'Seeded ledger', 'audio',
   'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a3/audio.mp3',
   now(), 'skipped', 'https://evil.example/y');
reset role;

select pg_temp.assert('#2 a client update leaves the ledger untouched',
  (select transcode_status is null and transcode_error is null and original_media_url is null
     from tracks where id = 'd1000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.assert('#3 a client insert cannot seed the ledger',
  (select transcode_status is null and original_media_url is null
     from tracks where id = 'd1000000-0000-0000-0000-0000000000a3'), true);

-- ── Only the intended swap is open to the service role ──────────────────────
set local role service_role;

do $$ begin
  update tracks
     set video_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.h264.mp4'
   where id = 'd1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL  #4 a swap that forgets the original went through';
exception when insufficient_privilege then
  raise notice 'ok    #4 the service role must record original_media_url to swap';
end $$;

do $$ begin
  update tracks
     set video_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000ff/video.h264.mp4',
         original_media_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.mov'
   where id = 'd1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL  #5 a swap into another track''s folder went through';
exception when insufficient_privilege then
  raise notice 'ok    #5 the rendition must live in the same <uploader>/<track>/ folder';
end $$;

do $$ begin
  update tracks
     set video_url = 'https://evil.example/video.h264.mp4',
         original_media_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.mov'
   where id = 'd1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL  #6 a swap to another host went through';
exception when insufficient_privilege then
  raise notice 'ok    #6 the rendition must stay in our bucket';
end $$;

do $$ begin
  update tracks set transcode_status = 'banana' where id = 'd1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL  #7 an unknown status was accepted';
exception when check_violation then
  raise notice 'ok    #7 transcode_status is one of skipped / done / failed';
end $$;

-- The swap the transcoder makes.
update tracks
   set video_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.h264.mp4',
       original_media_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.mov',
       transcode_status = 'done', transcoded_at = now(), file_size_bytes = 7531273
 where id = 'd1000000-0000-0000-0000-0000000000a1';
update tracks
   set audio_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a2/audio.aac.m4a',
       original_media_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a2/audio.wav',
       transcode_status = 'done', transcoded_at = now()
 where id = 'd1000000-0000-0000-0000-0000000000a2';
reset role;

select pg_temp.assert('#8 the video now points at its rendition and remembers the upload',
  (select video_url like '%/d1000000-0000-0000-0000-0000000000a1/video.h264.mp4'
      and original_media_url like '%/d1000000-0000-0000-0000-0000000000a1/video.mov'
      and transcode_status = 'done' and transcoded_at is not null
     from tracks where id = 'd1000000-0000-0000-0000-0000000000a1'), true);
select pg_temp.assert('#9 the audio slot follows the same rule',
  (select audio_url like '%/audio.aac.m4a' and transcode_status = 'done'
     from tracks where id = 'd1000000-0000-0000-0000-0000000000a2'), true);

-- ── After the swap the uploader is unaffected, and still frozen ─────────────
set local role authenticated;
update tracks set title = 'Heavy 4K (edited)' where id = 'd1000000-0000-0000-0000-0000000000a1';

do $$ begin
  update tracks
     set video_url = 'https://x.supabase.co/storage/v1/object/public/tracks-media/ce000000-0000-0000-0000-0000000000a1/d1000000-0000-0000-0000-0000000000a1/video.mov'
   where id = 'd1000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL  #11 the uploader could move video_url back';
exception when insufficient_privilege then
  raise notice 'ok    #11 the uploader still cannot change video_url after the swap';
end $$;
reset role;

select pg_temp.assert('#10 the uploader can still edit the title after the swap',
  (select title = 'Heavy 4K (edited)' and video_url like '%/video.h264.mp4'
     from tracks where id = 'd1000000-0000-0000-0000-0000000000a1'), true);

-- Undo is a service-role write back to the recorded original (same folder, so allowed).
set local role service_role;
update tracks set video_url = original_media_url, transcode_status = null, transcoded_at = null
 where id = 'd1000000-0000-0000-0000-0000000000a1';
reset role;
select pg_temp.assert('#12 the service role can point the track back at the original',
  (select video_url like '%/video.mov' and transcode_status is null
     from tracks where id = 'd1000000-0000-0000-0000-0000000000a1'), true);

rollback;
