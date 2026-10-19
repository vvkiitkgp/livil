-- Recently Played's Spotify half (20261108000000): my_recent_spotify_opens().
--
-- Pins: (1) it answers about the CALLER only — never anyone else's opens, nothing signed
-- out; (2) one row per song at its latest open, newest first, paged by p_before; (3) the
-- table itself stays unreadable (the function is not a crack in the write-only log);
-- (4) 'library' is a source, and the old ones still are.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/recent-spotify-opens.test.sql

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

-- See play-stats.test.sql: auth.uid() is inlined into cached plans.
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

insert into auth.users (id) values
  ('ae000000-0000-0000-0000-000000000001'),
  ('ae000000-0000-0000-0000-000000000002')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('ae000000-0000-0000-0000-000000000001', 'rs_riya', true),
  ('ae000000-0000-0000-0000-000000000002', 'rs_sam',  true)
on conflict do nothing;

-- Riya: song A three times, B once, C once; Sam: song D. created_at is forced to now() by
-- the server-time trigger, so the history is laid out as the table owner, trigger off.
alter table spotify_opens disable trigger spotify_opens_server_time;
insert into spotify_opens (spotify_track_id, source, user_id, created_at) values
  ('AAAAAAAAAAAAAAAAAAAAAA', 'feed',   'ae000000-0000-0000-0000-000000000001', '2026-10-01 10:00+00'),
  ('BBBBBBBBBBBBBBBBBBBBBB', 'chat',   'ae000000-0000-0000-0000-000000000001', '2026-10-02 10:00+00'),
  ('AAAAAAAAAAAAAAAAAAAAAA', 'search', 'ae000000-0000-0000-0000-000000000001', '2026-10-03 10:00+00'),
  ('CCCCCCCCCCCCCCCCCCCCCC', 'feed',   'ae000000-0000-0000-0000-000000000001', '2026-10-04 10:00+00'),
  ('AAAAAAAAAAAAAAAAAAAAAA', 'feed',   'ae000000-0000-0000-0000-000000000001', '2026-10-05 10:00+00'),
  ('DDDDDDDDDDDDDDDDDDDDDD', 'feed',   'ae000000-0000-0000-0000-000000000002', '2026-10-06 10:00+00');
alter table spotify_opens enable trigger spotify_opens_server_time;

-- ── 1–2. Riya's history, and only hers ─────────────────────────────────────
select pg_temp.set_user('ae000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('1a  each song once, at its latest open, newest first',
  (select array_agg(spotify_track_id || '@' || to_char(opened_at at time zone 'UTC', 'DD') order by opened_at desc)
     from my_recent_spotify_opens(10, null))
  = array['AAAAAAAAAAAAAAAAAAAAAA@05', 'CCCCCCCCCCCCCCCCCCCCCC@04', 'BBBBBBBBBBBBBBBBBBBBBB@02'], true);
select pg_temp.assert('1b  never another listener''s opens',
  not exists (select 1 from my_recent_spotify_opens(50, null)
               where spotify_track_id = 'DDDDDDDDDDDDDDDDDDDDDD'), true);
select pg_temp.assert('2a  a page stops at p_limit',
  (select count(*) = 2 from my_recent_spotify_opens(2, null)), true);
select pg_temp.assert('2b  the next page starts after the last one''s time',
  (select array_agg(spotify_track_id) = array['BBBBBBBBBBBBBBBBBBBBBB']
     from my_recent_spotify_opens(2, '2026-10-04 10:00+00')), true);
select pg_temp.assert('2c  p_limit is clamped (0 → 1, huge → 50)',
  (select count(*) = 1 from my_recent_spotify_opens(0, null))
  and (select count(*) = 3 from my_recent_spotify_opens(100000, null)), true);

-- ── 3. The table stays write-only ──────────────────────────────────────────
select pg_temp.assert('3a  the log itself is still unreadable, own rows included',
  (select count(*) = 0 from spotify_opens), true);

-- ── 4. Sources ──────────────────────────────────────────────────────────────
select pg_temp.assert('4a  a hand-off from Recently Played is logged as library',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('AAAAAAAAAAAAAAAAAAAAAA', 'library', 'ae000000-0000-0000-0000-000000000001')$q$), true);
select pg_temp.assert('4b  every source a shipped app sends still is',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id) values
    ('AAAAAAAAAAAAAAAAAAAAAA', 'feed',   'ae000000-0000-0000-0000-000000000001'),
    ('AAAAAAAAAAAAAAAAAAAAAA', 'chat',   'ae000000-0000-0000-0000-000000000001'),
    ('AAAAAAAAAAAAAAAAAAAAAA', 'search', 'ae000000-0000-0000-0000-000000000001')$q$), true);
select pg_temp.assert('4c  an unknown source is still refused',
  pg_temp.allows($q$insert into spotify_opens (spotify_track_id, source, user_id)
    values ('AAAAAAAAAAAAAAAAAAAAAA', 'billboard', 'ae000000-0000-0000-0000-000000000001')$q$), false);
reset role;

-- ── 1c. Signed out ──────────────────────────────────────────────────────────
-- Refused outright; and a session with no user (auth.uid() null) gets no rows.
set local role anon;
select pg_temp.assert('1c  a signed-out caller cannot run it',
  pg_temp.allows('select my_recent_spotify_opens(10, null)'), false);
reset role;
create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
discard plans;
set local role authenticated;
select pg_temp.assert('1d  no user → no rows',
  (select count(*) = 0 from my_recent_spotify_opens(10, null)), true);
reset role;

rollback;
