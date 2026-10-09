-- Spotify reposts (20261013000000, ADR-0027).
--
-- A Spotify repost is a `posts` row with no track_id and a spotify_track_id. These tests pin
-- the four properties the migration exists for:
--
--   1. SHAPE — exactly one media source; a Spotify post is a repost of nothing in Livil and
--      has no clip; the id is a real Spotify id.
--   2. SAME RULES AS A REPOST — friends see it, strangers do not; friends can like and
--      comment on it; only the author can delete it.
--   3. IDENTITY — the song cannot be swapped after the fact.
--   4. NEVER LIVIL MEDIA — it cannot enter a playlist, a Jam, or the play counters.
--
-- Writes run as `authenticated` against the deployed policies, so the database decides.
-- Every denial is paired with a row count, because a raise alone does not prove absence.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/spotify-reposts.test.sql

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

create or replace function pg_temp.assert_count(label text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected % row(s), got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- True when the statement succeeded; false when the database refused it for ANY reason
-- (RLS, a CHECK, a trigger). SECURITY INVOKER, so `set local role` is respected.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when others then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- REPOSTER and FRIEND are friends. STRANGER is not.
insert into auth.users (id) values
  ('c5000000-0000-0000-0000-000000000001'),  -- REPOSTER
  ('c5000000-0000-0000-0000-000000000002'),  -- FRIEND
  ('c5000000-0000-0000-0000-000000000003')   -- STRANGER
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('c5000000-0000-0000-0000-000000000001', 'sp_reposter', true),
  ('c5000000-0000-0000-0000-000000000002', 'sp_friend',   true),
  ('c5000000-0000-0000-0000-000000000003', 'sp_stranger', true)
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002',
   'accepted', 'c5000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('d5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002',
   'friend track', 'audio', 'https://example.invalid/f.mp3')
on conflict do nothing;

