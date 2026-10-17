-- Music score (20261104000000_music_score.sql).
--
-- Lena listens, likes, comments, shares and reposts; Uday uploads and hosts a Jam; Omar
-- reposts a lot. Each rule's points and daily cap is checked, then undoing things takes
-- points back, and the table is readable but not writable by the app.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/music-score.test.sql

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

create or replace function pg_temp.assert_eq(label text, actual bigint, expected bigint)
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

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

-- Points per activity for one person, straight from the breakdown.
create or replace function pg_temp.pts(uid uuid, act text)
returns bigint language sql as $$
  select coalesce(sum(points), 0)::bigint from public.music_score_points() where user_id = uid and activity = act
$$;

create or replace function pg_temp.score(uid uuid)
returns bigint language sql as $$
  select score::bigint from public.music_scores where user_id = uid
$$;

grant usage on schema auth to authenticated;
update app_switches set enabled = true where key = 'spotify_reposts';

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   LENA (…01) the listener · UDAY (…02) uploads · OMAR (…03) reposts · NEW (…04) did nothing
-- Day 1 = 2026-10-10 IST, day 2 = 2026-10-11, day 3 = 2026-10-12 (all at 11:30 IST).
insert into auth.users (id) values
  ('c9000000-0000-0000-0000-000000000001'), ('c9000000-0000-0000-0000-000000000002'),
  ('c9000000-0000-0000-0000-000000000003'), ('c9000000-0000-0000-0000-000000000004')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('c9000000-0000-0000-0000-000000000001', 'ms_lena', true),
  ('c9000000-0000-0000-0000-000000000002', 'ms_uday', true),
  ('c9000000-0000-0000-0000-000000000003', 'ms_omar', true),
  ('c9000000-0000-0000-0000-000000000004', 'ms_new', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url, created_at, taken_down_at) values
  ('ca000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002',
   'Full Moon', 'audio', 'https://example.invalid/1.mp3', '2026-10-10 06:00+00', null),
  ('ca000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002',
   'Taken down', 'audio', 'https://example.invalid/2.mp3', '2026-10-10 06:00+00', null);

insert into posts (id, author_id, kind, track_id, created_at) values
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', 'upload',
   'ca000000-0000-0000-0000-000000000001', '2026-10-10 06:00+00'),
  ('cb000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002', 'upload',
   'ca000000-0000-0000-0000-000000000002', '2026-10-10 06:00+00');
insert into posts (id, author_id, kind, spotify_track_id, created_at) values
  -- Omar's Spotify repost, and Lena's two reposts of the SAME Spotify song on two days.
  ('cb000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000003', 'repost',
   '4uLU6hMCjMI75M1A2tKUQC', '2026-10-10 06:00+00'),
  ('cb000000-0000-0000-0000-000000000004', 'c9000000-0000-0000-0000-000000000001', 'repost',
   '0VjIjW4GlUZAMYd2vXMi3b', '2026-10-10 06:00+00'),
  ('cb000000-0000-0000-0000-000000000005', 'c9000000-0000-0000-0000-000000000001', 'repost',
   '0VjIjW4GlUZAMYd2vXMi3b', '2026-10-11 06:00+00');
