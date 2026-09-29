-- jam_suggestions + jam_room_members UPDATE tests (20260930000000_jam_suggestions.sql).
--
-- What must hold:
--   * a LISTENER can no longer change their own jam permissions (the jmem_update hole);
--   * a listener can suggest a post into their ACTIVE jam, only as themselves, only once
--     per song, and not when can_suggest is false;
--   * a non-member can neither suggest nor read; a member reads everyone's suggestions;
--   * only the HOST can mark a suggestion queued/played or dismiss it, and only `status`
--     can change;
--   * ending the jam deletes its suggestions.
--
-- Runs as `authenticated` against the deployed policies. Switching user redefines the
-- auth.uid() stub, which needs the superuser, hence the reset/set role around each switch.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/jam-suggestions.test.sql

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

create or replace function pg_temp.assert_int(label text, actual bigint, expected bigint)
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

-- Did the statement run without an RLS / privilege / raise refusal?
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege or unique_violation or raise_exception then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   HOST     — started the jam
--   RIYA     — listener
--   SAM      — listener with can_suggest = false
--   MALLORY  — not in the conversation or the jam
insert into auth.users (id) values
  ('a5111111-0000-0000-0000-000000000001'),
  ('a5111111-0000-0000-0000-000000000002'),
  ('a5111111-0000-0000-0000-000000000003'),
  ('a5111111-0000-0000-0000-000000000004')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('a5111111-0000-0000-0000-000000000001', 'js_host',    true),
  ('a5111111-0000-0000-0000-000000000002', 'js_riya',    true),
  ('a5111111-0000-0000-0000-000000000003', 'js_sam',     true),
  ('a5111111-0000-0000-0000-000000000004', 'js_mallory', true)
on conflict do nothing;

insert into conversations (id, kind, created_by) values
  ('a5222222-0000-0000-0000-000000000001', 'group', 'a5111111-0000-0000-0000-000000000001')
on conflict do nothing;

insert into conversation_members (conversation_id, user_id, role) values
  ('a5222222-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000001', 'admin'),
  ('a5222222-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000002', 'member'),
  ('a5222222-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000003', 'member')
on conflict do nothing;

insert into jam_rooms (id, conversation_id, host_id, status) values
  ('a5333333-0000-0000-0000-000000000001', 'a5222222-0000-0000-0000-000000000001',
   'a5111111-0000-0000-0000-000000000001', 'active')
on conflict do nothing;

insert into jam_room_members (jam_room_id, user_id, role, permissions) values
  ('a5333333-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000001', 'host',
   '{"can_play_pause":true,"can_seek":true,"can_skip":true,"can_change_track":true,"can_suggest":true}'),
  ('a5333333-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000002', 'listener',
   '{"can_play_pause":false,"can_seek":false,"can_skip":false,"can_change_track":false,"can_suggest":true}'),
  ('a5333333-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000003', 'listener',
   '{"can_play_pause":false,"can_seek":false,"can_skip":false,"can_change_track":false,"can_suggest":false}')
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('a5444444-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000001',
   'Beat It', 'audio', 'https://example.invalid/b.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('a5555555-0000-0000-0000-000000000001', 'a5111111-0000-0000-0000-000000000001',
   'upload', 'a5444444-0000-0000-0000-000000000001')
on conflict do nothing;

-- ============================================================================
-- 1. The jmem_update hole is closed
-- ============================================================================
reset role;
select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
update jam_room_members
   set permissions = '{"can_play_pause":true,"can_seek":true,"can_skip":true,"can_change_track":true,"can_suggest":true}',
       role = 'host'
 where jam_room_id = 'a5333333-0000-0000-0000-000000000001'
   and user_id = 'a5111111-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#1 a listener cannot grant themselves permissions or the host role',
  (select role = 'listener' and (permissions ->> 'can_seek')::boolean = false
     from jam_room_members
    where jam_room_id = 'a5333333-0000-0000-0000-000000000001'
      and user_id = 'a5111111-0000-0000-0000-000000000002'), true);

