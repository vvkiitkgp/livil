-- Takedown — the first thing in Livil that can remove somebody else's content.
--
-- WHY THIS FILE IS NOT OPTIONAL. Five defects in the first draft of the takedown
-- migration survived review, typecheck, lint and 636 Jest tests, and were caught only by
-- EXECUTING SQL. Three of them were silent and in the safe-looking direction: the
-- operator screen said "Taken down" while the audio was streaming again. None of those
-- three is expressible in TypeScript.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/takedown.test.sql
--
-- NOTE ON WHY A DENIAL HERE PROVES SOMETHING: CI grants every table privilege to
-- `authenticated` before these run, so a refusal cannot be a missing GRANT in disguise.

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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql security definer as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when raise_exception        then return false;
  when check_violation        then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('0aaa0000-0000-0000-0000-000000000001', 'uploader@td.test'),
  ('0bbb0000-0000-0000-0000-000000000002', 'stranger@td.test'),
  ('0ccc0000-0000-0000-0000-000000000003', 'operator@td.test'),
  ('0ddd0000-0000-0000-0000-000000000004', 'opsartist@td.test')
on conflict (id) do nothing;

insert into public.profiles (id, username) values
  ('0aaa0000-0000-0000-0000-000000000001', 'td_uploader'),
  ('0bbb0000-0000-0000-0000-000000000002', 'td_stranger'),
  ('0ccc0000-0000-0000-0000-000000000003', 'td_operator'),
  ('0ddd0000-0000-0000-0000-000000000004', 'td_opsartist')
on conflict (id) do nothing;

-- Two operators: one ordinary, and one who is ALSO an artist — the case where an
-- is_ops()-shaped trigger bypass let somebody erase their own strike.
insert into public.ops_users (user_id) values
  ('0ccc0000-0000-0000-0000-000000000003'),
  ('0ddd0000-0000-0000-0000-000000000004')
on conflict do nothing;

insert into public.tracks (id, uploader_id, title, media_kind, audio_url) values
  ('0eee0000-0000-0000-0000-000000000005', '0aaa0000-0000-0000-0000-000000000001',
   'Taken down soon', 'audio', 'https://example.test/a.mp3'),
  ('0fff0000-0000-0000-0000-000000000006', '0ddd0000-0000-0000-0000-000000000004',
   'The operator''s own track', 'audio', 'https://example.test/b.mp3')
on conflict (id) do nothing;

-- One upload post and one repost by a third party, so the delete has both to find.
insert into public.posts (id, author_id, kind, track_id, caption, clip_start_sec, clip_end_sec)
values ('01110000-0000-0000-0000-000000000007', '0aaa0000-0000-0000-0000-000000000001',
        'upload', '0eee0000-0000-0000-0000-000000000005', 'my banger', 10.5, 40.25)
on conflict (id) do nothing;

insert into public.posts (id, author_id, kind, track_id, original_post_id)
values ('02220000-0000-0000-0000-000000000008', '0bbb0000-0000-0000-0000-000000000002',
        'repost', '0eee0000-0000-0000-0000-000000000005',
        '01110000-0000-0000-0000-000000000007')
on conflict (id) do nothing;

set local role authenticated;

-- ── 1. The gate ─────────────────────────────────────────────────────────────
-- RAISES rather than returning quietly. Every ops READ in this project returns empty for
-- a non-operator so the route needs no guard — but a silent no-op WRITE would tell an
-- operator they had removed something that is still playing.
select pg_temp.set_user('0aaa0000-0000-0000-0000-000000000001');
select pg_temp.assert(
  'a non-operator cannot take a track down',
  pg_temp.allows($$ select public.ops_take_down_track('0eee0000-0000-0000-0000-000000000005'::uuid, 'nope') $$),
  false);

select pg_temp.assert(
  'a non-operator cannot restore either',
  pg_temp.allows($$ select public.ops_restore_track('0eee0000-0000-0000-0000-000000000005'::uuid, 'nope') $$),
  false);

-- ── 2. The delete reaches the repost as well as the upload ─────────────────
select pg_temp.set_user('0ccc0000-0000-0000-0000-000000000003');
select pg_temp.assert(
  'an operator can take a track down',
  pg_temp.allows($$ select public.ops_take_down_track('0eee0000-0000-0000-0000-000000000005'::uuid, 'test') $$),
  true);