-- Track 2 is taken down after it was posted (a taken-down track cannot be posted). Only an
-- operator may take a track down; the guard trigger is set aside for this fixture alone.
set local session_replication_role = replica;
update tracks set taken_down_at = '2026-10-11 06:00+00' where id = 'ca000000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
-- Omar reposts 60 different songs on day 3 (repost cap: 10 a day).
insert into posts (id, author_id, kind, spotify_track_id, created_at)
select ('cc000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       'c9000000-0000-0000-0000-000000000003', 'repost',
       'A' || lpad(g::text, 21, '0'), '2026-10-12 06:00+00'
  from generate_series(1, 60) g;

-- Plays.
insert into post_views (post_id, user_id, played_at) values
  -- Lena plays Uday's song 3 times on day 1 and once on day 2: one per song a day.
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', '2026-10-10 06:00+00'),
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', '2026-10-10 06:05+00'),
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', '2026-10-10 06:10+00'),
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', '2026-10-11 06:00+00'),
  -- Omar plays Uday's song once on day 1.
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003', '2026-10-10 06:00+00'),
  -- Uday plays his own song: nothing for listening, nothing as "played by others".
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002', '2026-10-10 06:00+00');
-- Spotify songs are listened to in Spotify, so they count when opened there. The server
-- stamps an open with its own clock (spotify_opens_server_time), so these all land TODAY:
-- Omar's song twice (still one song) plus 60 others = 61 songs, capped at 50.
insert into spotify_opens (spotify_track_id, source, user_id, created_at) values
  ('4uLU6hMCjMI75M1A2tKUQC', 'feed', 'c9000000-0000-0000-0000-000000000001', '2026-10-10 06:00+00'),
  ('4uLU6hMCjMI75M1A2tKUQC', 'chat', 'c9000000-0000-0000-0000-000000000001', '2026-10-10 07:00+00');
insert into spotify_opens (spotify_track_id, source, user_id, created_at)
select 'A' || lpad(g::text, 21, '0'), 'feed', 'c9000000-0000-0000-0000-000000000001', '2026-10-12 06:00+00'
  from generate_series(1, 60) g;

-- Likes: Lena likes two posts; Uday likes his own.
insert into post_likes (post_id, user_id) values
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001'),
  ('cb000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000001'),
  ('cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002');

-- Comments: Lena posts 25 on day 1 (cap: 20 a day).
insert into post_comments (post_id, author_id, body, created_at)
select 'cb000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
       'nice ' || g, '2026-10-10 06:00+00'
  from generate_series(1, 25) g;

-- Chat: Lena shares a Livil song and a Spotify link; plain text and a deleted share earn nothing.
insert into conversations (id, kind) values
  ('cd000000-0000-0000-0000-000000000001', 'dm'), ('cd000000-0000-0000-0000-000000000002', 'dm');
insert into conversation_members (conversation_id, user_id, role) values
  ('cd000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'member'),
  ('cd000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003', 'member'),
  ('cd000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002', 'member'),
  ('cd000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003', 'member');
insert into messages (conversation_id, sender_id, kind, body, created_at, deleted_at) values
  ('cd000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'track_share', '', '2026-10-10 06:00+00', null),
  ('cd000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'text',
   'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', '2026-10-10 06:01+00', null),
  ('cd000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'text', 'hello', '2026-10-10 06:02+00', null),
  ('cd000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 'track_share', '', '2026-10-10 06:03+00', '2026-10-10 06:04+00');

-- Jams: Uday hosts one for 10 minutes and one for 2.
insert into jam_rooms (conversation_id, host_id, status, started_at, ended_at) values
  ('cd000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002', 'ended',
   '2026-10-10 06:00+00', '2026-10-10 06:10+00'),
  ('cd000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002', 'ended',
   '2026-10-10 07:00+00', '2026-10-10 07:02+00');

-- ── Each rule ───────────────────────────────────────────────────────────────
select pg_temp.assert_eq('#1 listening: Livil plays + Spotify opens, one per song a day, 50 a day',
  pg_temp.pts('c9000000-0000-0000-0000-000000000001', 'listen'), 1 + 1 + 50);
select pg_temp.assert_eq('#1b playing your own upload earns nothing',
  pg_temp.pts('c9000000-0000-0000-0000-000000000002', 'listen'), 0);
select pg_temp.assert_eq('#2 liking: one per post, not your own',
  pg_temp.pts('c9000000-0000-0000-0000-000000000001', 'like'), 2);
select pg_temp.assert_eq('#2b liking your own post earns nothing',
  pg_temp.pts('c9000000-0000-0000-0000-000000000002', 'like'), 0);
select pg_temp.assert_eq('#3 commenting: 2 each, 20 a day',
  pg_temp.pts('c9000000-0000-0000-0000-000000000001', 'comment'), 40);
select pg_temp.assert_eq('#4 sharing a song in chat: Livil or Spotify, not plain text, not deleted',
  pg_temp.pts('c9000000-0000-0000-0000-000000000001', 'share'), 4);
select pg_temp.assert_eq('#5 reposting the same song twice counts once',
  pg_temp.pts('c9000000-0000-0000-0000-000000000001', 'repost'), 5);
select pg_temp.assert_eq('#5b reposting: 10 songs a day',
  pg_temp.pts('c9000000-0000-0000-0000-000000000003', 'repost'), (1 + 10) * 5);
select pg_temp.assert_eq('#6 uploading: 25, a taken-down track counts nothing',
  pg_temp.pts('c9000000-0000-0000-0000-000000000002', 'upload'), 25);
select pg_temp.assert_eq('#7 plays of your upload: one per listener per song a day, never your own',
  pg_temp.pts('c9000000-0000-0000-0000-000000000002', 'played_by_others'), 3);
select pg_temp.assert_eq('#8 hosting a Jam of 5+ minutes',
  pg_temp.pts('c9000000-0000-0000-0000-000000000002', 'jam'), 5);

-- ── The nightly refresh ─────────────────────────────────────────────────────
select public.refresh_music_scores();
select pg_temp.assert_eq('#9 Lena''s score is the sum', pg_temp.score('c9000000-0000-0000-0000-000000000001'), 52 + 2 + 40 + 4 + 5);
select pg_temp.assert_eq('#9 Uday''s score is the sum', pg_temp.score('c9000000-0000-0000-0000-000000000002'), 25 + 3 + 5);
select pg_temp.assert_eq('#9 someone who did nothing has 0', pg_temp.score('c9000000-0000-0000-0000-000000000004'), 0);

-- Undo: Lena unlikes a post, Uday's song is taken down. The next refresh takes it back.
delete from post_likes where post_id = 'cb000000-0000-0000-0000-000000000001' and user_id = 'c9000000-0000-0000-0000-000000000001';
set local session_replication_role = replica;
update tracks set taken_down_at = now() where id = 'ca000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
select public.refresh_music_scores();
select pg_temp.assert_eq('#10 an unlike takes its point back', pg_temp.score('c9000000-0000-0000-0000-000000000001'), 102);
select pg_temp.assert_eq('#10 a take-down takes the upload and its plays back', pg_temp.score('c9000000-0000-0000-0000-000000000002'), 5);

-- ── Readable by the app, never writable ─────────────────────────────────────
select pg_temp.set_user('c9000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('#11 a signed-in user can read anyone''s score',
  (select score = 102 from music_scores where user_id = 'c9000000-0000-0000-0000-000000000001'), true);
reset role;

-- Across a block, a score is invisible (as the profile is): Lena blocks Omar.
insert into blocked_users (blocker_id, blocked_id) values
  ('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000003');
select pg_temp.set_user('c9000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('#11b someone Lena blocked cannot see her score',
  exists (select 1 from music_scores where user_id = 'c9000000-0000-0000-0000-000000000001'), false);
select pg_temp.assert('#11c but still sees everyone else''s, and their own',
  (select count(*) = 2 from music_scores
    where user_id in ('c9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000003')), true);
reset role;
select pg_temp.set_user('c9000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('#12 and cannot give themselves one', pg_temp.allows($$
  insert into music_scores (user_id, score) values ('c9000000-0000-0000-0000-000000000004', 9999)
  on conflict (user_id) do update set score = 9999$$), false);
-- Production revokes these grants (refused outright); the CI harness re-grants them, so
-- there RLS refuses by matching no row. Either way the rows must be unchanged.
select pg_temp.allows($$update music_scores set score = 9999 where user_id = 'c9000000-0000-0000-0000-000000000004'$$);
select pg_temp.allows($$delete from music_scores where user_id = 'c9000000-0000-0000-0000-000000000001'$$);
reset role;
select pg_temp.assert('#12 nor change or delete one',
  (select score = 0 from music_scores where user_id = 'c9000000-0000-0000-0000-000000000004')
  and exists (select 1 from music_scores where user_id = 'c9000000-0000-0000-0000-000000000001'), true);

-- Signed out: production revokes the table from anon (refused); under the CI harness's
-- grants RLS shows no row. Either way, nothing is visible.
create or replace function pg_temp.visible_scores()
returns bigint language plpgsql as $$
begin
  return (select count(*) from public.music_scores);
exception
  when insufficient_privilege then return 0;
end $$;
set local role anon;
select pg_temp.assert_eq('#13 signed out, no scores are visible', pg_temp.visible_scores(), 0);
reset role;

select pg_temp.assert('#14 the refresh runs every night',
  exists (select 1 from cron.job where jobname = 'refresh-music-scores'
          and command = 'select public.refresh_music_scores()'), true);

rollback;
