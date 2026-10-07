-- search_discover_people tests (20261005000000_search_discover_people.sql).
--
-- What must hold:
--   'friends' — friends of my friends, most mutual friends first, never: me, my friends,
--               verified accounts, blocked people, half-onboarded accounts, or strangers
--               with no mutual friend. A pending request stays in.
--   'artists' — verified only (live badge), most of-my-friends-star-them first, then fan
--               count; never someone I already star, a blocked person, or a revoked badge.
--   mutual_count is the ranking number; the limit is clamped; no extra columns leak.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/search-discover.test.sql

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

-- "username:mutual_count" in the function's own order, for this file's named fixtures.
create or replace function pg_temp.listed(p_section text)
returns text[] language sql as $$
  select coalesce(array_agg(username || ':' || mutual_count order by ord), '{}')
    from (select username, mutual_count, row_number() over () as ord, section
            from public.search_discover_people(20)) r
   where section = p_section and username like 'sd\_%' and username not like 'sd\_bulk%';
$$;

-- true when running `sql` raises (an RLS refusal or any error), false when it succeeds.
create or replace function pg_temp.denied(sql text)
returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   …01 ME
--   …02 F1        my friend
--   …03 F2        my friend (and F1's friend — a friend of a friend who is ALREADY mine)
--   …04 RIYA      friend of F1                   → suggested, 1 mutual
--   …05 SAM       friend of F1 and F2            → suggested, 2 mutual — FIRST despite the
--                 higher id, so ordering by id alone cannot pass
--   …06 PENDING   friend of F1; pending with me  → suggested, 1 mutual
--   …07 VFOF      friend of F1 but VERIFIED      → not a friend suggestion; an artist (0)
--   …08 BLOCKER   friend of F1; blocked me       → hidden
--   …09 HALFWAY   friend of F1; no username yet  → hidden
--   …0a STRANGER  no mutual friend               → not suggested
--   …0b ARIJIT    verified, starred by F1 + F2   → artist, 2
--   …0c SHREYA    verified, starred by F1        → artist, 1
--   …0d POPULAR   verified, starred by nobody, 9000 fans → artist, 0, ahead of VFOF
--   …0e MINE      verified, starred by F1, and I already star them → hidden
--   …0f REVOKED   badge revoked, starred by F1 + F2 → not an artist
--   …10 BLOCKEDV  verified, starred by F1 + F2, I blocked them → hidden
--   …11 PENDFOF   only a PENDING request with F1 → hidden: a pending request is private to
--                 its two participants, and a suggestion must not reveal it
--   …12 HALFV     verified, starred by F1 + F2, no username yet → hidden
--   …13 LONER     zero friends; stars ARIJIT (as F1 and F2 do) — 'people' fallback tests
--   …14 LONELYF   my friend whose ONLY friend is me — not a friend-of-friend, so only the
--                 explicit "not already my friend" rule keeps them out of 'people'
--   …15 REQD      I sent them a request (pending)        → hidden from 'people' (Step 1d)
--   …16 ASKER     they sent me a request (pending)       → hidden from 'people' (Step 1d)
--   …17 LATER     I X'd them; they then request, I accept, then unfriend (Step 1d)
--   …18 BADDY     I block, then unblock them (Step 1d)
-- Also: a pending F2 ↔ RIYA row must not lift Riya's count to 2, and STRANGER (not my
-- friend) stars SHREYA, which must not lift hers — only my FRIENDS' stars count.
insert into auth.users (id)
  select ('ad000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid
    from generate_series(1, 25) g
on conflict do nothing;

insert into profiles (id, username, username_set, followers_count) values
  ('ad000000-0000-0000-0000-000000000001', 'sd_me',       true,    0),
  ('ad000000-0000-0000-0000-000000000002', 'sd_f1',       true,    0),
  ('ad000000-0000-0000-0000-000000000003', 'sd_f2',       true,    0),
  ('ad000000-0000-0000-0000-000000000004', 'sd_riya',     true,    0),
  ('ad000000-0000-0000-0000-000000000005', 'sd_sam',      true,    0),
  ('ad000000-0000-0000-0000-000000000006', 'sd_pending',  true,    0),
  ('ad000000-0000-0000-0000-000000000007', 'sd_vfof',     true,    0),
  ('ad000000-0000-0000-0000-000000000008', 'sd_blocker',  true,    0),
  ('ad000000-0000-0000-0000-000000000009', 'sd_halfway',  false,   0),
  ('ad000000-0000-0000-0000-00000000000a', 'sd_stranger', true,   50),
  ('ad000000-0000-0000-0000-00000000000b', 'sd_arijit',   true,  100),
  ('ad000000-0000-0000-0000-00000000000c', 'sd_shreya',   true,  100),
  ('ad000000-0000-0000-0000-00000000000d', 'sd_popular',  true, 9000),
  ('ad000000-0000-0000-0000-00000000000e', 'sd_mine',     true, 9999),
  ('ad000000-0000-0000-0000-00000000000f', 'sd_revoked',  true, 9999),
  ('ad000000-0000-0000-0000-000000000010', 'sd_blockedv', true, 9999),
  ('ad000000-0000-0000-0000-000000000011', 'sd_pendfof',  true,    0),
  ('ad000000-0000-0000-0000-000000000012', 'sd_halfv',    false, 9999),
  ('ad000000-0000-0000-0000-000000000013', 'sd_loner',    true,    0),
  ('ad000000-0000-0000-0000-000000000014', 'sd_lonelyf',  true,    0),
  ('ad000000-0000-0000-0000-000000000015', 'sd_reqd',     true,    0),
  ('ad000000-0000-0000-0000-000000000016', 'sd_asker',    true,    0),
  ('ad000000-0000-0000-0000-000000000017', 'sd_later',    true,    0),
  ('ad000000-0000-0000-0000-000000000018', 'sd_baddy',    true,    0)
on conflict (id) do update
  set username = excluded.username, username_set = excluded.username_set,
      followers_count = excluded.followers_count;

insert into profile_badges (user_id, badge, revoked_at) values
  ('ad000000-0000-0000-0000-000000000007', 'verified', null),
  ('ad000000-0000-0000-0000-00000000000b', 'verified', null),
  ('ad000000-0000-0000-0000-00000000000c', 'verified', null),
  ('ad000000-0000-0000-0000-00000000000d', 'verified', null),
  ('ad000000-0000-0000-0000-00000000000e', 'verified', null),
  ('ad000000-0000-0000-0000-00000000000f', 'verified', '2026-05-01'),
  ('ad000000-0000-0000-0000-000000000010', 'verified', null),
  ('ad000000-0000-0000-0000-000000000012', 'verified', null);

-- user_a_id < user_b_id is a table constraint; the lower id is always first here.
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at)
select a::uuid, b::uuid, s, a::uuid, case when s = 'accepted' then now() end
  from (values
    ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000002', 'accepted'),
    ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000003', 'accepted'),
    ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000006', 'pending'),
    ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000014', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000003', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000004', 'accepted'),
    ('ad000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-000000000005', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000005', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000006', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000007', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000008', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000009', 'accepted'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000011', 'pending'),
    ('ad000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-000000000004', 'pending')
  ) t(a, b, s)
