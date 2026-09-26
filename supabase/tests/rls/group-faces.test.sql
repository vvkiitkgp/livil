-- list_group_faces tests (20260925020000_group_faces.sql).
--
-- The group picture is up to six members' faces, most recent speaker first. What must
-- hold: only a MEMBER gets anything back; a group of seven returns six; the order is
-- "last spoke" (system rows and deleted messages do not count), then never-spoke members
-- by join order; DMs are not groups.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/group-faces.test.sql

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

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Seven members of GROUP (…01 is the viewer), plus OUTSIDER who is in no group.
insert into auth.users (id) values
  ('a7000000-0000-0000-0000-000000000001'),
  ('a7000000-0000-0000-0000-000000000002'),
  ('a7000000-0000-0000-0000-000000000003'),
  ('a7000000-0000-0000-0000-000000000004'),
  ('a7000000-0000-0000-0000-000000000005'),
  ('a7000000-0000-0000-0000-000000000006'),
  ('a7000000-0000-0000-0000-000000000007'),
  ('a7000000-0000-0000-0000-000000000099')
on conflict do nothing;

insert into profiles (id, username, username_set, avatar_url) values
  ('a7000000-0000-0000-0000-000000000001', 'gf_me',       true, null),
  ('a7000000-0000-0000-0000-000000000002', 'gf_riya',     true, 'https://example.invalid/riya.jpg'),
  ('a7000000-0000-0000-0000-000000000003', 'gf_arjun',    true, null),
  ('a7000000-0000-0000-0000-000000000004', 'gf_sam',      true, null),
  ('a7000000-0000-0000-0000-000000000005', 'gf_kiran',    true, null),
  ('a7000000-0000-0000-0000-000000000006', 'gf_meera',    true, null),
  ('a7000000-0000-0000-0000-000000000007', 'gf_priya',    true, null),
  ('a7000000-0000-0000-0000-000000000099', 'gf_outsider', true, null)
on conflict do nothing;

insert into conversations (id, kind, name) values
  ('b7000000-0000-0000-0000-000000000001', 'group', 'Weekend jam crew'),
  ('b7000000-0000-0000-0000-000000000002', 'dm',    null)
on conflict do nothing;

-- Join order is explicit: never-spoke members are ranked by it.
insert into conversation_members (conversation_id, user_id, joined_at) values
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', '2026-01-01 00:00:01+00'),
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002', '2026-01-01 00:00:02+00'),
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000003', '2026-01-01 00:00:03+00'),
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000004', '2026-01-01 00:00:04+00'),
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000005', '2026-01-01 00:00:05+00'),
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000006', '2026-01-01 00:00:06+00'),
  ('b7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000007', '2026-01-01 00:00:07+00'),
  ('b7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', '2026-01-01 00:00:01+00'),
  ('b7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000002', '2026-01-01 00:00:01+00')
on conflict do nothing;

-- Riya spoke last, then Arjun, then the viewer. Sam's newest row is DELETED and
-- Kiran's is a SYSTEM row — neither counts as speaking.
insert into messages (id, conversation_id, sender_id, kind, body, created_at, deleted_at) values
  ('c7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000001', 'text', 'hi',       '2026-02-01 10:00:00+00', null),
  ('c7000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000003', 'text', 'yo',       '2026-02-01 11:00:00+00', null),
  ('c7000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000002', 'text', 'tonight?', '2026-02-01 12:00:00+00', null),
  ('c7000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000004', 'text', 'oops',     '2026-02-01 13:00:00+00', now()),
  ('c7000000-0000-0000-0000-000000000005', 'b7000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000005', 'system', 'joined', '2026-02-01 14:00:00+00', null)
on conflict do nothing;

-- ============================================================================
-- Step 1 — a member gets six faces, in "last spoke" order
-- ============================================================================
select pg_temp.set_user('a7000000-0000-0000-0000-000000000001');
set local role authenticated;

create temp table faces on commit drop as
  select row_number() over () as pos, f.*
  from list_group_faces(array['b7000000-0000-0000-0000-000000000001'::uuid]) f;

select pg_temp.assert('a group of seven returns six faces',
  (select count(*) = 6 from faces), true);
select pg_temp.assert('the most recent speaker (Riya) is first, with her photo',
  (select username = 'gf_riya' and avatar_url = 'https://example.invalid/riya.jpg'
     from faces where pos = 1), true);
select pg_temp.assert('then Arjun, then the viewer — the viewer is included',
  (select array_agg(username order by pos) from faces where pos in (2, 3))
    = array['gf_arjun', 'gf_me'], true);
select pg_temp.assert('a DELETED message does not count as speaking (Sam ranks by join order)',
  (select last_sent_at is null from faces where username = 'gf_sam'), true);
select pg_temp.assert('a SYSTEM row does not count as speaking (Kiran ranks by join order)',
  (select last_sent_at is null from faces where username = 'gf_kiran'), true);
select pg_temp.assert('never-spoke members follow by join order; the last joiner is cut',
  (select array_agg(username order by pos) from faces where pos >= 4)
    = array['gf_sam', 'gf_kiran', 'gf_meera'], true);

select pg_temp.assert('a DM is not a group — nothing returned for it',
  (select count(*) = 0
     from list_group_faces(array['b7000000-0000-0000-0000-000000000002'::uuid])), true);
reset role;

-- ============================================================================
-- Step 2 — a non-member gets nothing
-- ============================================================================
select pg_temp.set_user('a7000000-0000-0000-0000-000000000099');
set local role authenticated;
select pg_temp.assert('a non-member gets no faces for someone else''s group',
  (select count(*) = 0
     from list_group_faces(array['b7000000-0000-0000-0000-000000000001'::uuid])), true);
reset role;

-- ============================================================================
-- Step 3 — surface
-- ============================================================================
select pg_temp.assert('anon CANNOT execute list_group_faces',
  has_function_privilege('anon', 'public.list_group_faces(uuid[])', 'EXECUTE'), false);
select pg_temp.assert('list_group_faces is SECURITY INVOKER (RLS is the boundary)',
  (select not prosecdef from pg_proc where oid = 'public.list_group_faces(uuid[])'::regprocedure),
  true);

rollback;