-- A normal Livil upload by FRIEND, to prove Livil posts are unaffected.
insert into posts (id, author_id, kind, track_id) values
  ('e5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002',
   'upload', 'd5000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into playlists (id, user_id, name) values
  ('f5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'mine')
on conflict do nothing;

-- ── 0. The switch ───────────────────────────────────────────────────────────
-- Off by default: the database itself refuses a Spotify repost, whatever the client sends.
update app_switches set enabled = false where key = 'spotify_reposts';
select pg_temp.set_user('c5000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('0a  switched OFF: the app is told it is off',
  spotify_reposts_enabled(), false);
select pg_temp.assert('0b  switched OFF: a direct insert is refused',
  pg_temp.allows($q$insert into posts (author_id, kind, spotify_track_id)
    values ('c5000000-0000-0000-0000-000000000001', 'repost', '0VjIjW4GlUZAMYd2vXMi3b')$q$), false);
-- Whether these RAISE depends on table grants (production revokes them; the CI harness
-- re-grants everything after the migrations), so assert the outcome instead: RLS with no
-- policies means a client sees no row and changes no row either way.
select pg_temp.assert_count('0c  clients cannot read the switch table directly',
  (select count(*) from (select 1 from app_switches) x), 0);
select pg_temp.allows($q$update app_switches set enabled = true where key = 'spotify_reposts'$q$);
reset role;
select pg_temp.assert_count('0   nothing was stored while OFF',
  (select count(*) from posts where author_id = 'c5000000-0000-0000-0000-000000000001'), 0);
select pg_temp.assert_count('0d  … and the switch is still off',
  (select count(*) from app_switches where key = 'spotify_reposts' and not enabled), 1);

update app_switches set enabled = true where key = 'spotify_reposts';

-- ── 1. Shape ────────────────────────────────────────────────────────────────
select pg_temp.set_user('c5000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('1   switched ON: the app is told it is on', spotify_reposts_enabled(), true);

select pg_temp.assert('1a  a well-formed Spotify repost is accepted',
  pg_temp.allows($q$insert into posts (id, author_id, kind, spotify_track_id, caption)
    values ('e5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000001',
            'repost', '0VjIjW4GlUZAMYd2vXMi3b', 'on repeat')$q$), true);

select pg_temp.assert('1b  an id that is not a Spotify id is refused',
  pg_temp.allows($q$insert into posts (author_id, kind, spotify_track_id)
    values ('c5000000-0000-0000-0000-000000000001', 'repost', 'not-a-spotify-id')$q$), false);

select pg_temp.assert('1c  a URL in the id column is refused',
  pg_temp.allows($q$insert into posts (author_id, kind, spotify_track_id)
    values ('c5000000-0000-0000-0000-000000000001', 'repost',
            'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b')$q$), false);

select pg_temp.assert('1d  a post with BOTH a Livil track and a Spotify track is refused',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, spotify_track_id)
    values ('c5000000-0000-0000-0000-000000000001', 'repost',
            'd5000000-0000-0000-0000-000000000001', '0VjIjW4GlUZAMYd2vXMi3b')$q$), false);

select pg_temp.assert('1e  a post with NEITHER is refused',
  pg_temp.allows($q$insert into posts (author_id, kind)
    values ('c5000000-0000-0000-0000-000000000001', 'repost')$q$), false);

select pg_temp.assert('1f  a Spotify UPLOAD is refused (Spotify songs are only ever reposts)',
  pg_temp.allows($q$insert into posts (author_id, kind, spotify_track_id)
    values ('c5000000-0000-0000-0000-000000000001', 'upload', '0VjIjW4GlUZAMYd2vXMi3b')$q$), false);

select pg_temp.assert('1g  a Spotify repost pointing at a Livil original is refused',
  pg_temp.allows($q$insert into posts (author_id, kind, spotify_track_id, original_post_id)
    values ('c5000000-0000-0000-0000-000000000001', 'repost', '0VjIjW4GlUZAMYd2vXMi3b',
            'e5000000-0000-0000-0000-000000000001')$q$), false);

select pg_temp.assert('1h  a Spotify repost with a clip window is refused',
  pg_temp.allows($q$insert into posts (author_id, kind, spotify_track_id, clip_start_sec, clip_end_sec)
    values ('c5000000-0000-0000-0000-000000000001', 'repost', '0VjIjW4GlUZAMYd2vXMi3b', 10, 40)$q$), false);

select pg_temp.assert('1i  an ordinary Livil repost still works',
  pg_temp.allows($q$insert into posts (author_id, kind, track_id, original_post_id)
    values ('c5000000-0000-0000-0000-000000000001', 'repost',
            'd5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001')$q$), true);

reset role;
select pg_temp.assert_count('1   only the two valid reposts by REPOSTER were stored',
  (select count(*) from posts where author_id = 'c5000000-0000-0000-0000-000000000001'), 2);

-- ── 2. Same rules as a repost ───────────────────────────────────────────────
select pg_temp.set_user('c5000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('2a  a FRIEND sees the Spotify repost',
  (select count(*) from posts where id = 'e5000000-0000-0000-0000-0000000000a1'), 1);
select pg_temp.assert('2b  a FRIEND can like it',
  pg_temp.allows($q$insert into post_likes (post_id, user_id)
    values ('e5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000002')$q$), true);
select pg_temp.assert('2c  a FRIEND can comment on it',
  pg_temp.allows($q$insert into post_comments (post_id, author_id, body)
    values ('e5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000002', 'tune')$q$), true);
select pg_temp.assert('2d  a FRIEND''s delete runs but removes nothing',
  pg_temp.allows($q$delete from posts where id = 'e5000000-0000-0000-0000-0000000000a1'$q$), true);
reset role;
select pg_temp.assert_count('2d  … and it is still there',
  (select count(*) from posts where id = 'e5000000-0000-0000-0000-0000000000a1'), 1);
select pg_temp.assert_count('2b  the like counter moved',
  (select likes_count from posts where id = 'e5000000-0000-0000-0000-0000000000a1'), 1);

-- A Spotify repost follows the reposter's audience switch like any repost
-- (20261019000000, ADR-0028): everyone by default, friends only when switched off.
select pg_temp.set_user('c5000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('2e  a STRANGER sees it while the reposter shows reposts to everyone (the default)',
  (select count(*) from posts where id = 'e5000000-0000-0000-0000-0000000000a1'), 1);
reset role;
update profiles set reposts_public = false where id = 'c5000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.assert_count('2f  … and does not once the reposter switches to friends only',
  (select count(*) from posts where id = 'e5000000-0000-0000-0000-0000000000a1'), 0);
