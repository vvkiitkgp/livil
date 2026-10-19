-- Removing ONE reported repost — Spotify (ADR-0027) or Livil — from the moderation queue.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/ops-remove-repost.test.sql
--
-- What these pin: only an operator can remove one; it removes exactly that post — never
-- the original upload or anybody else's repost — and never stands in for a track takedown;
-- the decision lands in the ledger with a summary of the reports the cascade is about to
-- delete; the author is told, in words 2.1.x renders truthfully; and the queue says what
-- kind of post each report is about.
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
  ('5a000000-0000-0000-0000-000000000003', 'operator@rsr.test'),
  ('5a000000-0000-0000-0000-000000000004', 'listener@rsr.test')
on conflict (id) do nothing;

insert into public.profiles (id, username) values
  ('5a000000-0000-0000-0000-000000000001', 'rsr_sharer'),
  ('5a000000-0000-0000-0000-000000000002', 'rsr_reporter'),
  ('5a000000-0000-0000-0000-000000000003', 'rsr_operator'),
  ('5a000000-0000-0000-0000-000000000004', 'rsr_listener')
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

-- A Livil repost of that upload by the reporter, with a caption of their own, and a second
-- repost by somebody else. The first is reported; removing it must touch nothing else.
insert into public.posts (id, author_id, kind, track_id, original_post_id, caption) values
  ('5c000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000002',
   'repost', '5b000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000002',
   'a rude caption'),
  ('5c000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000003',
   'repost', '5b000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000002',
   null)
on conflict (id) do nothing;
insert into public.post_reports (id, post_id, reporter_id, reason) values
  ('5d000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000003',
   '5a000000-0000-0000-0000-000000000001', 'harassment')
on conflict (id) do nothing;
-- … and the reposter rewrites the caption once reported. The queue must still show what
-- was reported.
update public.posts set caption = 'great song'
 where id = '5c000000-0000-0000-0000-000000000003';

-- A listener who saved the song while playing it FROM that repost — which saves the
-- repost's id — in one playlist, and both the repost and the original in another.
insert into public.playlists (id, user_id, name) values
  ('5e100000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000004', 'from the repost'),
  ('5e100000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000004', 'has both')
on conflict (id) do nothing;
insert into public.playlist_posts (playlist_id, post_id, added_at) values
  ('5e100000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000003', '2026-01-02'),
  ('5e100000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000003', '2026-01-03'),
  ('5e100000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000002', '2026-01-01')
on conflict do nothing;

-- What a real reported post carries into the cascade: a like, a comment, and a report of
-- that comment — which must SURVIVE the post (20261102000000).
insert into public.post_likes (post_id, user_id) values
  ('5c000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002')
on conflict do nothing;
insert into public.post_comments (id, post_id, author_id, body) values
  ('5e000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000002', 'that cover though')
on conflict (id) do nothing;
insert into public.post_comment_reports (id, comment_id, reporter_id, reason) values
  ('5f000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001',
   '5a000000-0000-0000-0000-000000000001', 'harassment')
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

select pg_temp.assert(
  '1c  the queue says a Livil repost is a repost, names its track, and shows the caption AS REPORTED',
  (select post_kind = 'repost' and track_id = '5b000000-0000-0000-0000-000000000001'
      and spotify_track_id is null and post_caption = 'a rude caption'
     from public.ops_reports_overview(false)
    where id = '5d000000-0000-0000-0000-000000000002'),
  true);

select pg_temp.set_user('5a000000-0000-0000-0000-000000000002');
select pg_temp.assert(
  '1d  a non-operator still reads an empty queue',
  exists (select 1 from public.ops_reports_overview(true)),
  false);

-- ── 2. The gate ─────────────────────────────────────────────────────────────
select pg_temp.assert(
  '2a  a non-operator cannot remove a repost (42501)',
  pg_temp.outcome($$ select public.ops_remove_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, 'no') $$) = '42501',
  true);

-- ── 3. What it refuses, as an operator ──────────────────────────────────────
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '3a  a blank reason is refused — the author is shown it',
  pg_temp.outcome($$ select public.ops_remove_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, '   ') $$) = '22023',
  true);
select pg_temp.assert(
  '3b  a reason the ledger cannot hold is refused before anything is deleted',
  pg_temp.outcome($$ select public.ops_remove_repost(
    '5c000000-0000-0000-0000-000000000001'::uuid, repeat('x', 1001)) $$) = '22023',
  true);
select pg_temp.assert(
  '3c  an UPLOAD is refused — that is a track takedown',
  pg_temp.outcome($$ select public.ops_remove_repost(
    '5c000000-0000-0000-0000-000000000002'::uuid, 'wrong tool') $$) = '22023',
  true);