-- ============================================================================
-- 2. Suggesting
-- ============================================================================
select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert('#2 a listener can suggest a post into the active jam', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000002') $s$), true);
select pg_temp.assert('#2 the same person cannot suggest the same song twice', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000002') $s$), false);
select pg_temp.assert('#2 a listener cannot suggest as somebody else', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000001') $s$), false);
select pg_temp.assert('#2 a listener cannot insert an already-played suggestion', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by, status)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000003', 'played') $s$), false);
reset role;

select pg_temp.set_user('a5111111-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.assert('#2 a listener with can_suggest=false cannot suggest', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000003') $s$), false);
select pg_temp.assert_int('#2 but a member reads everyone''s suggestions',
  (select count(*) from jam_suggestions where jam_room_id = 'a5333333-0000-0000-0000-000000000001'), 1);
reset role;

select pg_temp.set_user('a5111111-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert('#2 a non-member cannot suggest', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000004') $s$), false);
select pg_temp.assert_int('#2 a non-member reads nothing',
  (select count(*) from jam_suggestions), 0);
reset role;

-- ============================================================================
-- 3. Only the host acts on a suggestion
-- ============================================================================
select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
update jam_suggestions set status = 'played'
 where jam_room_id = 'a5333333-0000-0000-0000-000000000001';
delete from jam_suggestions where jam_room_id = 'a5333333-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#3 a listener can neither mark nor delete (still waiting, still there)',
  (select status = 'waiting' from jam_suggestions
    where jam_room_id = 'a5333333-0000-0000-0000-000000000001'), true);

select pg_temp.set_user('a5111111-0000-0000-0000-000000000001');
set role authenticated;
update jam_suggestions set status = 'queued'
 where jam_room_id = 'a5333333-0000-0000-0000-000000000001'
   and post_id = 'a5555555-0000-0000-0000-000000000001';
select pg_temp.assert('#3 the host cannot re-attribute a suggestion', pg_temp.allows($s$
  update jam_suggestions set suggested_by = 'a5111111-0000-0000-0000-000000000001'
   where jam_room_id = 'a5333333-0000-0000-0000-000000000001' $s$), false);
reset role;
select pg_temp.assert('#3 the host marks it queued, with a server timestamp',
  (select status = 'queued' and status_at is not null from jam_suggestions
    where jam_room_id = 'a5333333-0000-0000-0000-000000000001'), true);

-- ============================================================================
-- 4. Ending the jam clears its suggestions, and an ended jam takes no more
-- ============================================================================
update jam_rooms set status = 'ended', ended_at = now()
 where id = 'a5333333-0000-0000-0000-000000000001';
select pg_temp.assert_int('#4 ending the jam deletes its suggestions',
  (select count(*) from jam_suggestions where jam_room_id = 'a5333333-0000-0000-0000-000000000001'), 0);

select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert('#4 nothing can be suggested into an ended jam', pg_temp.allows($s$
  insert into jam_suggestions (jam_room_id, post_id, suggested_by)
  values ('a5333333-0000-0000-0000-000000000001', 'a5555555-0000-0000-0000-000000000001',
          'a5111111-0000-0000-0000-000000000002') $s$), false);
reset role;

-- ============================================================================
-- 5. A jam ends itself when the host is away or silent
-- ============================================================================
insert into jam_rooms (id, conversation_id, host_id, status) values
  ('a5333333-0000-0000-0000-000000000002', 'a5222222-0000-0000-0000-000000000001',
   'a5111111-0000-0000-0000-000000000001', 'active');
insert into jam_room_members (jam_room_id, user_id, role) values
  ('a5333333-0000-0000-0000-000000000002', 'a5111111-0000-0000-0000-000000000001', 'host'),
  ('a5333333-0000-0000-0000-000000000002', 'a5111111-0000-0000-0000-000000000002', 'listener');

-- A listener's heartbeat is ignored; the host's is recorded.
select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
select jam_host_heartbeat('a5333333-0000-0000-0000-000000000002', true);
reset role;
select pg_temp.assert('#5 a listener cannot write the host heartbeat',
  (select host_clock_at is null from jam_rooms where id = 'a5333333-0000-0000-0000-000000000002'), true);

select pg_temp.set_user('a5111111-0000-0000-0000-000000000001');
set role authenticated;
select jam_host_heartbeat('a5333333-0000-0000-0000-000000000002', true);
reset role;

select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert('#5 a live jam does not end',
  jam_end_if_stale('a5333333-0000-0000-0000-000000000002'), false);
reset role;

select pg_temp.set_user('a5111111-0000-0000-0000-000000000004');
set role authenticated;
select pg_temp.assert('#5 a non-member learns nothing',
  jam_end_if_stale('a5333333-0000-0000-0000-000000000002') is null, true);
reset role;

-- Host silent for 4 minutes (app swiped away).
update jam_rooms set host_clock_at = now() - interval '4 minutes'
 where id = 'a5333333-0000-0000-0000-000000000002';
select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert('#5 a listener ends a jam whose host went away',
  jam_end_if_stale('a5333333-0000-0000-0000-000000000002'), true);
reset role;
select pg_temp.assert('#5 it is ended for everyone',
  (select status = 'ended' from jam_rooms where id = 'a5333333-0000-0000-0000-000000000002'), true);
select pg_temp.assert_int('#5 and the chat says so',
  (select count(*) from messages
    where conversation_id = 'a5222222-0000-0000-0000-000000000001'
      and kind = 'system' and metadata ->> 'reason' = 'host_away'), 1);

-- Host present but nothing played for 11 minutes.
insert into jam_rooms (id, conversation_id, host_id, status, host_clock_at, last_played_at) values
  ('a5333333-0000-0000-0000-000000000003', 'a5222222-0000-0000-0000-000000000001',
   'a5111111-0000-0000-0000-000000000001', 'active', now(), now() - interval '11 minutes');
insert into jam_room_members (jam_room_id, user_id, role) values
  ('a5333333-0000-0000-0000-000000000003', 'a5111111-0000-0000-0000-000000000002', 'listener');
select pg_temp.set_user('a5111111-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.assert('#5 an idle jam (nothing played for 10+ min) ends',
  jam_end_if_stale('a5333333-0000-0000-0000-000000000003'), true);
reset role;

rollback;
