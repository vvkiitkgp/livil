-- listen_sessions / list_listening_now tests (20260925000000_listening_now.sql).
--
-- The chat "now playing" indicator. What must hold:
--   * a listener writes ONLY their own row, and `updated_at` is the server's clock,
--     whatever the client sends — liveness is judged against it;
--   * the audience is ACCEPTED FRIENDS only — not people who merely star the listener
--     (a star needs no approval) — and the "Show what I'm listening to" switch (show_activity) is
--     enforced HERE, not only in the client;
--   * list_listening_now returns only LIVE rows: a pause (playing = false) or a
--     missed heartbeat hides the listener.
--
-- Runs as `authenticated` against the deployed policies. Every denial is paired with a
-- read of the stored row where a silent USING filter could otherwise pass as a denial.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/listening-now.test.sql

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

-- Like allows(), for CHECK constraints rather than RLS.
create or replace function pg_temp.allows_check(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when check_violation then return false;
end $$;

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   OWNER    — the listener (show_activity = true)
--   FRIEND   — accepted friend of OWNER and of SHY
--   STAR     — stars OWNER, not a friend (must NOT see it)
--   STRANGER — no relationship to anyone
--   SHY      — a listener who turned "Show what I'm listening to" OFF
insert into auth.users (id) values
  ('e1111111-0000-0000-0000-000000000001'),
  ('e1111111-0000-0000-0000-000000000002'),
  ('e1111111-0000-0000-0000-000000000003'),
  ('e1111111-0000-0000-0000-000000000004'),
  ('e1111111-0000-0000-0000-000000000005')
on conflict do nothing;

insert into profiles (id, username, username_set, show_activity) values
  ('e1111111-0000-0000-0000-000000000001', 'ln_owner',    true, true),
  ('e1111111-0000-0000-0000-000000000002', 'ln_friend',   true, true),
  ('e1111111-0000-0000-0000-000000000003', 'ln_star',     true, true),
  ('e1111111-0000-0000-0000-000000000004', 'ln_stranger', true, true),
  ('e1111111-0000-0000-0000-000000000005', 'ln_shy',      true, false)
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('e1111111-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000002',
   'accepted', 'e1111111-0000-0000-0000-000000000001', now()),
  ('e1111111-0000-0000-0000-000000000002', 'e1111111-0000-0000-0000-000000000005',
   'accepted', 'e1111111-0000-0000-0000-000000000002', now())
on conflict do nothing;

insert into follows (follower_id, following_id, kind) values
  ('e1111111-0000-0000-0000-000000000003', 'e1111111-0000-0000-0000-000000000001', 'star')
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url, cover_art_url) values
  ('e2222222-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000001',
   'Kesariya', 'audio', 'https://example.invalid/k.mp3', 'https://example.invalid/k.jpg')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('e3333333-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000001',
   'upload', 'e2222222-0000-0000-0000-000000000001')
on conflict do nothing;

-- SHY's row is inserted by the table owner: the point is who can READ it.
insert into listen_sessions (user_id, track_title, artist_name, playing) values
  ('e1111111-0000-0000-0000-000000000005', 'Secret song', 'Someone', true)
on conflict do nothing;

-- ============================================================================
-- Step 1 — the listener starts playing: their own upsert is allowed
-- ============================================================================
-- The exact statement shape the client sends (INSERT … ON CONFLICT DO UPDATE), twice,
-- so both the insert path and the conflict/update path are exercised. A client-sent
-- updated_at in the year 2000 must be overwritten with the server's clock.
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert(
  'owner CAN insert their own listening row',
  pg_temp.allows($$
    insert into listen_sessions (user_id, track_title, artist_name, post_id, playing, updated_at)
    values ('e1111111-0000-0000-0000-000000000001', 'Kesariya', 'ln_owner',
            'e3333333-0000-0000-0000-000000000001', true, '2000-01-01')
    on conflict (user_id) do update
      set track_title = excluded.track_title, artist_name = excluded.artist_name,
          post_id = excluded.post_id, playing = excluded.playing,
          updated_at = excluded.updated_at$$),
  true);
select pg_temp.assert(
  'owner CAN upsert it again (conflict path)',
  pg_temp.allows($$
    insert into listen_sessions (user_id, track_title, artist_name, post_id, playing, updated_at)
    values ('e1111111-0000-0000-0000-000000000001', 'Kesariya', 'ln_owner',
            'e3333333-0000-0000-0000-000000000001', true, '2000-01-01')
    on conflict (user_id) do update
      set track_title = excluded.track_title, artist_name = excluded.artist_name,
          post_id = excluded.post_id, playing = excluded.playing,
          updated_at = excluded.updated_at$$),
  true);
