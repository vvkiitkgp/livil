-- Accepting a credit — the boundary, not the happy path.
--
-- Asserts the PROPERTIES this feature has to hold:
--   - the collaborator can answer, and only about themselves;
--   - answering writes STATUS and nothing else — the hole this migration closes is that
--     a tagged user could previously rewrite their own `role` on somebody else's track;
--   - an answer is final, so an accepted credit cannot be quietly flipped later;
--   - a declined credit is an answer, and the uploader is told;
--   - being credited notifies you exactly once, when the track is published — not again
--     every time somebody reposts it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/credits-accept-decline.test.sql
--
-- Runs after every migration, in the same ephemeral Postgres as authorization.test.sql.

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

create or replace function pg_temp.assert_eq(label text, actual text, expected text)
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

-- Reports whether the database allowed the statement. Only RLS denial is caught, so a
-- test cannot pass because of an unrelated error.
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
-- u1 uploads, u2 is credited, u3 is a stranger.
insert into auth.users (id, email) values
  ('cc000000-0000-0000-0000-000000000001', 'uploader@example.invalid'),
  ('cc000000-0000-0000-0000-000000000002', 'credited@example.invalid'),
  ('cc000000-0000-0000-0000-000000000003', 'stranger@example.invalid');

insert into profiles (id, username, username_set) values
  ('cc000000-0000-0000-0000-000000000001', 'cc_uploader', true),
  ('cc000000-0000-0000-0000-000000000002', 'cc_credited', true),
  ('cc000000-0000-0000-0000-000000000003', 'cc_stranger', true);

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-000000000001', 'Credit probe', 'audio', 'https://example.invalid/a.mp3');

-- Credits first, then the post — the order BOTH clients use, and what the notification
-- trigger depends on.
insert into track_collaborators (id, track_id, user_id, role) values
  ('cc000000-0000-0000-0000-0000000000b1',
   'cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-000000000002', 'Drums');

-- A credit naming nobody: a typed-in name has no one to answer for it.
insert into track_collaborators (id, track_id, custom_name, role) values
  ('cc000000-0000-0000-0000-0000000000b2',
   'cc000000-0000-0000-0000-0000000000a1', 'Session player', 'Bass');

insert into posts (id, author_id, kind, track_id) values
  ('cc000000-0000-0000-0000-0000000000c1',
   'cc000000-0000-0000-0000-000000000001', 'upload', 'cc000000-0000-0000-0000-0000000000a1');

-- ── 1. Publishing notifies the credited artist, once ─────────────────────────
select pg_temp.assert(
  'the credited artist is notified when the track is published',
  (select count(*) = 1 from activity_notifications
    where recipient_id = 'cc000000-0000-0000-0000-000000000002'
      and type = 'credited'),
  true);

select pg_temp.assert(
  'the notification carries the role it was for',
  (select payload->>'role' = 'Drums' from activity_notifications
    where recipient_id = 'cc000000-0000-0000-0000-000000000002' and type = 'credited'),
  true);

-- A repost creates a post row too. Re-notifying every collaborator on each repost would be
-- a notification bug with a very wide blast radius.
insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('cc000000-0000-0000-0000-0000000000c2',
   'cc000000-0000-0000-0000-000000000003', 'repost', 'cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-0000000000c1');

select pg_temp.assert(
  'a repost does NOT re-notify the collaborators',
  (select count(*) = 1 from activity_notifications
    where recipient_id = 'cc000000-0000-0000-0000-000000000002' and type = 'credited'),
  true);

-- ── 2. The collaborator cannot edit the row directly ─────────────────────────
set local role authenticated;
select pg_temp.set_user('cc000000-0000-0000-0000-000000000002');

-- The hole this migration closes. Before it, `..._or_self` let the tagged user update any
-- column on their own row — including promoting the role they were given.
select pg_temp.assert(
  'the credited artist canNOT rewrite their own role',
  (select count(*) > 0 from track_collaborators
     where id = 'cc000000-0000-0000-0000-0000000000b1' and role = 'Drums'),
  true);

update track_collaborators set role = 'Lead Vocals'
 where id = 'cc000000-0000-0000-0000-0000000000b1';