on conflict do nothing;

insert into follows (follower_id, following_id, kind)
select a::uuid, b::uuid, 'star'
  from (values
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-00000000000b'),
    ('ad000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-00000000000b'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-00000000000c'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-00000000000e'),
    ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-00000000000e'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-00000000000f'),
    ('ad000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-00000000000f'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000010'),
    ('ad000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-000000000010'),
    ('ad000000-0000-0000-0000-00000000000a', 'ad000000-0000-0000-0000-00000000000c'),
    ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000012'),
    ('ad000000-0000-0000-0000-000000000003', 'ad000000-0000-0000-0000-000000000012'),
    ('ad000000-0000-0000-0000-000000000013', 'ad000000-0000-0000-0000-00000000000b')
  ) t(a, b)
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('ad000000-0000-0000-0000-000000000008', 'ad000000-0000-0000-0000-000000000001'),
  ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000010')
on conflict do nothing;

-- ============================================================================
-- Step 1 — the two lists, as ME
-- ============================================================================
select pg_temp.set_user('ad000000-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert('friends: friends-of-friends by mutual count; no friend, verified, blocker, half-onboarded, stranger or friend-of-friend-by-PENDING-request, or anyone with a request pending with me',
  pg_temp.listed('friends') = array['sd_sam:2', 'sd_riya:1'], true);

select pg_temp.assert('artists: by friends-who-star, then fans; only FRIENDS'' stars count; none I star, blocked, half-onboarded or revoked',
  pg_temp.listed('artists') = array['sd_arijit:2', 'sd_shreya:1', 'sd_popular:0', 'sd_vfof:0'], true);

select pg_temp.assert('the caller never appears in either list',
  (select count(*) = 0 from search_discover_people(20)
    where user_id = 'ad000000-0000-0000-0000-000000000001'), true);

select pg_temp.assert('the limit applies per section',
  (select count(*) filter (where section = 'friends') = 1
      and count(*) filter (where section = 'artists') = 1
     from search_discover_people(1)), true);

select pg_temp.assert('a zero/negative limit still returns at least one per section, never errors',
  (select count(*) from search_discover_people(0) where section = 'friends') = 1, true);

select pg_temp.assert('under caller rights friendships of others are unreadable (why DEFINER)',
  (select count(*) = 0 from friendships
    where user_a_id = 'ad000000-0000-0000-0000-000000000002'
      and user_b_id = 'ad000000-0000-0000-0000-000000000004'), true);
