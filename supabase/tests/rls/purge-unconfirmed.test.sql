-- Nightly purge of abandoned never-confirmed sign-ups (ADR-0025, change 2;
-- 20261011000000_purge_unconfirmed_accounts.sql).
--
-- What must hold:
--   * deleted: never confirmed, never signed in, older than 7 days, email-only login,
--     owns nothing — and the pending friend request to it goes with it
--   * kept: a 6-day-old unconfirmed sign-up; any confirmed account; an unconfirmed one
--     with a Google login, an upload/post, or one that somehow signed in
--   * the username is FREE afterwards (no deleted_accounts reservation)
--   * the cache heals false -> true for confirmed users, never the reverse
--   * p_limit bounds one run; neither anon nor authenticated can execute it
--   * the job is scheduled
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/purge-unconfirmed.test.sql

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

create or replace function pg_temp.exists_user(uid uuid)
returns boolean language sql as $$ select exists (select 1 from auth.users where id = uid) $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   …01 OLDGHOST   unconfirmed, 8 days, email only, nothing          → DELETED
--   …02 YOUNG      unconfirmed, 6 days                               → kept (grace)
--   …03 REAL       confirmed, 90 days, cache still false             → kept; cache healed
--   …04 GOOGLE     unconfirmed, 8 days, has a google identity        → kept
--   …05 POSTER     unconfirmed, 8 days, has an upload + post          → kept
--   …06 SIGNEDIN   unconfirmed, 8 days, but last_sign_in_at set      → kept
--   …07 FRIEND     confirmed; sent OLDGHOST a request (pending)       → kept; request gone
--   …08 OLDGHOST2  unconfirmed, 9 days                               → DELETED (2nd run)
--   …09 RESENT     unconfirmed, 8 days, but asked for a new link 1h ago → kept
--   …0a RESET      unconfirmed, 8 days, Forgot Password email 1h ago   → kept
insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, created_at) values
  ('a0260000-0000-0000-0000-000000000001', 'pg_oldghost@example.com',  null,  null,  now() - interval '8 days'),
  ('a0260000-0000-0000-0000-000000000002', 'pg_young@example.com',     null,  null,  now() - interval '6 days'),
  ('a0260000-0000-0000-0000-000000000003', 'pg_real@example.com',      now() - interval '89 days', now(), now() - interval '90 days'),
  ('a0260000-0000-0000-0000-000000000004', 'pg_google@example.com',    null,  null,  now() - interval '8 days'),
  ('a0260000-0000-0000-0000-000000000005', 'pg_poster@example.com',    null,  null,  now() - interval '8 days'),
  ('a0260000-0000-0000-0000-000000000006', 'pg_signedin@example.com',  null,  now(), now() - interval '8 days'),
  ('a0260000-0000-0000-0000-000000000007', 'pg_friend@example.com',    now(), now(), now() - interval '50 days'),
  ('a0260000-0000-0000-0000-000000000008', 'pg_oldghost2@example.com', null,  null,  now() - interval '9 days');
insert into auth.users (id, email, email_confirmed_at, created_at, confirmation_sent_at, recovery_sent_at) values
  ('a0260000-0000-0000-0000-000000000009', 'pg_resent@example.com', null, now() - interval '8 days', now() - interval '1 hour', null),
  ('a0260000-0000-0000-0000-00000000000a', 'pg_reset@example.com',  null, now() - interval '8 days', now() - interval '8 days', now() - interval '1 hour');

insert into public.profiles (id, username, username_set, email_confirmed) values
  ('a0260000-0000-0000-0000-000000000001', 'pg_oldghost',  true, false),
  ('a0260000-0000-0000-0000-000000000002', 'pg_young',     true, false),
  ('a0260000-0000-0000-0000-000000000003', 'pg_real',      true, false),
  ('a0260000-0000-0000-0000-000000000004', 'pg_google',    true, false),
  ('a0260000-0000-0000-0000-000000000005', 'pg_poster',    true, false),
  ('a0260000-0000-0000-0000-000000000006', 'pg_signedin',  true, false),
  ('a0260000-0000-0000-0000-000000000007', 'pg_friend',    true, true),
  ('a0260000-0000-0000-0000-000000000008', 'pg_oldghost2', true, false),
  ('a0260000-0000-0000-0000-000000000009', 'pg_resent',    true, false),
  ('a0260000-0000-0000-0000-00000000000a', 'pg_reset',     true, false);

insert into auth.identities (user_id, provider) values
  ('a0260000-0000-0000-0000-000000000001', 'email'),
  ('a0260000-0000-0000-0000-000000000004', 'email'),
  ('a0260000-0000-0000-0000-000000000004', 'google');

insert into public.tracks (id, uploader_id, title, media_kind, audio_url) values
  ('a0260000-0000-0000-0000-0000000000a1', 'a0260000-0000-0000-0000-000000000005', 'Poster Track', 'audio', 'https://x/p.mp3');