set local role postgres;
select pg_temp.assert(
  'NOTHING is left serving the track — reposts included',
  exists (select 1 from public.posts where track_id = '0eee0000-0000-0000-0000-000000000005'::uuid),
  false);
set local role authenticated;

-- ── 3. THE ONE THAT MADE THE TOMBSTONE DECORATIVE ──────────────────────────
-- `posts_insert_own` constrains WHO THE AUTHOR IS, never WHICH TRACK IS SERVED, and every
-- track UUID is enumerable. Before the BEFORE INSERT trigger, any signed-in account could
-- undo a takedown with one insert while the operator screen still read "Taken down".
select pg_temp.set_user('0bbb0000-0000-0000-0000-000000000002');
select pg_temp.assert(
  'a STRANGER cannot re-post a taken-down track',
  pg_temp.allows($$
    insert into public.posts (author_id, kind, track_id)
    values ('0bbb0000-0000-0000-0000-000000000002', 'upload', '0eee0000-0000-0000-0000-000000000005')
  $$),
  false);

select pg_temp.set_user('0aaa0000-0000-0000-0000-000000000001');
select pg_temp.assert(
  'nor can the uploader',
  pg_temp.allows($$
    insert into public.posts (author_id, kind, track_id)
    values ('0aaa0000-0000-0000-0000-000000000001', 'upload', '0eee0000-0000-0000-0000-000000000005')
  $$),
  false);

-- ── 4. The uploader keeps their work, loses only the record ────────────────
select pg_temp.assert(
  'the uploader cannot clear their own tombstone',
  pg_temp.allows($$
    update public.tracks set taken_down_at = null
    where id = '0eee0000-0000-0000-0000-000000000005'::uuid
  $$),
  false);

-- "the uploader cannot delete a taken-down track" USED TO BE ASSERTED HERE and was
-- reversed in 20260923050000. The restriction existed so a strike could not be erased by
-- deleting the track — true while the count read `tracks.taken_down_at`. The count now
-- comes from the ledger, which has no foreign keys and outlives the track, so blocking
-- the delete only stopped somebody removing their own blocked upload from their own
-- profile. Section 11 asserts the delete works AND the strike survives it.

-- Nobody loses the ability to edit their own work. Only the record of a decision about it
-- is out of reach.
select pg_temp.assert(
  'the uploader can still edit the title',
  pg_temp.allows($$
    update public.tracks set title = 'renamed'
    where id = '0eee0000-0000-0000-0000-000000000005'::uuid
  $$),
  true);

-- ── 5. An operator who is also an artist is not above the ledger ───────────
-- The bypass is the CODE PATH, not the person. Bypassing on is_ops() let this account
-- erase its own strike with a plain PATCH and no ledger entry at all.
-- Set up through the REAL path, not by writing the column directly. A direct write is
-- refused by the freeze trigger even as the table owner — which is the trigger working,
-- and is why this fixture used to fail.
select pg_temp.set_user('0ccc0000-0000-0000-0000-000000000003');
select public.ops_take_down_track('0fff0000-0000-0000-0000-000000000006'::uuid, 'setup');

select pg_temp.set_user('0ddd0000-0000-0000-0000-000000000004');
select pg_temp.assert(
  'an operator cannot clear the tombstone on their OWN track outside the function',
  pg_temp.allows($$
    update public.tracks set taken_down_at = null
    where id = '0fff0000-0000-0000-0000-000000000006'::uuid
  $$),
  false);

-- ── 6. A second takedown must not destroy the snapshot ─────────────────────
select pg_temp.set_user('0ccc0000-0000-0000-0000-000000000003');
select pg_temp.assert(
  'a track cannot be taken down twice',
  pg_temp.allows($$ select public.ops_take_down_track('0eee0000-0000-0000-0000-000000000005'::uuid, 'again') $$),
  false);

-- ── 7. Restore returns the caption and clip, and only the uploader's post ──
select pg_temp.assert(
  'an operator can restore',
  pg_temp.allows($$ select public.ops_restore_track('0eee0000-0000-0000-0000-000000000005'::uuid, 'cleared') $$),
  true);

