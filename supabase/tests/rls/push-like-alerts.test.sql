-- push_like_alerts (20261024000000): one sound per liked post per 15 minutes.
--
-- Pins the three properties send-push relies on:
--
--   1. DENY-ALL — no app role can read or write it. It holds when each person was last
--      buzzed about each post, which is nobody else's business, and only send-push (the
--      service role) maintains it.
--   2. THE CLAIM — the two statements claimLikeAlert issues through PostgREST, run here as
--      SQL: a conditional UPDATE (… WHERE last_alert_at < window start RETURNING), then an
--      INSERT … ON CONFLICT DO NOTHING RETURNING. A returned row means "this like alerts".
--      First like → loud; another inside the window → quiet; one after it → loud again.
--   3. CLEANUP — rows go with the post and with the recipient's profile.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/push-like-alerts.test.sql

\set ON_ERROR_STOP on
begin;

-- ── Harness ─────────────────────────────────────────────────────────────────
create or replace function pg_temp.assert_count(label text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected % row(s), got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

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

-- True when the statement succeeded; false when the database refused it for any reason.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when others then return false;
end $$;

-- claimLikeAlert, as the SQL PostgREST runs for it. Executed as the table owner, standing
-- in for the service role (which bypasses RLS). Returns whether this like alerts.
create or replace function pg_temp.claim(recipient uuid, post uuid, at timestamptz)
returns boolean language plpgsql as $$
declare
  moved int;
  created int;
begin
  with m as (
    update push_like_alerts set last_alert_at = at
     where recipient_id = recipient and post_id = post
       and last_alert_at < at - interval '15 minutes'
    returning 1)
  select count(*) into moved from m;
  if moved > 0 then return true; end if;

  with c as (
    insert into push_like_alerts (recipient_id, post_id, last_alert_at)
    values (recipient, post, at)
    on conflict (recipient_id, post_id) do nothing
    returning 1)
  select count(*) into created from c;
  return created > 0;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- OWNER uploaded a track; LIKER is anyone else.
insert into auth.users (id) values
  ('c6000000-0000-0000-0000-000000000001'),  -- OWNER
  ('c6000000-0000-0000-0000-000000000002')   -- LIKER
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('c6000000-0000-0000-0000-000000000001', 'pla_owner', true),
  ('c6000000-0000-0000-0000-000000000002', 'pla_liker', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('d6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001',
   'owner track', 'audio', 'https://example.invalid/o.mp3'),
  ('d6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000001',
   'owner track 2', 'audio', 'https://example.invalid/o2.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('e6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001',
   'upload', 'd6000000-0000-0000-0000-000000000001'),
  ('e6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000001',
   'upload', 'd6000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- ── 2. The claim ────────────────────────────────────────────────────────────
select pg_temp.assert('2a  the first like on a post alerts',
  pg_temp.claim('c6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001',
                '2026-10-14 09:00:00+00'), true);
select pg_temp.assert('2b  a like 1 minute later is quiet',
  pg_temp.claim('c6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001',
                '2026-10-14 09:01:00+00'), false);
select pg_temp.assert('2c  a like 14 minutes later is still quiet',
  pg_temp.claim('c6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001',
                '2026-10-14 09:14:00+00'), false);
select pg_temp.assert_count('2d  a quiet like does not move the window',
  (select count(*) from push_like_alerts
    where post_id = 'e6000000-0000-0000-0000-000000000001'
      and last_alert_at = '2026-10-14 09:00:00+00'), 1);
select pg_temp.assert('2e  a like 30 minutes after the alert alerts again',
  pg_temp.claim('c6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001',
                '2026-10-14 09:30:00+00'), true);
select pg_temp.assert_count('2f  … and starts a new window from then',
  (select count(*) from push_like_alerts
    where post_id = 'e6000000-0000-0000-0000-000000000001'
      and last_alert_at = '2026-10-14 09:30:00+00'), 1);
select pg_temp.assert('2g  the window is per post: another post''s first like alerts',
  pg_temp.claim('c6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000002',
                '2026-10-14 09:31:00+00'), true);

-- ── 1. Deny-all ─────────────────────────────────────────────────────────────
-- The rows above exist; an app role must see none of them and change none.
select pg_temp.set_user('c6000000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert_count('1a  the recipient cannot read their own rows',
  (select count(*) from push_like_alerts), 0);
select pg_temp.assert('1b  …nor insert one',
  pg_temp.allows($q$insert into push_like_alerts (recipient_id, post_id)
                    values ('c6000000-0000-0000-0000-000000000001',
                            'e6000000-0000-0000-0000-000000000001')$q$), false);
update push_like_alerts set last_alert_at = '2000-01-01';
delete from push_like_alerts;
reset role;
select pg_temp.assert_count('1c  …nor move or delete one (rows unchanged)',
  (select count(*) from push_like_alerts
    where recipient_id = 'c6000000-0000-0000-0000-000000000001'
      and last_alert_at > '2026-01-01'), 2);

set local role anon;
select pg_temp.assert('1d  anon cannot read it',
  pg_temp.allows($q$select count(*) from push_like_alerts$q$)
    and (select count(*) from push_like_alerts) > 0, false);
reset role;

-- 1a–1d hold through RLS alone: this harness re-grants every table to the app roles after
-- the replay, which undoes the migration's REVOKE (production keeps it, so there the roles
-- are refused outright). Pin the layer the assertions above rely on, so a future policy
-- cannot quietly open the table.
select pg_temp.assert('1e  RLS is on and the table has no policies',
  (select relrowsecurity from pg_class where oid = 'public.push_like_alerts'::regclass)
    and not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'push_like_alerts'), true);

-- ── 3. Cleanup ──────────────────────────────────────────────────────────────
delete from posts where id = 'e6000000-0000-0000-0000-000000000002';
select pg_temp.assert_count('3a  deleting a post removes its rows',
  (select count(*) from push_like_alerts where post_id = 'e6000000-0000-0000-0000-000000000002'), 0);

delete from profiles where id = 'c6000000-0000-0000-0000-000000000001';
select pg_temp.assert_count('3b  deleting the recipient''s profile removes theirs',
  (select count(*) from push_like_alerts where recipient_id = 'c6000000-0000-0000-0000-000000000001'), 0);

rollback;