select pg_temp.assert(
  '3d  a post that does not exist says so',
  pg_temp.outcome($$ select public.ops_remove_repost(
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
  pg_temp.outcome($$ select public.ops_remove_repost(
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
  '4f  the ledger kept the report the cascade deleted — its count and category',
  (select (snapshot->>'report_count')::int = 1
      and jsonb_array_length(snapshot->'reports') = 1
      and snapshot->'reports'->0->>'reason' = 'other'
     from public.moderation_actions where action = 'remove_post'),
  true);
-- The ledger outlives every account and cannot be edited, and deleting a reporter's
-- account erases their report today. Copying who or their words would end that.
select pg_temp.assert(
  '4f2 … but not who reported it, or their words',
  (select not (snapshot->'reports'->0 ? 'reporter_id')
      and not (snapshot->'reports'->0 ? 'details')
      and position('Cover photo' in snapshot::text) = 0
     from public.moderation_actions where action = 'remove_post'),
  true);
select pg_temp.assert(
  '4g  the report row itself went with the post',
  exists (select 1 from public.post_reports where id = '5d000000-0000-0000-0000-000000000001'),
  false);

select pg_temp.assert(
  '4g2 the like and the comment went with the post',
  exists (select 1 from public.post_likes where post_id = '5c000000-0000-0000-0000-000000000001')
    or exists (select 1 from public.post_comments where id = '5e000000-0000-0000-0000-000000000001'),
  false);
select pg_temp.assert(
  '4g3 the report of that comment survives, still saying what was written',
  (select comment_id is null and comment_excerpt = 'that cover though'
     from public.post_comment_reports where id = '5f000000-0000-0000-0000-000000000001'),
  true);

-- 2.1.x reads any kind but 'repost' as an upload and a null title as "one of your posts".
select pg_temp.assert(
  '4h  the author is told, with no title and a kind 2.1.x words truthfully',
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
  pg_temp.outcome($$ select public.ops_remove_repost(
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

-- ── 6. A Livil repost: only that repost goes ───────────────────────────────
select pg_temp.assert(
  '6a  an operator can remove a Livil repost',
  pg_temp.outcome($$ select public.ops_remove_repost(
    '5c000000-0000-0000-0000-000000000003'::uuid, 'This post targeted a person.') $$) = 'ok',
  true);

reset role;
select pg_temp.assert(
  '6b  the reported repost is gone',
  exists (select 1 from public.posts where id = '5c000000-0000-0000-0000-000000000003'),
  false);
select pg_temp.assert(
  '6c  the original upload stays, still counting the repost that remains',
  (select reposts_count = 1 from public.posts where id = '5c000000-0000-0000-0000-000000000002'),
  true);
select pg_temp.assert(
  '6d  somebody else''s repost of the same song stays',
  exists (select 1 from public.posts where id = '5c000000-0000-0000-0000-000000000004'),
  true);
select pg_temp.assert(
  '6e  the song is not taken down',
  (select taken_down_at is null from public.tracks where id = '5b000000-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  '6f  the ledger records a Livil repost: its track (snapshot only), what came down, what was reported',
  (select track_id is null
      and target_owner_id = '5a000000-0000-0000-0000-000000000002'
      and snapshot->>'post_kind' = 'livil_repost'
      and snapshot->>'track_id' = '5b000000-0000-0000-0000-000000000001'
      and snapshot->>'caption' = 'great song'
      and snapshot->'reports'->0->>'caption' = 'a rude caption'
      and (snapshot->>'report_count')::int = 1
      and (snapshot->>'playlist_entries')::int = 2
      and (snapshot->>'jam_suggestions')::int = 0
     from public.moderation_actions
    where action = 'remove_post' and target_owner_id = '5a000000-0000-0000-0000-000000000002'),
  true);
-- Never kind 'repost' (2.1.x would say "the original is no longer on Livil") and never a
-- title (it would read "“A Livil upload” was removed from Livil").
select pg_temp.assert(
  '6g  the reposter is told, with no title and a kind 2.1.x words truthfully',
  (select payload->>'kind' = 'livil_repost'
      and payload->'track_title' = 'null'::jsonb
      and payload->>'reason' = 'This post targeted a person.'
     from public.activity_notifications
    where recipient_id = '5a000000-0000-0000-0000-000000000002'
      and type = 'content_removed'),
  true);
select pg_temp.assert(
  '6h  the uploader is told nothing — nothing of theirs was removed',
  exists (select 1 from public.activity_notifications
           where recipient_id = '5a000000-0000-0000-0000-000000000001'
             and type = 'content_removed'
             and payload->>'kind' = 'livil_repost'),
  false);

select pg_temp.assert(
  '6j  a playlist that held the repost now holds the original, keeping when it was added',
  (select count(*) = 1 and bool_and(post_id = '5c000000-0000-0000-0000-000000000002')
      and bool_and(added_at = '2026-01-02'::timestamptz)
     from public.playlist_posts where playlist_id = '5e100000-0000-0000-0000-000000000001'),
  true);
select pg_temp.assert(
  '6k  a playlist that held both keeps the original once, as it was',
  (select count(*) = 1 and bool_and(post_id = '5c000000-0000-0000-0000-000000000002')
      and bool_and(added_at = '2026-01-01'::timestamptz)
     from public.playlist_posts where playlist_id = '5e100000-0000-0000-0000-000000000002'),
  true);

set local role authenticated;
select pg_temp.set_user('5a000000-0000-0000-0000-000000000003');
select pg_temp.assert(
  '6i  the song''s takedown history does not list it — the track was not acted on',
  exists (select 1 from public.ops_moderation_history('5b000000-0000-0000-0000-000000000001')),
  false);

-- ── 7. A reporter cannot shape their own report ─────────────────────────────
-- Pre-marked reviewed (out of the open queue), backdated, and with words of their own in
-- place of the caption. The stored post decides the caption; the server decides the rest.
select pg_temp.set_user('5a000000-0000-0000-0000-000000000002');
insert into public.post_reports
  (id, post_id, reporter_id, reason, caption_excerpt, reviewed_at, reviewed_by, created_at)
values
  ('5d000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-000000000004',
   '5a000000-0000-0000-0000-000000000002', 'spam', 'words I made up',
   now(), '5a000000-0000-0000-0000-000000000003', '2020-01-01');
reset role;
select pg_temp.assert(
  '7a  the report starts unreviewed, dated now, with the stored caption (none) not the client''s',
  (select reviewed_at is null and reviewed_by is null
      and created_at > now() - interval '1 minute'
      and caption_excerpt is null
     from public.post_reports where id = '5d000000-0000-0000-0000-000000000009'),
  true);

rollback;