set local role postgres;
select pg_temp.assert(
  'the restored post carries the original caption and clip',
  exists (
    select 1 from public.posts
     where track_id = '0eee0000-0000-0000-0000-000000000005'::uuid
       and kind = 'upload' and caption = 'my banger'
       and clip_start_sec = 10.5 and clip_end_sec = 40.25
  ),
  true);

-- Reposts belonged to other people. Re-publishing under somebody else's name because a
-- later decision went the other way is not ours to do.
select pg_temp.assert(
  'the third party''s repost is NOT resurrected',
  exists (select 1 from public.posts
           where track_id = '0eee0000-0000-0000-0000-000000000005'::uuid and kind = 'repost'),
  false);
set local role authenticated;

-- ── 8. Restore on a live track would duplicate it ──────────────────────────
select pg_temp.assert(
  'restoring a track that is not down is refused',
  pg_temp.allows($$ select public.ops_restore_track('0eee0000-0000-0000-0000-000000000005'::uuid, 'twice') $$),
  false);

-- ── 9. The ledger is invisible and untouchable to clients ──────────────────
select pg_temp.set_user('0ccc0000-0000-0000-0000-000000000003');
select pg_temp.assert(
  'not even an operator reads moderation_actions directly',
  exists (select 1 from public.moderation_actions),
  false);

select pg_temp.allows($$
  insert into public.moderation_actions (action, track_id) values ('takedown', null)
$$);
set local role postgres;
select pg_temp.assert(
  'no client can write a moderation action',
  exists (select 1 from public.moderation_actions where track_id is null),
  false);

-- Append-only binds the OWNER too, which is the whole reason it is a trigger.
select pg_temp.assert(
  'the ledger cannot be edited, even as the table owner',
  pg_temp.allows($$ update public.moderation_actions set reason = 'rewritten' $$),
  false);

-- ── 9b. A blocked track cannot reach anybody's queue ───────────────────────
--
-- Deleting the posts removes a track from feeds, profiles, search and the share page.
-- It does NOT remove it from `album_tracks` or `user_recent_tracks`, which point straight
-- at `tracks` — so before 20260923060000 a blocked song was gone from everywhere somebody
-- would look and still playable from everywhere they would not think to check.
--
-- Making the ROW unreadable closes every such surface at once, including the ones not
-- written yet. The queue cannot contain what the client cannot fetch.
set local role postgres;
insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
values ('0bbb1111-0000-0000-0000-00000000000f'::uuid, '0bbb0000-0000-0000-0000-000000000002',
        'Blocked later', 'audio', 'https://example.test/q.mp3')
on conflict (id) do nothing;

set local role authenticated;
select pg_temp.set_user('0ddd0000-0000-0000-0000-000000000004');
select public.ops_take_down_track('0bbb1111-0000-0000-0000-00000000000f'::uuid, 'queue test');

-- A stranger cannot read the row at all, so nothing can build a playable item from it.
select pg_temp.set_user('0ccc0000-0000-0000-0000-000000000003');
select pg_temp.assert(
  'a blocked track is invisible to everyone else',
  exists (select 1 from public.tracks where id = '0bbb1111-0000-0000-0000-00000000000f'::uuid),
  false);

-- The owner must still see it, or the blocked card has nothing to render and the track
-- disappears silently again — the exact failure this whole feature exists to fix.
select pg_temp.set_user('0bbb0000-0000-0000-0000-000000000002');
select pg_temp.assert(
  'but its owner still sees it, reason and all',
  exists (
    select 1 from public.tracks
     where id = '0bbb1111-0000-0000-0000-00000000000f'::uuid
       and taken_down_reason = 'queue test'
  ),
  true);

-- Hand the role back. Section 10 deletes from `auth.users`, which `authenticated` cannot
-- do — and leaving the role switched is how this section broke the next one the first
-- time it was inserted here.
set local role postgres;

-- ── 10. Moderation must never make erasure impossible ──────────────────────
-- `on delete set null` is executed as an UPDATE, which fires the append-only trigger,
-- which raises — so the parent DELETE aborts and account deletion becomes impossible for
-- anyone who appears in the ledger. That is why these columns carry no foreign keys.
select pg_temp.assert(
  'a track with moderation history can still be deleted when it is not down',
  pg_temp.allows($$
    delete from public.tracks where id = '0eee0000-0000-0000-0000-000000000005'::uuid
  $$),
  true);

