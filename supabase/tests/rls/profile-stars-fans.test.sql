-- list_profile_stars / list_my_fans tests (20260930020000_profile_stars_and_my_fans.sql).
--
-- Stars are public to any signed-in viewer; fans are listable by their OWNER only. What
-- must hold: a stranger sees someone's stars; list_my_fans returns the caller's fans and
-- cannot be aimed at anyone else; a blocked pair gets no stars; anyone blocked with the
-- viewer is left out of both lists.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/profile-stars-fans.test.sql

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
--   …01 RIYA     the listener being viewed
--   …02 ARTIST1  starred by Riya first
--   …03 ARTIST2  starred by Riya later
--   …04 VIEWER   a stranger
--   …05 BLOCKY   starred by Riya, but BLOCKY blocked VIEWER
--   …06 BLOCKER  a stranger who blocked Riya
--   …07 EXFAN    stars ARTIST1, then ARTIST1 blocked them (row left in place on purpose)
insert into auth.users (id) values
  ('a9000000-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-000000000002'),
  ('a9000000-0000-0000-0000-000000000003'),
  ('a9000000-0000-0000-0000-000000000004'),
  ('a9000000-0000-0000-0000-000000000005'),
  ('a9000000-0000-0000-0000-000000000006'),
  ('a9000000-0000-0000-0000-000000000007')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('a9000000-0000-0000-0000-000000000001', 'sf_riya',    true),
  ('a9000000-0000-0000-0000-000000000002', 'sf_artist1', true),
  ('a9000000-0000-0000-0000-000000000003', 'sf_artist2', true),
  ('a9000000-0000-0000-0000-000000000004', 'sf_viewer',  true),
  ('a9000000-0000-0000-0000-000000000005', 'sf_blocky',  true),
  ('a9000000-0000-0000-0000-000000000006', 'sf_blocker', true),
  ('a9000000-0000-0000-0000-000000000007', 'sf_exfan',   true)
on conflict do nothing;

insert into follows (follower_id, following_id, kind, created_at) values
  -- Riya's stars
  ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002', 'star', '2026-01-01 00:00:00+00'),
  ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003', 'star', '2026-03-01 00:00:00+00'),
  ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000005', 'star', '2026-02-01 00:00:00+00'),
  -- ARTIST1's fans: Riya and the viewer
  ('a9000000-0000-0000-0000-000000000004', 'a9000000-0000-0000-0000-000000000002', 'star', '2026-04-01 00:00:00+00'),
  -- Inserted directly, bypassing block_user (which would delete it), so the row
  -- survives the block below and only list_my_fans' own filter can hide it.
  ('a9000000-0000-0000-0000-000000000007', 'a9000000-0000-0000-0000-000000000002', 'star', '2026-05-01 00:00:00+00')
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('a9000000-0000-0000-0000-000000000005', 'a9000000-0000-0000-0000-000000000004'),
  ('a9000000-0000-0000-0000-000000000006', 'a9000000-0000-0000-0000-000000000001'),
  ('a9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000007')
on conflict do nothing;

-- ============================================================================
-- Step 1 — stars are public, newest first, minus anyone blocked with the viewer
-- ============================================================================
select pg_temp.set_user('a9000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('an unblocked viewer sees all of Riya''s stars, newest first',
  (select array_agg(username) from list_profile_stars('a9000000-0000-0000-0000-000000000001'))
    = array['sf_artist2', 'sf_blocky', 'sf_artist1'], true);
reset role;

select pg_temp.set_user('a9000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('a stranger sees Riya''s stars, minus the one who blocked them',
  (select array_agg(username) from list_profile_stars('a9000000-0000-0000-0000-000000000001'))
    = array['sf_artist2', 'sf_artist1'], true);
reset role;

-- ============================================================================
-- Step 2 — fans: the caller's own, and only the caller's
-- ============================================================================
select pg_temp.set_user('a9000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert('ARTIST1 sees their own fans, newest first — minus the one they blocked',
  (select array_agg(username) from list_my_fans())
    = array['sf_viewer', 'sf_riya'], true);
reset role;

select pg_temp.set_user('a9000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('the viewer''s list_my_fans is their own (empty), not ARTIST1''s',
  (select count(*) = 0 from list_my_fans()), true);
reset role;

select pg_temp.assert('list_my_fans takes no arguments — it cannot be aimed at another user',
  (select pronargs = 0 from pg_proc where oid = 'public.list_my_fans()'::regprocedure), true);

-- ============================================================================
-- Step 3 — a blocked pair gets no stars
-- ============================================================================
select pg_temp.set_user('a9000000-0000-0000-0000-000000000006');
set local role authenticated;
select pg_temp.assert('the blocker sees no stars for the person they blocked',
  (select count(*) = 0 from list_profile_stars('a9000000-0000-0000-0000-000000000001')), true);
reset role;

select pg_temp.set_user('a9000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('the blocked person sees no stars for their blocker',
  (select count(*) = 0 from list_profile_stars('a9000000-0000-0000-0000-000000000006')), true);
reset role;

-- ============================================================================
-- Step 4 — surface
-- ============================================================================
select pg_temp.set_user(null);
set local role authenticated;
select pg_temp.assert('no caller identity → no stars',
  (select count(*) = 0 from list_profile_stars('a9000000-0000-0000-0000-000000000001')), true);
select pg_temp.assert('no caller identity → no fans',
  (select count(*) = 0 from list_my_fans()), true);
reset role;

select pg_temp.assert('anon CANNOT execute list_profile_stars',
  has_function_privilege('anon', 'public.list_profile_stars(uuid)', 'EXECUTE'), false);
select pg_temp.assert('anon CANNOT execute list_my_fans',
  has_function_privilege('anon', 'public.list_my_fans()', 'EXECUTE'), false);
select pg_temp.assert('both are SECURITY INVOKER (the follows policy is the boundary)',
  (select bool_and(not prosecdef) from pg_proc
    where oid in ('public.list_profile_stars(uuid)'::regprocedure, 'public.list_my_fans()'::regprocedure)), true);

rollback;