select pg_temp.assert(
  'the role is unchanged after the attempt (no rows matched the policy)',
  (select role = 'Drums' from track_collaborators
    where id = 'cc000000-0000-0000-0000-0000000000b1'),
  true);

select pg_temp.assert(
  'the credited artist canNOT set their own status directly either',
  (select status = 'pending' from track_collaborators
    where id = 'cc000000-0000-0000-0000-0000000000b1'),
  true);

-- ── 3. Answering, through the function ───────────────────────────────────────
select pg_temp.assert(
  'a pending credit appears in the tagged artist\'s list',
  (select count(*) = 1 from list_pending_credits()),
  true);

select pg_temp.assert_eq(
  'accepting returns the new status',
  (select credit_respond('cc000000-0000-0000-0000-0000000000b1', true)),
  'accepted');

select pg_temp.assert(
  'the row is accepted, and the role is still the one the uploader gave',
  (select status = 'accepted' and role = 'Drums' from track_collaborators
    where id = 'cc000000-0000-0000-0000-0000000000b1'),
  true);

select pg_temp.assert(
  'an answered credit leaves the pending list',
  (select count(*) = 0 from list_pending_credits()),
  true);

-- An answer is final: without this, an accepted credit could be flipped to declined long
-- after the track had been shared with the credit on it.
select pg_temp.assert(
  'answering twice is a no-op, not a reversal',
  (select credit_respond('cc000000-0000-0000-0000-0000000000b1', false) is null),
  true);

select pg_temp.assert(
  'the status survived the second answer',
  (select status = 'accepted' from track_collaborators
    where id = 'cc000000-0000-0000-0000-0000000000b1'),
  true);

select pg_temp.assert(
  'the uploader is told the credit was accepted',
  (select count(*) = 1 from activity_notifications
    where recipient_id = 'cc000000-0000-0000-0000-000000000001'
      and type = 'credit_accepted'),
  true);

-- The bot message that asked the question records the answer, so a reloaded bubble does
-- not keep offering buttons on a credit that is already settled.
select pg_temp.assert(
  'the asking message records the answer',
  (select payload->>'answered' = 'accepted' from activity_notifications
    where recipient_id = 'cc000000-0000-0000-0000-000000000002' and type = 'credited'),
  true);

-- ── 4. Answering for somebody else ───────────────────────────────────────────
select pg_temp.set_user('cc000000-0000-0000-0000-000000000003');

select pg_temp.assert(
  'a stranger cannot answer a credit that does not name them',
  (select credit_respond('cc000000-0000-0000-0000-0000000000b2', true) is null),
  true);

select pg_temp.assert(
  'a stranger sees no pending credits of their own',
  (select count(*) = 0 from list_pending_credits()),
  true);

-- Nobody can answer for a typed-in name: there is no account behind it.
select pg_temp.set_user('cc000000-0000-0000-0000-000000000001');
select pg_temp.assert(
  'the uploader cannot answer on a collaborator\'s behalf',
  (select credit_respond('cc000000-0000-0000-0000-0000000000b1', true) is null),
  true);

-- ── 5. Declining ─────────────────────────────────────────────────────────────
insert into track_collaborators (id, track_id, user_id, role) values
  ('cc000000-0000-0000-0000-0000000000b3',
   'cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-000000000003', 'Mixing');

select pg_temp.set_user('cc000000-0000-0000-0000-000000000003');
select pg_temp.assert_eq(
  'declining returns the new status',
  (select credit_respond('cc000000-0000-0000-0000-0000000000b3', false)),
  'declined');

select pg_temp.assert(
  'the uploader is told it was declined, so they do not simply re-add it',
  (select count(*) = 1 from activity_notifications
    where recipient_id = 'cc000000-0000-0000-0000-000000000001'
      and type = 'credit_declined'),
  true);

-- ── 6. The uploader keeps control of the list ────────────────────────────────
select pg_temp.set_user('cc000000-0000-0000-0000-000000000001');
update track_collaborators set role = 'Percussion'
 where id = 'cc000000-0000-0000-0000-0000000000b2';

select pg_temp.assert(
  'the uploader can still correct a credit they wrote',
  (select role = 'Percussion' from track_collaborators
    where id = 'cc000000-0000-0000-0000-0000000000b2'),
  true);

rollback;
