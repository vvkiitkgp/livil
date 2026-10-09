-- Repost audience (20261019000000, ADR-0028): profiles.reposts_public decides who sees a
-- person's reposts — everyone (default) or accepted friends only.
--
-- Pins: (0) after both steps (20261019 off-for-all, 20261020 everyone) the default is
-- everyone, for new AND existing profiles; (1) everyone means
-- any signed-in user, never a blocked one, never signed out; (2) friends only is the old
-- rule, applied live to past reposts; (3) only the owner can flip it; (4) uploads ignore
-- it; (5) record_post_impressions agrees with the read policy; (6) there is still exactly
-- one read policy on posts; (7) step 1 starts everyone off and step 2 turns on only those
-- who never chose.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/repost-audience.test.sql

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

-- SECURITY DEFINER + DISCARD PLANS: auth.uid() is inlined into cached plpgsql plans, so
-- without the discard later calls still see the FIRST user (search-analytics.test.sql).
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  execute 'discard plans';
end $$;

create or replace function pg_temp.rows_affected(stmt text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
exception
  when others then return -1;
end $$;

grant usage on schema auth to authenticated;

-- RIYA reposts. FRIEND is her accepted friend; SAM is a stranger; BLOCKED is blocked by her.
insert into auth.users (id) values
  ('a7000000-0000-0000-0000-000000000001'),  -- RIYA (reposter)
  ('a7000000-0000-0000-0000-000000000002'),  -- FRIEND
  ('a7000000-0000-0000-0000-000000000003'),  -- SAM (stranger)
  ('a7000000-0000-0000-0000-000000000004'),  -- BLOCKED
  ('a7000000-0000-0000-0000-000000000005')   -- ARTIST (uploader)
on conflict do nothing;

-- No reposts_public in the insert: an old app's sign-up never sends it.
insert into profiles (id, username, username_set) values
  ('a7000000-0000-0000-0000-000000000001', 'ra_riya',    true),
  ('a7000000-0000-0000-0000-000000000002', 'ra_friend',  true),
  ('a7000000-0000-0000-0000-000000000003', 'ra_sam',     true),
  ('a7000000-0000-0000-0000-000000000004', 'ra_blocked', true),
  ('a7000000-0000-0000-0000-000000000005', 'ra_artist',  true)
on conflict do nothing;

insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002',
   'accepted', 'a7000000-0000-0000-0000-000000000001', now())
on conflict do nothing;

insert into blocked_users (blocker_id, blocked_id) values
  ('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000004')
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('a8000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000005',
   'Monsoon Letters', 'audio', 'https://example.invalid/m.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('a9000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000005',
   'upload', 'a8000000-0000-0000-0000-000000000001', null),
  -- RIYA's repost of it (made "before" the switch existed — same row either way).
  ('a9000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001',
   'repost', 'a8000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001'),
  -- RIYA's own upload, to prove uploads ignore the switch.
  ('a9000000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-000000000001',
   'upload', 'a8000000-0000-0000-0000-000000000001', null)
on conflict do nothing;

-- ── 0. Default ──────────────────────────────────────────────────────────────
select pg_temp.assert('0a  a profile created without the column defaults to everyone',
  (select reposts_public from profiles where id = 'a7000000-0000-0000-0000-000000000001'), true);
select pg_temp.assert('0b  no existing profile was left at friends only',
  (select bool_and(reposts_public) from profiles), true);

-- ── 1. Everyone (default) ───────────────────────────────────────────────────
select pg_temp.set_user('a7000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('1a  SAM, a stranger, sees RIYA''s repost',
  (select count(*) from posts where id = 'a9000000-0000-0000-0000-000000000002'), 1);
reset role;

select pg_temp.set_user('a7000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('1b  FRIEND sees it',
  (select count(*) from posts where id = 'a9000000-0000-0000-0000-000000000002'), 1);
reset role;

select pg_temp.set_user('a7000000-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert_count('1c  BLOCKED never sees it — nor anything else of hers',
  (select count(*) from posts where author_id = 'a7000000-0000-0000-0000-000000000001'), 0);
reset role;

set local role anon;
select pg_temp.assert_count('1d  signed out sees no posts at all',
  (select count(*) from posts), 0);
reset role;

-- ── 2. Friends only — the old rule, applied to past reposts too ─────────────
update profiles set reposts_public = false where id = 'a7000000-0000-0000-0000-000000000001';

select pg_temp.set_user('a7000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_count('2a  SAM no longer sees the repost',
  (select count(*) from posts where id = 'a9000000-0000-0000-0000-000000000002'), 0);
select pg_temp.assert_count('2b  …but still sees her upload (uploads ignore the switch)',
  (select count(*) from posts where id = 'a9000000-0000-0000-0000-000000000003'), 1);
