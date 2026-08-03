-- comments_friends_only enforcement tests.
--
-- THE DEFECT. profiles.comments_friends_only shipped in 1.1.14 with a Settings switch
-- and no enforcement whatsoever: post_comments_insert_self checked only
-- `author_id = auth.uid()`. A user could turn on "Comments from friends only" and a
-- stranger could still comment. Step 1 is that exact attack; it must be refused.
--
-- Runs as `authenticated` against the deployed policy, so what allows or denies here is
-- the database, not application code. Every denial is paired with a count of the stored
-- rows — a WITH CHECK violation does raise, but asserting only the raise would not prove
-- the row is absent.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/comments-friends-only.test.sql
--
-- Exercises the database, not PostgREST (P32).

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

-- auth.uid() is stubbed per-case because there is no JWT in this context.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- Runs a statement as the CURRENT role and reports whether the database allowed it.
-- SECURITY INVOKER (default), so `set local role authenticated` is respected and RLS
-- applies as it would to a PostgREST request.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

-- Real Supabase grants `authenticated` USAGE on the auth schema; the bare-Postgres CI
-- shim does not. The policy calls auth.uid() as that role. Rolled back with the txn.
grant usage on schema auth to authenticated;

-- ── Fixtures (inserted as the table owner → RLS not applied to the setup) ────
-- OWNER restricts comments to friends. FRIEND has an accepted friendship with OWNER.
-- STRANGER has none — they are the attacker. OPEN_AUTHOR leaves the default (false),
-- which is what proves the restriction is opt-in and not a blanket lockdown.
insert into auth.users (id) values
  ('a1111111-0000-0000-0000-000000000001'),  -- OWNER       (comments_friends_only = true)
  ('a1111111-0000-0000-0000-000000000002'),  -- FRIEND
  ('a1111111-0000-0000-0000-000000000003'),  -- STRANGER
  ('a1111111-0000-0000-0000-000000000004')   -- OPEN_AUTHOR (default: everyone)
on conflict do nothing;

insert into profiles (id, username, username_set, comments_friends_only) values
  ('a1111111-0000-0000-0000-000000000001', 'cfo_owner',    true, true),
  ('a1111111-0000-0000-0000-000000000002', 'cfo_friend',   true, false),
  ('a1111111-0000-0000-0000-000000000003', 'cfo_stranger', true, false),
  ('a1111111-0000-0000-0000-000000000004', 'cfo_open',     true, false)
on conflict do nothing;

-- friendships_check enforces user_a_id < user_b_id, so the pair is stored in that order.
insert into friendships (user_a_id, user_b_id, status, requested_by, accepted_at) values
  ('a1111111-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000002',
   'accepted', 'a1111111-0000-0000-0000-000000000001', now())
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('b1111111-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
   'owner track', 'audio', 'https://example.invalid/o.mp3'),
  ('b1111111-0000-0000-0000-000000000002', 'a1111111-0000-0000-0000-000000000004',
   'open track',  'audio', 'https://example.invalid/p.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('c1111111-0000-0000-0000-000000000001', 'a1111111-0000-0000-0000-000000000001',
   'upload', 'b1111111-0000-0000-0000-000000000001'),   -- RESTRICTED post
  ('c1111111-0000-0000-0000-000000000002', 'a1111111-0000-0000-0000-000000000004',
   'upload', 'b1111111-0000-0000-0000-000000000002')    -- OPEN post
on conflict do nothing;

-- A comment written BEFORE enforcement existed. Step 7 proves it survives: this policy
-- governs INSERT only, and retroactively hiding what people already said is not the
-- behaviour the setting promises.
insert into post_comments (id, post_id, author_id, body) values
  ('d1111111-0000-0000-0000-000000000099', 'c1111111-0000-0000-0000-000000000001',
   'a1111111-0000-0000-0000-000000000003', 'pre-existing stranger comment')
on conflict do nothing;

-- Role discipline throughout: auth.uid() is re-stubbed as the OWNER (creating a
-- function in the auth schema needs more than the USAGE granted above), then the role
-- is assumed for the statement under test, then reset so the assertions read the stored
-- rows without RLS in the way.

-- ============================================================================
-- Step 1 — THE DEFECT: a stranger comments on a restricted post
-- ============================================================================
select pg_temp.set_user('a1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'stranger CANNOT comment on a friends-only post',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body) values
      ('d1111111-0000-0000-0000-000000000001','c1111111-0000-0000-0000-000000000001',
       'a1111111-0000-0000-0000-000000000003','nope')$$),
  false);