reset role;

-- ============================================================================
-- Step 1b — dismissing a suggested person or artist (20261007000000)
-- ============================================================================
select pg_temp.set_user('ad000000-0000-0000-0000-000000000001');
set local role authenticated;

insert into suggestion_dismissals (user_id, dismissed_user_id)
  values ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000005');

select pg_temp.assert('a dismissed person is no longer suggested; the rest move up',
  pg_temp.listed('friends') = array['sd_riya:1'], true);

insert into suggestion_dismissals (user_id, dismissed_user_id)
  values ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-00000000000c');

select pg_temp.assert('a dismissed artist is no longer suggested either',
  pg_temp.listed('artists') = array['sd_arijit:2', 'sd_popular:0', 'sd_vfof:0'], true);

-- 3 = SAM and SHREYA dismissed above, plus BLOCKEDV, whom the fixtures have me blocking
-- (blocking records a dismissal for the blocker — 20261008000000).
select pg_temp.assert('I can read my own dismissals',
  (select count(*) = 3 from suggestion_dismissals), true);

select pg_temp.assert('I cannot dismiss on someone else''s behalf',
  (select pg_temp.denied($q$
     insert into suggestion_dismissals (user_id, dismissed_user_id)
     values ('ad000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000004')
   $q$)), true);
reset role;

select pg_temp.set_user('ad000000-0000-0000-0000-000000000005');
set local role authenticated;
select pg_temp.assert('the dismissed person cannot see that they were dismissed',
  (select count(*) = 0 from suggestion_dismissals), true);
reset role;

-- RIYA's friend F1 is friends with SAM, so SAM is a suggestion for RIYA too. ME dismissing
-- SAM must change ME's list only — otherwise one account could erase someone from
-- everybody's suggestions.
select pg_temp.set_user('ad000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('one person''s dismissal does not affect anyone else''s suggestions',
  'sd_sam:1' = any(pg_temp.listed('friends')), true);
reset role;

-- Behavioural, not a privilege check: the CI harness grants anon SELECT on every table
-- (and Supabase's default privileges do the same), so the policies are what stand between
-- a signed-out caller and these rows. Both are `to authenticated`.
select pg_temp.set_user(null);
set local role anon;
select pg_temp.assert('a signed-out caller sees no dismissals',
  (select count(*) = 0 from suggestion_dismissals), true);
reset role;

-- ============================================================================
-- Step 1c — 'people': the fallback that keeps "People you may know" filled (20261007010000)
-- ============================================================================
select pg_temp.set_user('ad000000-0000-0000-0000-000000000013');
set local role authenticated;

select pg_temp.assert('zero friends → no friends-of-friends',
  pg_temp.listed('friends') = '{}'::text[], true);

-- F1 and F2 star ARIJIT like LONER does → 1 artist in common, first. Then by fans:
-- REVOKED (9999, badge revoked so unverified) before STRANGER (50).
select pg_temp.assert('people: shared taste first, then most fans',
  (pg_temp.listed('people'))[1:4] = array['sd_f1:1', 'sd_f2:1', 'sd_revoked:0', 'sd_stranger:0'], true);

select pg_temp.assert('people: never verified, half-onboarded, or the caller',
  not (pg_temp.listed('people') && array['sd_arijit:0', 'sd_vfof:0', 'sd_halfway:0', 'sd_loner:0']), true);
reset role;

select pg_temp.set_user('ad000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('people: never someone already reachable by a mutual friend, nor a friend',
  (select count(*) = 0 from search_discover_people(20)
    where section = 'people' and username in ('sd_riya', 'sd_pending', 'sd_f1', 'sd_f2', 'sd_lonelyf')), true);

select pg_temp.assert('people: someone with no mutual friend is offered as a fallback',
  'sd_stranger:0' = any(pg_temp.listed('people')), true);

select pg_temp.assert('people: a person sits in at most one people section',
  (select count(*) = count(distinct user_id) from search_discover_people(20)
    where section in ('friends', 'people')), true);

insert into suggestion_dismissals (user_id, dismissed_user_id)
  values ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-00000000000a');
select pg_temp.assert('people: the X works on fallback suggestions too',
  not ('sd_stranger:0' = any(pg_temp.listed('people'))), true);
reset role;

select pg_temp.set_user('ad000000-0000-0000-0000-000000000008');
set local role authenticated;
select pg_temp.assert('people: blocked pairs never see each other',
  (select count(*) = 0 from search_discover_people(20)
    where user_id = 'ad000000-0000-0000-0000-000000000001'), true);
reset role;

-- ============================================================================
-- Step 1d — suggestions follow the friendship lifecycle (20261008000000)
-- ============================================================================
insert into friendships (user_a_id, user_b_id, status, requested_by) values
  ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000015', 'pending',
   'ad000000-0000-0000-0000-000000000001'),
  ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000016', 'pending',
   'ad000000-0000-0000-0000-000000000016'),
  ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000017', 'pending',
   'ad000000-0000-0000-0000-000000000017');