-- The operator's own account: `ops_users` cascades FIRST, so is_ops() on the very user
-- being deleted is already false by the time any tombstone column is touched.
select pg_temp.assert(
  'an operator who has taken something down can still delete their account',
  pg_temp.allows($$
    delete from auth.users where id = '0ccc0000-0000-0000-0000-000000000003'
  $$),
  true);

select pg_temp.assert(
  'an uploader named in the ledger can still delete their account',
  pg_temp.allows($$
    delete from auth.users where id = '0aaa0000-0000-0000-0000-000000000001'
  $$),
  true);

-- ── 11. The record survives what it describes ──────────────────────────────
--
-- Two requirements that looked contradictory: the uploader may delete their own blocked
-- track, and the uploader may not erase their own strike. They are compatible once the
-- strike lives in the ledger rather than on the track.
set local role authenticated;
select pg_temp.set_user('0ddd0000-0000-0000-0000-000000000004');

select pg_temp.assert(
  'the ops-artist track is still marked down before we start',
  exists (select 1 from public.tracks
           where id = '0fff0000-0000-0000-0000-000000000006'::uuid
             and taken_down_at is not null),
  true);

select pg_temp.assert(
  'the uploader CAN delete their own blocked track',
  pg_temp.allows($$
    delete from public.tracks where id = '0fff0000-0000-0000-0000-000000000006'::uuid
  $$),
  true);

set local role postgres;
select pg_temp.assert(
  'and the strike SURVIVES in the ledger',
  exists (
    select 1 from public.moderation_actions
     where action = 'takedown'
       and track_id = '0fff0000-0000-0000-0000-000000000006'::uuid
  ),
  true);

-- ── 12. The removal notice ─────────────────────────────────────────────────
-- The posts are still deleted — this is the record, not a hidden copy. One reader: the
-- person who lost the post.
--
-- Uses `0bbb` and `0ddd` rather than the uploader: section 10 deletes those accounts, and
-- `post_removals.author_id` references profiles.
set local role authenticated;
select pg_temp.set_user('0bbb0000-0000-0000-0000-000000000002');

select pg_temp.assert(
  'a user cannot write their own removal reason',
  pg_temp.allows($$
    insert into public.post_removals (post_id, author_id, track_id, kind, reason)
    values (gen_random_uuid(), '0bbb0000-0000-0000-0000-000000000002',
            '0eee0000-0000-0000-0000-000000000005', 'upload', 'I decided this was fine')
  $$),
  false);

set local role postgres;
insert into public.post_removals (post_id, author_id, track_id, kind, track_title, reason)
values (gen_random_uuid(), '0bbb0000-0000-0000-0000-000000000002',
        '0eee0000-0000-0000-0000-000000000005', 'repost', 'Taken down soon', 'because'),
       (gen_random_uuid(), '0ddd0000-0000-0000-0000-000000000004',
        '0eee0000-0000-0000-0000-000000000005', 'upload', 'Taken down soon', 'because');

set local role authenticated;
select pg_temp.set_user('0bbb0000-0000-0000-0000-000000000002');
select pg_temp.assert(
  'a user sees their own removal, and ONLY their own',
  (select count(*) from public.post_removals) = 1,
  true);

-- The other row is an UPLOAD removal carrying somebody else's details. Being involved in
-- the same track does not make it readable.
select pg_temp.assert(
  'and cannot see anybody else''s',
  exists (select 1 from public.post_removals where kind = 'upload'),
  false);

select pg_temp.set_user('0ddd0000-0000-0000-0000-000000000004');
select pg_temp.assert(
  'the other party sees theirs',
  (select count(*) from public.post_removals) = 1,
  true);

-- "Delete it" on the card dismisses the NOTICE. The post is already gone and the ledger
-- is untouched, so nobody clears a strike by tidying their profile.
select pg_temp.assert(
  'a user can dismiss their own removal notice',
  pg_temp.allows($$ delete from public.post_removals $$),
  true);

set local role postgres;
select pg_temp.assert(
  'dismissing it does NOT touch the ledger',
  exists (select 1 from public.moderation_actions where action = 'takedown'),
  true);

rollback;
