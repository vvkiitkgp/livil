-- Play stats (20261014000000): the Spotify hand-off log and the ops readers.
--
-- Pins: (1) clients can only WRITE their own hand-offs, never read any; (2) the readers
-- answer ops and nobody else; (3) the numbers are right, people counted distinctly;
-- (4) no reader exposes who listened.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/play-stats.test.sql

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

create or replace function pg_temp.assert_count(label text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- SECURITY DEFINER + DISCARD PLANS: auth.uid() and is_ops() are inlined into cached
-- plpgsql plans, so without the discard every later call still sees the FIRST user (see
-- search-analytics.test.sql for the full story — a harness property, not the product's).
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  execute 'discard plans';
end $$;

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when others then return false;
end $$;

grant usage on schema auth to authenticated;

-- OPS, and two listeners.
insert into auth.users (id) values
  ('ab000000-0000-0000-0000-000000000001'),
  ('ab000000-0000-0000-0000-000000000002'),
  ('ab000000-0000-0000-0000-000000000003')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('ab000000-0000-0000-0000-000000000001', 'ps_ops',   true),
  ('ab000000-0000-0000-0000-000000000002', 'ps_riya',  true),
  ('ab000000-0000-0000-0000-000000000003', 'ps_sam',   true)
on conflict do nothing;
insert into ops_users (user_id) values ('ab000000-0000-0000-0000-000000000001') on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('ac000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000002',
   'Monsoon Letters', 'audio', 'https://example.invalid/m.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id) values
  ('ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000002',
   'upload', 'ac000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- Livil: riya plays twice, sam once → 3 plays, 2 people.
insert into post_views (post_id, user_id) values
  ('ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000002'),
  ('ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000002'),
  ('ad000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000003');

-- ── 1. Write-only, own rows only ────────────────────────────────────────────
select pg_temp.set_user('ab000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('1a  a listener logs their own hand-off',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('0VjIjW4GlUZAMYd2vXMi3b', 'feed', 'ab000000-0000-0000-0000-000000000002')$q$), true);
select pg_temp.assert('1b  …and again from chat',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('0VjIjW4GlUZAMYd2vXMi3b', 'chat', 'ab000000-0000-0000-0000-000000000002')$q$), true);
select pg_temp.assert('1c  cannot log a hand-off as someone else',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('0VjIjW4GlUZAMYd2vXMi3b', 'feed', 'ab000000-0000-0000-0000-000000000003')$q$), false);
select pg_temp.assert('1d  a malformed track id is refused',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('https://open.spotify.com/track/x', 'feed', 'ab000000-0000-0000-0000-000000000002')$q$), false);
select pg_temp.assert('1e  an unknown source is refused',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('0VjIjW4GlUZAMYd2vXMi3b', 'billboard', 'ab000000-0000-0000-0000-000000000002')$q$), false);
select pg_temp.assert_count('1f  a listener cannot read the log, not even their own rows',
  (select count(*) from (select 1 from spotify_opens) x), 0);
reset role;

select pg_temp.set_user('ab000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('1g  sam logs one hand-off',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('0VjIjW4GlUZAMYd2vXMi3b', 'search', 'ab000000-0000-0000-0000-000000000003')$q$), true);

-- ── 2. Ops only ─────────────────────────────────────────────────────────────
select pg_temp.assert_count('2a  a non-ops caller gets nothing from the summary',
  (select count(*) from ops_play_summary(30)), 0);
select pg_temp.assert_count('2b  …nothing from the daily series',
  (select count(*) from ops_play_daily(7)), 0);
select pg_temp.assert_count('2c  …nothing from top played',
  (select count(*) from ops_top_played('spotify', 30, 10)), 0);
select pg_temp.assert_count('2d  …nothing from recent plays',
  (select count(*) from ops_recent_plays(25)), 0);
reset role;

-- ── 3. The numbers ──────────────────────────────────────────────────────────
select pg_temp.set_user('ab000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('3a  summary: 3 Livil plays by 2 people, 3 Spotify opens by 2 people',
  (select livil_plays = 3 and livil_people = 2 and spotify_opens = 3 and spotify_people = 2
     from ops_play_summary(30)), true);
select pg_temp.assert_count('3b  daily: one row per day, zero-filled',
  (select count(*) from ops_play_daily(7)), 7);
select pg_temp.assert('3c  daily: today carries today''s plays',
  (select livil_plays = 3 and spotify_opens = 3 from ops_play_daily(7)
    order by day desc limit 1), true);
select pg_temp.assert('3d  top Spotify: the song, 2 people, 3 opens, no title stored',
  (select entity_id = '0VjIjW4GlUZAMYd2vXMi3b' and people = 2 and plays = 3 and title is null
     from ops_top_played('spotify', 30, 10)), true);
select pg_temp.assert('3e  top Livil: titled from the database, by its uploader',
  (select title = 'Monsoon Letters' and subtitle = '@ps_riya' and people = 2 and plays = 3
     from ops_top_played('livil', 30, 10)), true);
select pg_temp.assert_count('3f  recent: both sources, newest first',
  (select count(*) from ops_recent_plays(25)), 6);
reset role;

-- ── 4. No reader names a listener ───────────────────────────────────────────
select pg_temp.assert_count('4   no ops_play_* / ops_recent_plays output column is a user or username',
  (select count(*)
     from pg_proc p
     cross join lateral unnest(p.proargnames) as a(name)
    where p.proname in ('ops_play_summary', 'ops_play_daily', 'ops_top_played', 'ops_recent_plays')
      and a.name ~* '(user|username|listener|author)'), 0);

rollback;