reset role;
select pg_temp.assert_count(
  'and no row was stored',
  (select count(*) from post_comments where id = 'd1111111-0000-0000-0000-000000000001'),
  0);

-- ============================================================================
-- Step 2 — a friend is admitted
-- ============================================================================
-- Without this the policy could "pass" by refusing everyone, which is a different bug
-- wearing the same green tick.
select pg_temp.set_user('a1111111-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.assert(
  'friend CAN comment on a friends-only post',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body) values
      ('d1111111-0000-0000-0000-000000000002','c1111111-0000-0000-0000-000000000001',
       'a1111111-0000-0000-0000-000000000002','hello')$$),
  true);
reset role;

-- ============================================================================
-- Step 3 — the author is never locked out of their own post
-- ============================================================================
select pg_temp.set_user('a1111111-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert(
  'owner CAN comment on their own friends-only post',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body) values
      ('d1111111-0000-0000-0000-000000000003','c1111111-0000-0000-0000-000000000001',
       'a1111111-0000-0000-0000-000000000001','mine')$$),
  true);
reset role;

-- ============================================================================
-- Step 4 — the restriction is OPT-IN: the default stays open to everyone
-- ============================================================================
-- Livil's model is that likes and comments are open. A stranger must still be able to
-- comment on a post whose author never touched the setting.
select pg_temp.set_user('a1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'stranger CAN comment on a default (everyone) post',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body) values
      ('d1111111-0000-0000-0000-000000000004','c1111111-0000-0000-0000-000000000002',
       'a1111111-0000-0000-0000-000000000003','open post')$$),
  true);
reset role;

-- ============================================================================
-- Step 5 — authorship is still enforced alongside the new clause
-- ============================================================================
-- The added condition must not have displaced the original one: a caller still cannot
-- post a comment under someone else's name, even where they are allowed to comment.
select pg_temp.set_user('a1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'stranger CANNOT forge a comment as the friend, even on an open post',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body) values
      ('d1111111-0000-0000-0000-000000000005','c1111111-0000-0000-0000-000000000002',
       'a1111111-0000-0000-0000-000000000002','forged')$$),
  false);
reset role;

-- ============================================================================
-- Step 6 — replies are gated too, not just top-level comments
-- ============================================================================
-- A reply is a post_comments row like any other, so the same policy governs it. Worth
-- pinning: a threading-aware fix that only guarded top-level rows would leave the reply
-- box as an open door onto the same post.
select pg_temp.set_user('a1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'stranger CANNOT reply to a comment on a friends-only post',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body, parent_comment_id) values
      ('d1111111-0000-0000-0000-000000000006','c1111111-0000-0000-0000-000000000001',
       'a1111111-0000-0000-0000-000000000003','reply','d1111111-0000-0000-0000-000000000002')$$),
  false);
reset role;

-- ============================================================================
-- Step 7 — enabling the setting does not erase what is already there
-- ============================================================================
select pg_temp.assert_count(
  'a comment written before the restriction survives',
  (select count(*) from post_comments where id = 'd1111111-0000-0000-0000-000000000099'),
  1);

-- ============================================================================
-- Step 8 — the switch takes effect both ways
-- ============================================================================
-- Turning the preference OFF must re-admit the stranger. A policy that read a cached or
-- hard-coded value would pass every step above and fail here.
update profiles set comments_friends_only = false
 where id = 'a1111111-0000-0000-0000-000000000001';

select pg_temp.set_user('a1111111-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert(
  'stranger CAN comment once the owner turns the restriction off',
  pg_temp.allows($$
    insert into post_comments (id, post_id, author_id, body) values
      ('d1111111-0000-0000-0000-000000000007','c1111111-0000-0000-0000-000000000001',
       'a1111111-0000-0000-0000-000000000003','now allowed')$$),
  true);
reset role;

-- ============================================================================
-- Step 9 — exactly one permissive INSERT policy
-- ============================================================================
-- Permissive policies for the same command are OR-ed. A second one — added by a
-- hand-applied fix or a future migration that adds rather than replaces — would let
-- every insert through again while all of the above still passed.
select pg_temp.assert_count(
  'post_comments has exactly one permissive INSERT policy',
  (select count(*) from pg_policy
    where polrelid = 'public.post_comments'::regclass and polcmd = 'a'),
  1);

select pg_temp.assert(
  'and it consults can_comment_on_post',
  (select pg_get_expr(polwithcheck, polrelid) like '%can_comment_on_post%'
     from pg_policy
    where polrelid = 'public.post_comments'::regclass and polcmd = 'a'),
  true);

rollback;