insert into public.posts (id, author_id, kind, track_id) values
  ('a0260000-0000-0000-0000-0000000000b1', 'a0260000-0000-0000-0000-000000000005', 'upload', 'a0260000-0000-0000-0000-0000000000a1');

insert into public.friendships (user_a_id, user_b_id, requested_by, status) values
  ('a0260000-0000-0000-0000-000000000001', 'a0260000-0000-0000-0000-000000000007',
   'a0260000-0000-0000-0000-000000000007', 'pending');

-- ============================================================================
-- One run, limited to a single account: the OLDEST qualifying one goes first
-- ============================================================================
select pg_temp.assert('a run with p_limit = 1 deletes exactly one account',
  public.purge_unconfirmed_accounts(1) = 1, true);
select pg_temp.assert('…the oldest qualifying one (9 days) went first',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000008'), false);
select pg_temp.assert('…and the 8-day one is still waiting for the next run',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000001'), true);

-- ============================================================================
-- A full run
-- ============================================================================
select pg_temp.assert('the next run deletes the remaining abandoned sign-up',
  public.purge_unconfirmed_accounts(500) = 1, true);

select pg_temp.assert('the abandoned 8-day-old sign-up is gone',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000001'), false);
select pg_temp.assert('…its profile went with it',
  exists (select 1 from public.profiles where id = 'a0260000-0000-0000-0000-000000000001'), false);
select pg_temp.assert('…and so did the pending friend request to it',
  exists (select 1 from public.friendships
           where 'a0260000-0000-0000-0000-000000000001' in (user_a_id, user_b_id)), false);
select pg_temp.assert('…without reserving the username',
  exists (select 1 from public.deleted_accounts where username = 'pg_oldghost'), false);

select pg_temp.assert('a 6-day-old unconfirmed sign-up is kept (still in its grace period)',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000002'), true);
select pg_temp.assert('a confirmed account is kept',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000003'), true);
select pg_temp.assert('an unconfirmed account with a Google login is kept',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000004'), true);
select pg_temp.assert('an unconfirmed account that owns an upload is kept',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000005'), true);
select pg_temp.assert('an unconfirmed account that has signed in is kept',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000006'), true);
select pg_temp.assert('someone who asked for a fresh confirmation link an hour ago is kept',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000009'), true);
select pg_temp.assert('someone who asked for a password-reset email an hour ago is kept',
  pg_temp.exists_user('a0260000-0000-0000-0000-00000000000a'), true);
select pg_temp.assert('the requester is untouched',
  pg_temp.exists_user('a0260000-0000-0000-0000-000000000007'), true);

select pg_temp.assert('a confirmed user''s stale cache is healed to true',
  (select email_confirmed from public.profiles where id = 'a0260000-0000-0000-0000-000000000003'), true);
select pg_temp.assert('…and an unconfirmed user''s cache stays false',
  (select email_confirmed from public.profiles where id = 'a0260000-0000-0000-0000-000000000002'), false);

select pg_temp.assert('the freed username can be claimed again',
  (select count(*) from public.profiles where username = 'pg_oldghost') = 0, true);

select pg_temp.assert('a second run immediately after deletes nothing',
  public.purge_unconfirmed_accounts(500) = 0, true);

-- ============================================================================
-- Who can run it, and that it is scheduled
-- ============================================================================
select pg_temp.assert('anon cannot execute the purge',
  has_function_privilege('anon', 'public.purge_unconfirmed_accounts(int)', 'execute'), false);
-- Not has_function_privilege: CI's grant step re-grants every public function to
-- authenticated. The protection that matters is SECURITY INVOKER — a signed-in caller has
-- no right to delete from auth.users, so the call fails closed whatever the grant.
-- A fresh account that DOES qualify, so "deleted nothing" can actually fail.
insert into auth.users (id, email, email_confirmed_at, created_at) values
  ('a0260000-0000-0000-0000-00000000000b', 'pg_bait@example.com', null, now() - interval '10 days');
insert into public.profiles (id, username, username_set, email_confirmed) values
  ('a0260000-0000-0000-0000-00000000000b', 'pg_bait', true, false);

create or replace function pg_temp.purge_as_user_denied()
returns boolean language plpgsql as $$
begin
  set local role authenticated;
  perform public.purge_unconfirmed_accounts(500);
  reset role;
  return false;
exception when insufficient_privilege then   -- a permission refusal, nothing else
  reset role;
  return true;
end $$;
select pg_temp.assert('a signed-in user is refused permission to run the purge',
  pg_temp.purge_as_user_denied(), true);
select pg_temp.assert('…and a qualifying account survived their attempt',
  pg_temp.exists_user('a0260000-0000-0000-0000-00000000000b'), true);
select pg_temp.assert('the nightly job is scheduled',
  exists (select 1 from cron.job where jobname = 'purge-unconfirmed-accounts'
            and command like '%purge_unconfirmed_accounts%'), true);

rollback;