insert into suggestion_dismissals (user_id, dismissed_user_id) values
  ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000017');

select pg_temp.set_user('ad000000-0000-0000-0000-000000000001');
set local role authenticated;

select pg_temp.assert('a request I sent, or one sent to me, hides them from suggestions',
  (select count(*) = 0 from search_discover_people(20)
    where username in ('sd_reqd', 'sd_asker')), true);

select accept_friend_request('ad000000-0000-0000-0000-000000000017');
select pg_temp.assert('becoming friends clears an earlier X between the two',
  (select count(*) = 0 from suggestion_dismissals
    where dismissed_user_id = 'ad000000-0000-0000-0000-000000000017'), true);

select remove_friend('ad000000-0000-0000-0000-000000000017');
select pg_temp.assert('after an unfriend they are suggested again',
  (select count(*) = 1 from search_discover_people(20) where username = 'sd_later'), true);
reset role;

-- Inserted as the table owner, as block_user does under DEFINER; the trigger is what is
-- being tested, not block_user's own checks.
insert into blocked_users (blocker_id, blocked_id)
  values ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000018');

select pg_temp.assert('blocking records a dismissal for the blocker',
  (select count(*) = 1 from suggestion_dismissals
    where user_id = 'ad000000-0000-0000-0000-000000000001'
      and dismissed_user_id = 'ad000000-0000-0000-0000-000000000018'), true);
select pg_temp.assert('…and NONE for the blocked person (it would reveal the block)',
  (select count(*) = 0 from suggestion_dismissals
    where user_id = 'ad000000-0000-0000-0000-000000000018'), true);

delete from blocked_users
 where blocker_id = 'ad000000-0000-0000-0000-000000000001'
   and blocked_id = 'ad000000-0000-0000-0000-000000000018';

select pg_temp.set_user('ad000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('after an unblock they still stay out of the blocker''s suggestions',
  (select count(*) = 0 from search_discover_people(20) where username = 'sd_baddy'), true);
reset role;

-- The clamp is what stops one call listing every account, so it needs MORE than 20 people
-- per section to be observable: 25 verified accounts and 25 unverified friends of F1.
insert into auth.users (id)
  select ('ae000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 50) g
on conflict do nothing;
insert into profiles (id, username, username_set)
  select ('ae000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'sd_bulk_' || g, true
    from generate_series(1, 50) g
on conflict (id) do update set username_set = true;
insert into profile_badges (user_id, badge)
  select ('ae000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'verified'
    from generate_series(1, 25) g;
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at)
  select 'ad000000-0000-0000-0000-000000000002'::uuid,
         ('ae000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
         'accepted', 'ad000000-0000-0000-0000-000000000002'::uuid, now()
    from generate_series(26, 50) g
on conflict do nothing;

select pg_temp.set_user('ad000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('a huge limit is clamped to exactly 20 per section',
  (select count(*) filter (where section = 'artists') = 20
      and count(*) filter (where section = 'friends') = 20
      and count(*) filter (where section = 'people') <= 20
     from search_discover_people(100000)), true);
reset role;

-- ============================================================================
-- Step 2 — the block works from the other side too
-- ============================================================================
select pg_temp.set_user('ad000000-0000-0000-0000-000000000010');
set local role authenticated;
select pg_temp.assert('the person I blocked never gets me suggested either',
  (select count(*) = 0 from search_discover_people(20)
    where user_id = 'ad000000-0000-0000-0000-000000000001'), true);
reset role;

-- ============================================================================
-- Step 3 — surface
-- ============================================================================
select pg_temp.set_user(null);
set local role authenticated;
select pg_temp.assert('no caller identity → empty',
  (select count(*) = 0 from search_discover_people(5)), true);
reset role;

select pg_temp.assert('anon CANNOT execute search_discover_people',
  has_function_privilege('anon', 'public.search_discover_people(int)', 'EXECUTE'), false);
select pg_temp.assert('authenticated CAN execute search_discover_people',
  has_function_privilege('authenticated', 'public.search_discover_people(int)', 'EXECUTE'), true);
select pg_temp.assert('only the six intended columns — no who, no join or award time',
  (select count(*) = 0 from information_schema.routines r
     join information_schema.parameters pa using (specific_schema, specific_name)
    where r.routine_name = 'search_discover_people' and pa.parameter_mode = 'OUT'
      and pa.parameter_name not in
        ('section', 'user_id', 'username', 'display_name', 'avatar_url', 'mutual_count')), true);

rollback;