reset role;
update profiles set reposts_public = true where id = 'c5000000-0000-0000-0000-000000000001';

-- ── 3. Identity ─────────────────────────────────────────────────────────────
select pg_temp.set_user('c5000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('3a  the author can edit the caption',
  pg_temp.allows($q$update posts set caption = 'still on repeat'
    where id = 'e5000000-0000-0000-0000-0000000000a1'$q$), true);
select pg_temp.assert('3b  the author cannot swap the song',
  pg_temp.allows($q$update posts set spotify_track_id = '4uLU6hMCjMI75M1A2tKUQC'
    where id = 'e5000000-0000-0000-0000-0000000000a1'$q$), false);
reset role;
select pg_temp.assert_count('3b  … and the song is unchanged',
  (select count(*) from posts where id = 'e5000000-0000-0000-0000-0000000000a1'
     and spotify_track_id = '0VjIjW4GlUZAMYd2vXMi3b' and caption = 'still on repeat'), 1);

-- ── 4. Never Livil media ────────────────────────────────────────────────────
-- Triggers, not policies, so these run as the table owner: no role can get past them.
select pg_temp.assert('4a  a Spotify repost cannot go into a playlist',
  pg_temp.allows($q$insert into playlist_posts (playlist_id, post_id)
    values ('f5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-0000000000a1')$q$), false);
select pg_temp.assert('4b  a Livil post still can',
  pg_temp.allows($q$insert into playlist_posts (playlist_id, post_id)
    values ('f5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001')$q$), true);

select pg_temp.assert('4c  a Spotify repost cannot be counted as a Livil play',
  pg_temp.allows($q$insert into post_views (post_id, user_id)
    values ('e5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000002')$q$), false);
select pg_temp.assert('4d  a Livil play still records, and lands in recently played',
  pg_temp.allows($q$insert into post_views (post_id, user_id)
    values ('e5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002')$q$), true);
select pg_temp.assert_count('4d  … recently played has the Livil track only',
  (select count(*) from user_recent_tracks where user_id = 'c5000000-0000-0000-0000-000000000002'), 1);

insert into jam_rooms (id, host_id) values
  ('a5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001');
select pg_temp.assert('4e  a Spotify repost cannot be suggested into a Jam',
  pg_temp.allows($q$insert into jam_suggestions (jam_room_id, post_id, suggested_by)
    values ('a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-0000000000a1',
            'c5000000-0000-0000-0000-000000000001')$q$), false);

select pg_temp.assert_count('4   nothing Spotify reached playlists, plays or Jam',
  (select count(*) from playlist_posts where post_id = 'e5000000-0000-0000-0000-0000000000a1')
  + (select count(*) from post_views where post_id = 'e5000000-0000-0000-0000-0000000000a1')
  + (select count(*) from jam_suggestions where post_id = 'e5000000-0000-0000-0000-0000000000a1'), 0);

-- ── 5. The home feed returns it to a friend, track-less ─────────────────────
select pg_temp.set_user('c5000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('5a  the friend''s feed includes the Spotify repost with no track',
  exists (select 1 from fetch_home_feed(50) f
           where f.post_id = 'e5000000-0000-0000-0000-0000000000a1'
             and f.post -> 'track' = 'null'::jsonb), true);
reset role;

rollback;
