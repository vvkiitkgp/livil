-- The server's clock dates posts, tracks, messages and Jams (20261105000000_server_time_on_writes.sql).
--
-- A signed-in client that sends its own dates — backdated to slip past the music score's
-- daily caps, or future-dated to sit atop a feed — gets the server's time instead, and
-- cannot change a post's or track's date afterwards. Rows placed by the owner role keep
-- the dates they were given.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/server-time-on-writes.test.sql

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
update app_switches set enabled = true where key = 'spotify_reposts';

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   SAM (…01) posts, uploads, messages and hosts; RIYA (…02) is in the group with him
insert into auth.users (id) values
  ('ce000000-0000-0000-0000-000000000001'), ('ce000000-0000-0000-0000-000000000002')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('ce000000-0000-0000-0000-000000000001', 'st_sam', true),
  ('ce000000-0000-0000-0000-000000000002', 'st_riya', true)
on conflict do nothing;
insert into conversations (id, kind) values ('cf000000-0000-0000-0000-000000000001', 'group');
insert into conversation_members (conversation_id, user_id, role) values
  ('cf000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000001', 'member'),
  ('cf000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000002', 'member');
-- Placed by the owner role: keeps its date.
insert into posts (id, author_id, kind, spotify_track_id, created_at) values
  ('d0000000-0000-0000-0000-000000000099', 'ce000000-0000-0000-0000-000000000001', 'repost',
   '4uLU6hMCjMI75M1A2tKUQC', '2020-01-01 00:00+00');
select pg_temp.assert('#0 a row placed by the owner role keeps its date',
  (select created_at = '2020-01-01 00:00+00' from posts where id = 'd0000000-0000-0000-0000-000000000099'), true);

-- ── Sam's app sends dates; the server's clock wins ──────────────────────────
select pg_temp.set_user('ce000000-0000-0000-0000-000000000001');
set local role authenticated;
insert into posts (id, author_id, kind, spotify_track_id, created_at) values
  ('d0000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000001', 'repost',
   '0VjIjW4GlUZAMYd2vXMi3b', '2001-01-01 00:00+00'),
  ('d0000000-0000-0000-0000-000000000002', 'ce000000-0000-0000-0000-000000000001', 'repost',
   '3o7TKSjRrfIPjeiVyM1234', '2099-01-01 00:00+00');
insert into tracks (id, uploader_id, title, media_kind, audio_url, created_at) values
  ('d1000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000001',
   'Backdated', 'audio', 'https://example.invalid/b.mp3', '2001-01-01 00:00+00');
insert into messages (id, conversation_id, sender_id, kind, body, created_at) values
  ('d2000000-0000-0000-0000-000000000001', 'cf000000-0000-0000-0000-000000000001',
   'ce000000-0000-0000-0000-000000000001', 'text', 'hi', '2001-01-01 00:00+00');
insert into jam_rooms (id, conversation_id, host_id, status, started_at, ended_at) values
  ('d3000000-0000-0000-0000-000000000001', 'cf000000-0000-0000-0000-000000000001',
   'ce000000-0000-0000-0000-000000000001', 'active', '2001-01-01 00:00+00', '2001-01-01 00:10+00');
reset role;
-- Riya likes Sam's post, claiming it was 2001.
select pg_temp.set_user('ce000000-0000-0000-0000-000000000002');
set local role authenticated;
insert into post_likes (post_id, user_id, created_at) values
  ('d0000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000002', '2001-01-01 00:00+00');
reset role;

select pg_temp.assert('#1 a backdated post is dated now',
  (select created_at = now() from posts where id = 'd0000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#2 so is a future-dated one',
  (select created_at = now() from posts where id = 'd0000000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('#3 a backdated track is dated now',
  (select created_at = now() from tracks where id = 'd1000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#4 a backdated message is dated now',
  (select created_at = now() from messages where id = 'd2000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#4b a backdated like is dated now',
  (select created_at = now() from post_likes
    where post_id = 'd0000000-0000-0000-0000-000000000001' and user_id = 'ce000000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('#5 a Jam starts now, and not already ended',
  (select started_at = now() and ended_at is null from jam_rooms where id = 'd3000000-0000-0000-0000-000000000001'), true);

-- ── …and cannot redate later ────────────────────────────────────────────────
select pg_temp.set_user('ce000000-0000-0000-0000-000000000001');
set local role authenticated;
update posts set created_at = '2099-01-01 00:00+00' where id = 'd0000000-0000-0000-0000-000000000001';
update tracks set created_at = '2001-01-01 00:00+00' where id = 'd1000000-0000-0000-0000-000000000001';
-- What the app sends on leaving: status + the phone's "now" (here, a lie).
update jam_rooms set status = 'ended', ended_at = '2001-01-01 00:10+00'
 where id = 'd3000000-0000-0000-0000-000000000001';
reset role;

select pg_temp.assert('#6 a post keeps its date',
  (select created_at = now() from posts where id = 'd0000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#7 a track keeps its date',
  (select created_at = now() from tracks where id = 'd1000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#8 a Jam ends at the server''s now, whatever the phone said',
  (select started_at = now() and ended_at = now() and status = 'ended'
     from jam_rooms where id = 'd3000000-0000-0000-0000-000000000001'), true);

-- Ended is final: ending again cannot move it later, and it cannot be cleared.
select pg_temp.set_user('ce000000-0000-0000-0000-000000000001');
set local role authenticated;
update jam_rooms set ended_at = '2099-01-01 00:00+00' where id = 'd3000000-0000-0000-0000-000000000001';
update jam_rooms set ended_at = null where id = 'd3000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#9 a Jam''s end, once set, stays put',
  (select ended_at = now() from jam_rooms where id = 'd3000000-0000-0000-0000-000000000001'), true);

rollback;