reset role;
select pg_temp.assert(
  'updated_at is the SERVER clock, not the client-sent 2000-01-01',
  (select updated_at > now() - interval '1 minute'
     from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000001'),
  true);

-- ============================================================================
-- Step 2 — nobody can write someone else's status
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert(
  'stranger CANNOT insert a row for another user',
  pg_temp.allows($$
    insert into listen_sessions (user_id, track_title, artist_name, playing)
    values ('e1111111-0000-0000-0000-000000000003', 'Forged', 'Forged', true)$$),
  false);
-- An UPDATE filtered out by USING raises nothing, so read the row back.
select pg_temp.allows($$
  update listen_sessions set track_title = 'Hijacked'
  where user_id = 'e1111111-0000-0000-0000-000000000001'$$);
reset role;
select pg_temp.assert(
  'and the owner''s row was not changed by the stranger''s UPDATE',
  (select track_title = 'Kesariya' from listen_sessions
    where user_id = 'e1111111-0000-0000-0000-000000000001'),
  true);

-- ============================================================================
-- Step 3 — the audience: friend + star see it, a stranger does not
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('friend sees the owner''s row',
  (select count(*) from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000001'), 1);
select pg_temp.assert_count('friend gets the owner from list_listening_now',
  (select count(*) from list_listening_now(array['e1111111-0000-0000-0000-000000000001'::uuid])), 1);
select pg_temp.assert('…with the post to open and its cover art',
  (select post_id = 'e3333333-0000-0000-0000-000000000001'
          and cover_art_url = 'https://example.invalid/k.jpg'
          and expires_in between 1 and 150
     from list_listening_now(array['e1111111-0000-0000-0000-000000000001'::uuid])),
  true);
reset role;

select pg_temp.set_user('e1111111-0000-0000-0000-000000000003');
set local role authenticated;
-- A star needs no approval, so admitting stars would let any stranger watch.
select pg_temp.assert_count('someone who only STARS the owner does NOT see it',
  (select count(*) from list_listening_now(array['e1111111-0000-0000-0000-000000000001'::uuid])), 0);
select pg_temp.assert_count('…nor the row itself',
  (select count(*) from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000001'), 0);
reset role;

select pg_temp.set_user('e1111111-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert_count('stranger CANNOT see the owner''s row',
  (select count(*) from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000001'), 0);
select pg_temp.assert_count('stranger gets nothing from list_listening_now',
  (select count(*) from list_listening_now(array['e1111111-0000-0000-0000-000000000001'::uuid])), 0);
reset role;

-- ============================================================================
-- Step 4 — "Show what I'm listening to" OFF is enforced by the database
-- ============================================================================
-- Before this migration only the client checked show_activity; a friend's direct
-- select returned SHY's song regardless of the switch.
select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('a FRIEND cannot see a listener who turned listening visibility off',
  (select count(*) from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000005'), 0);
reset role;

select pg_temp.set_user('e1111111-0000-0000-0000-000000000005');
set local role authenticated;
select pg_temp.assert_count('…but that listener still sees their own row (the upsert needs it)',
  (select count(*) from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000005'), 1);
reset role;

-- ============================================================================
-- Step 5 — a pause hides the listener immediately
-- ============================================================================
select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
update listen_sessions set playing = false
  where user_id = 'e1111111-0000-0000-0000-000000000001';
reset role;

select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('after PAUSE the friend gets nothing from list_listening_now',
  (select count(*) from list_listening_now(array['e1111111-0000-0000-0000-000000000001'::uuid])), 0);
-- The audience can still SELECT the row itself, so a paused row must say nothing:
-- no track, no post, and no pause time (updated_at is the epoch, not now()).
select pg_temp.assert('…and the paused row a friend CAN still read reveals nothing',
  (select track_title = '' and artist_name = '' and post_id is null
          and updated_at = 'epoch'::timestamptz
     from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert_count('list_friend_listen_stories does not return a paused listener',
  (select count(*) from list_friend_listen_stories()
    where user_id = 'e1111111-0000-0000-0000-000000000001'), 0);
reset role;

select pg_temp.set_user('e1111111-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert(
  'a title longer than 200 characters is refused',
  (select not pg_temp.allows_check($$
    update listen_sessions set playing = true, track_title = repeat('x', 201)
    where user_id = 'e1111111-0000-0000-0000-000000000001'$$)),
  true);
reset role;

-- ============================================================================
-- Step 6 — a missed heartbeat hides the listener too
-- ============================================================================
-- The app died mid-song: playing is still true but nothing has re-stamped the row.
-- The trigger would stamp now() on this UPDATE, so it is bypassed for the fixture.
alter table listen_sessions disable trigger listen_sessions_stamp;
update listen_sessions
   set playing = true, track_title = 'Kesariya', artist_name = 'ln_owner',
       updated_at = now() - interval '151 seconds'
 where user_id = 'e1111111-0000-0000-0000-000000000001';
alter table listen_sessions enable trigger listen_sessions_stamp;

select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('a row not re-stamped for >150s is NOT live',
  (select count(*) from list_listening_now(array['e1111111-0000-0000-0000-000000000001'::uuid])), 0);
reset role;

-- ============================================================================
-- Step 7 — the inbox never reveals "app open", only "listening"
-- ============================================================================
-- Product rule: whether someone has the app open must not be indicated in any way.
-- list_my_conversations().other_user_online used to be `last_seen_at > now() - 3 min`;
-- the Play Store build still draws a green dot from it. OWNER is made "app open"
-- (last_seen_at = now) but NOT playing — the old definition returns true here.
insert into conversations (id, kind) values
  ('e4444444-0000-0000-0000-000000000001', 'dm')
on conflict do nothing;
insert into conversation_members (conversation_id, user_id) values
  ('e4444444-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000001'),
  ('e4444444-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000002')
on conflict do nothing;
update profiles set last_seen_at = now()
  where id = 'e1111111-0000-0000-0000-000000000001';
update listen_sessions set playing = false
  where user_id = 'e1111111-0000-0000-0000-000000000001';

select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('app OPEN but not playing → inbox shows nothing',
  (select other_user_online from list_my_conversations()
    where id = 'e4444444-0000-0000-0000-000000000001'),
  false);
reset role;

update listen_sessions set playing = true
  where user_id = 'e1111111-0000-0000-0000-000000000001';

select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('playing → inbox shows the listening indicator',
  (select other_user_online from list_my_conversations()
    where id = 'e4444444-0000-0000-0000-000000000001'),
  true);
reset role;

-- The DM outlives the friendship (membership rows are never removed), and the inbox
-- function is SECURITY DEFINER, so the audience rule must be applied inside it.
delete from friendships
  where user_a_id = 'e1111111-0000-0000-0000-000000000001'
    and user_b_id = 'e1111111-0000-0000-0000-000000000002';

select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('an UNFRIENDED DM partner does not see the listening indicator',
  (select other_user_online from list_my_conversations()
    where id = 'e4444444-0000-0000-0000-000000000001'),
  false);
reset role;

-- Blocked: restore the friendship, then have the OWNER block the friend directly (the
-- block_user RPC would also sever the friendship, which the step above already covers;
-- this isolates is_blocked_between).
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('e1111111-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000002',
   'accepted', 'e1111111-0000-0000-0000-000000000001', now());
insert into blocked_users (blocker_id, blocked_id) values
  ('e1111111-0000-0000-0000-000000000001', 'e1111111-0000-0000-0000-000000000002');

select pg_temp.set_user('e1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('a BLOCKED DM partner does not see the listening indicator',
  (select other_user_online from list_my_conversations()
    where id = 'e4444444-0000-0000-0000-000000000001'),
  false);
select pg_temp.assert_count('…nor the row itself',
  (select count(*) from listen_sessions where user_id = 'e1111111-0000-0000-0000-000000000001'), 0);
reset role;

-- ============================================================================
-- Step 8 — surface: anon cannot call the read path; realtime carries the table
-- ============================================================================
select pg_temp.assert('anon CANNOT execute list_listening_now',
  has_function_privilege('anon', 'public.list_listening_now(uuid[])', 'EXECUTE'), false);
select pg_temp.assert('anon CANNOT execute can_see_listening',
  has_function_privilege('anon', 'public.can_see_listening(uuid)', 'EXECUTE'), false);
select pg_temp.assert('listen_sessions is in the supabase_realtime publication',
  exists (select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and tablename = 'listen_sessions'),
  true);

rollback;
