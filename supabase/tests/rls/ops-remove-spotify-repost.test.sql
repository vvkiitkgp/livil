-- Removing a reported Spotify repost from the moderation queue (ADR-0027's ops gap).
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/ops-remove-spotify-repost.test.sql
--
-- What these pin: only an operator can remove one; it removes exactly that post and never
-- stands in for a track takedown; the decision lands in the ledger WITH the reports the
-- cascade is about to delete; the author is told, in words 2.1.x renders correctly; and
-- the queue says which reports are about a Spotify repost.
--
-- CI grants every table privilege to `authenticated` before these run, so a refusal here
-- cannot be a missing GRANT in disguise.

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

-- DISCARD PLANS: is_ops() is STABLE SQL and is inlined into cached plans (see
-- ops-track-review.test.sql); without it the operator's identity outlives the switch.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  discard plans;
end $$;

-- The SQLSTATE a statement fails with, or 'ok'. Asserting the code, not just "it failed",
-- so a refusal for the wrong reason (a typo, a missing column) cannot pass as a denial.
create or replace function pg_temp.outcome(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-000000000001', 'sharer@rsr.test'),
  ('5a000000-0000-0000-0000-000000000002', 'reporter@rsr.test'),
  ('5a000000-0000-0000-0000-000000000003', 'operator@rsr.test')
on conflict (id) do nothing;

insert into public.profiles (id, username) values
  ('5a000000-0000-0000-0000-000000000001', 'rsr_sharer'),
  ('5a000000-0000-0000-0000-000000000002', 'rsr_reporter'),
  ('5a000000-0000-0000-0000-000000000003', 'rsr_operator')
on conflict (id) do nothing;

insert into public.ops_users (user_id) values ('5a000000-0000-0000-0000-000000000003')
on conflict do nothing;

update public.app_switches set enabled = true where key = 'spotify_reposts';

insert into public.tracks (id, uploader_id, title, media_kind, audio_url) values
  ('5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001',
   'A Livil upload', 'audio', 'https://example.test/a.mp3')
on conflict (id) do nothing;

insert into public.posts (id, author_id, kind, spotify_track_id, caption) values
  ('5c000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001',
   'repost', '0zbf6dj8GkCdYRRRph7ELk', 'look at this cover')
on conflict (id) do nothing;

insert into public.posts (id, author_id, kind, track_id) values
  ('5c000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001',
   'upload', '5b000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.post_reports (id, post_id, reporter_id, reason, details) values
  ('5d000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000002', 'other', 'Cover photo is not appropriate')
on conflict (id) do nothing;

set local role authenticated;

-- ── 1. The queue names a Spotify repost ─────────────────────────────────────
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '1a  the queue returns the Spotify track id for a Spotify repost report',
  (select spotify_track_id = '0zbf6dj8GkCdYRRRph7ELk'
     from public.ops_reports_overview(false)
    where id = '5d000000-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  '1b  … and calls it a Spotify repost, not "(track unavailable)"',
  (select target_excerpt = '(Spotify repost)' and track_id is null and target_exists
     from public.ops_reports_overview(false)
    where id = '5d000000-0000-0000-0000-000000000001'),
  true);

select pg_temp.set_user('5a000000-0000-0000-0000-000000000002');
select pg_temp.assert(
  '1c  a non-operator still reads an empty queue',
  exists (select 1 from public.ops_reports_overview(true)),
  false);

-- ── 2. The gate ─────────────────────────────────────────────────────────────
select pg_temp.assert(
  '2a  a non-operator cannot remove a Spotify repost (42501)',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, 'no') $$) = '42501',
  true);

-- ── 3. What it refuses, as an operator ──────────────────────────────────────
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '3a  a blank reason is refused — the author is shown it',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, '   ') $$) = '22023',
  true);
select pg_temp.assert(
  '3b  a reason the ledger cannot hold is refused before anything is deleted',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, repeat('x', 1001)) $$) = '22023',
  true);
select pg_temp.assert(
  '3c  a Livil post is refused — that is a track takedown',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-000000000002'::uuid, 'wrong tool') $$) = '22023',
  true);
select pg_temp.assert(
  '3d  a post that does not exist says so',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-0000000000ff'::uuid, 'gone') $$) = 'P0002',
  true);

reset role;
select pg_temp.assert(
  '3e  none of those removed anything',
  (select count(*) = 2 from public.posts
    where author_id = '5a000000-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  '3f  … or wrote to the ledger',
  exists (select 1 from public.moderation_actions where action = 'remove_post'),
  false);
set local role authenticated;

-- ── 4. The removal ──────────────────────────────────────────────────────────
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '4a  an operator can remove a Spotify repost',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid,
    '  This post showed sexual or graphic material.  ') $$) = 'ok',
  true);

reset role;
select pg_temp.assert(
  '4b  the Spotify repost is gone',
  exists (select 1 from public.posts where id = '5c000000-0000-0000-0000-000000000001'),
  false);
select pg_temp.assert(
  '4c  the author''s Livil post is untouched',
  exists (select 1 from public.posts where id = '5c000000-0000-0000-0000-000000000002'),
  true);

select pg_temp.assert(
  '4d  the ledger names the operator, the author and the trimmed reason',
  (select actor_id = '5a000000-0000-0000-0000-000000000003'
      and target_owner_id = '5a000000-0000-0000-0000-000000000001'
      and track_id is null
      and reason = 'This post showed sexual or graphic material.'
     from public.moderation_actions where action = 'remove_post'),
  true);
select pg_temp.assert(
  '4e  the ledger kept what the post was',
  (select snapshot->>'spotify_track_id' = '0zbf6dj8GkCdYRRRph7ELk'
      and snapshot->>'caption' = 'look at this cover'
     from public.moderation_actions where action = 'remove_post'),
  true);
select pg_temp.assert(
  '4f  the ledger kept the report the cascade deleted',
  (select jsonb_array_length(snapshot->'reports') = 1
      and snapshot->'reports'->0->>'details' = 'Cover photo is not appropriate'
      and snapshot->'reports'->0->>'reporter_id' = '5a000000-0000-0000-0000-000000000002'
     from public.moderation_actions where action = 'remove_post'),
  true);
select pg_temp.assert(
  '4g  the report row itself went with the post',
  exists (select 1 from public.post_reports where id = '5d000000-0000-0000-0000-000000000001'),
  false);

-- 2.1.x reads any kind but 'repost' as an upload and a null title as "one of your posts".
select pg_temp.assert(
  '4h  the author is told, with no title and a kind 2.1.x words correctly',
  (select payload->>'kind' = 'spotify_repost'
      and payload->'track_title' = 'null'::jsonb
      and payload->>'reason' = 'This post showed sexual or graphic material.'
      and actor_id is null
     from public.activity_notifications
    where recipient_id = '5a000000-0000-0000-0000-000000000001'
      and type = 'content_removed'),
  true);

-- ── 5. Once only ────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '5a  a second removal of the same post says it is already gone',
  pg_temp.outcome($$ select public.ops_remove_spotify_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, 'again') $$) = 'P0002',
  true);
reset role;
select pg_temp.assert(
  '5b  … and writes no second ledger row',
  (select count(*) = 1 from public.moderation_actions where action = 'remove_post'),
  true);
set local role authenticated;
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '5c  a removal is not a rights strike',
  exists (select 1 from public.ops_takedown_counts()
           where uploader_id = '5a000000-0000-0000-0000-000000000001'),
  false);

rollback;