reset role;

select pg_temp.set_user('a7000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert_count('2c  FRIEND still sees it',
  (select count(*) from posts where id = 'a9000000-0000-0000-0000-000000000002'), 1);
reset role;

select pg_temp.set_user('a7000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_count('2d  RIYA always sees her own',
  (select count(*) from posts where id = 'a9000000-0000-0000-0000-000000000002'), 1);
reset role;

-- ── 3. Only the owner flips it ──────────────────────────────────────────────
select pg_temp.set_user('a7000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert('3a  SAM cannot flip RIYA''s switch to expose her reposts',
  pg_temp.rows_affected($q$update profiles set reposts_public = true
    where id = 'a7000000-0000-0000-0000-000000000001'$q$) <= 0, true);
reset role;
select pg_temp.assert('3b  …and it is still friends only',
  (select reposts_public from profiles where id = 'a7000000-0000-0000-0000-000000000001'), false);

select pg_temp.set_user('a7000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('3c  RIYA can turn it back on',
  pg_temp.rows_affected($q$update profiles set reposts_public = true
    where id = 'a7000000-0000-0000-0000-000000000001'$q$) = 1, true);
reset role;

-- ── 4/5. Impressions agree with the read policy ─────────────────────────────
select pg_temp.set_user('a7000000-0000-0000-0000-000000000003');
set local role authenticated;
select public.record_post_impressions(array['a9000000-0000-0000-0000-000000000002'::uuid]);
reset role;
select pg_temp.assert_count('5a  SAM''s impression of a public repost is recorded (so it can fade from his feed)',
  (select count(*) from post_impressions
    where user_id = 'a7000000-0000-0000-0000-000000000003'
      and post_id = 'a9000000-0000-0000-0000-000000000002'), 1);

update profiles set reposts_public = false where id = 'a7000000-0000-0000-0000-000000000001';
delete from post_impressions where user_id = 'a7000000-0000-0000-0000-000000000003';
select pg_temp.set_user('a7000000-0000-0000-0000-000000000003');
set local role authenticated;
select public.record_post_impressions(array['a9000000-0000-0000-0000-000000000002'::uuid]);
reset role;
select pg_temp.assert_count('5b  …but not once it is friends only (no existence oracle for hidden posts)',
  (select count(*) from post_impressions where user_id = 'a7000000-0000-0000-0000-000000000003'), 0);

update profiles set reposts_public = true where id = 'a7000000-0000-0000-0000-000000000001';
select pg_temp.set_user('a7000000-0000-0000-0000-000000000004');
set local role authenticated;
select public.record_post_impressions(array['a9000000-0000-0000-0000-000000000002'::uuid]);
reset role;
select pg_temp.assert_count('5c  BLOCKED''s impression is never recorded, public or not',
  (select count(*) from post_impressions where user_id = 'a7000000-0000-0000-0000-000000000004'), 0);

-- ── 7. Two steps: off first (20261019), everyone later (20261020) ───────────
-- RIYA's switch was changed above (sections 2–5), so it is stamped as a choice.
select pg_temp.assert('7a  changing the switch records that the owner chose',
  (select reposts_public_set_at is not null from profiles where id = 'a7000000-0000-0000-0000-000000000001'), true);
update profiles set bio = 'listening to everything' where id = 'a7000000-0000-0000-0000-000000000002';
select pg_temp.assert('7b  an unrelated profile edit is not a choice',
  (select reposts_public_set_at is null from profiles where id = 'a7000000-0000-0000-0000-000000000002'), true);

-- Step 2's backfill, re-run against two friends-only profiles: FRIEND never chose (as
-- after step 1), SAM chose friends only.
update profiles set reposts_public = false
 where id in ('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000003');
update profiles set reposts_public_set_at = null where id = 'a7000000-0000-0000-0000-000000000002';
update public.profiles
   set reposts_public = true
 where reposts_public = false
   and reposts_public_set_at is null;
select pg_temp.assert('7c  step 2 turns on someone who never chose',
  (select reposts_public from profiles where id = 'a7000000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('7d  …and leaves someone who chose friends only alone',
  (select reposts_public from profiles where id = 'a7000000-0000-0000-0000-000000000003'), false);
select pg_temp.assert('7e  after both steps a new profile defaults to everyone',
  (select column_default = 'true' from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'reposts_public'), true);

-- ── 6. Still one read policy ────────────────────────────────────────────────
select pg_temp.assert_count('6a  exactly one SELECT policy on posts (a second would be OR''d in)',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'posts' and cmd = 'SELECT'), 1);
select pg_temp.assert('6b  reposts_public() is not callable signed out',
  has_function_privilege('anon', 'public.reposts_public(uuid)', 'execute'), false);

rollback;
