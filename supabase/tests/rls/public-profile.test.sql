-- public_profile_card — the anonymous profile-link surface.
--
-- `livil-music.com/@<username>` is rendered for people with no account and fetched by
-- search-engine crawlers, so every assertion here is a statement about what a stranger
-- learns about a Livil user from a handle. Runs as `anon` against the deployed function.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/public-profile.test.sql
--
-- The load-bearing properties, each of which fails silently in production if broken:
--
--   1. The card returns a name, a handle, a photo and an artist flag — and NOTHING ELSE.
--      The return type is pinned below, so adding `bio` (or anything) to it fails here
--      rather than quietly publishing it to every crawler.
--   2. Unconfirmed sign-ups (ADR-0025) and unchosen usernames are invisible: their page
--      would otherwise be a stranger-readable record of an account that does not exist
--      yet, or a link that is about to break.
--   3. A display name that is really the email's local part never leaves the database.
--   4. `anon` still cannot select from `profiles` directly.
--
-- `anon` is deliberately given NO extra grants here (no usage on schema auth): the
-- function is SECURITY DEFINER and must work for anon exactly as production's anon is. A
-- harness grant would let a future switch to SECURITY INVOKER pass here and 503 in
-- production. That property is also pinned directly in §1.
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

create or replace function pg_temp.assert_text(label text, actual text, expected text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, coalesce(expected, 'NULL'), coalesce(actual, 'NULL');
  end if;
  raise notice 'ok    %', label;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 1 ARTIST      confirmed, username chosen, one live upload; email local part ≠ name
-- 2 LISTENER    confirmed, username chosen, no uploads (a repost only); no email at all
-- 3 UNCONFIRMED never confirmed their email, has an upload
-- 4 UNSET       confirmed, but still on a placeholder username, has an upload
-- 5 TAKEN DOWN  confirmed, username chosen, their only upload's track is taken down
-- 6 MAILNAME    confirmed, username chosen, display name IS the email's local part
insert into auth.users (id, email, email_confirmed_at) values
  ('e1000000-0000-0000-0000-000000000001', 'riya.real@example.invalid', now()),
  ('e1000000-0000-0000-0000-000000000002', null, now()),
  ('e1000000-0000-0000-0000-000000000003', null, null),
  ('e1000000-0000-0000-0000-000000000004', null, now()),
  ('e1000000-0000-0000-0000-000000000005', null, now()),
  ('e1000000-0000-0000-0000-000000000006', 'first.last@example.invalid', now())
on conflict do nothing;

insert into profiles (id, username, display_name, avatar_url, bio, username_set, email_confirmed) values
  ('e1000000-0000-0000-0000-000000000001', 'pp_riya', 'Riya',
   'https://example.invalid/riya.jpg', 'private-ish bio text', true, true),
  ('e1000000-0000-0000-0000-000000000002', 'pp_sam', 'Sam', null, null, true, true),
  ('e1000000-0000-0000-0000-000000000003', 'pp_ghost', 'Ghost', null, null, true, false),
  ('e1000000-0000-0000-0000-000000000004', 'pp_placeholder', 'New', null, null, false, true),
  ('e1000000-0000-0000-0000-000000000005', 'pp_struck', 'Struck', null, null, true, true),
  ('e1000000-0000-0000-0000-000000000006', 'pp_mailname', 'first.last', null, null, true, true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url, duration_seconds, taken_down_at)
values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'Neon Rain', 'audio', 'https://example.invalid/a.mp3', 200, null),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003',
   'Ghost Song', 'audio', 'https://example.invalid/g.mp3', 200, null),
  ('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004',
   'Placeholder Song', 'audio', 'https://example.invalid/p.mp3', 200, null),
  ('e2000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005',
   'Struck Song', 'audio', 'https://example.invalid/s.mp3', 200, null)
on conflict do nothing;

insert into posts (id, author_id, kind, track_id) values
  ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'upload', 'e2000000-0000-0000-0000-000000000001'),
  ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003',
   'upload', 'e2000000-0000-0000-0000-000000000003'),
  ('e3000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004',
   'upload', 'e2000000-0000-0000-0000-000000000004'),
  ('e3000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005',
   'upload', 'e2000000-0000-0000-0000-000000000005')
on conflict do nothing;

-- Struck's track is taken down AFTER it was posted, with the upload row LEFT IN PLACE.
-- ops_take_down_track deletes the posts in the same transaction, so this is the shape of
-- anything that sets the column without that delete (a future path, a restore race) —
-- the `taken_down_at is null` filter is what still keeps such a person from counting as
-- an artist. `livil.moderating` is the flag the takedown freeze trigger admits.
select set_config('livil.moderating', '1', true);
update tracks set taken_down_at = now() where id = 'e2000000-0000-0000-0000-000000000005';
select set_config('livil.moderating', '', true);

-- Sam reposts Riya. A repost is not publishing, so Sam stays a listener.
insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002',
   'repost', 'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- ── 1. The contract: four columns, definer rights, a pinned search_path ─────
-- Pinned as text so a widened return type fails HERE. If you are changing this string,
-- you are publishing a new field about every Livil user to every crawler — say so in the
-- migration header and in post-sharing.md §10 first.
select pg_temp.assert_text(
  'public_profile_card returns exactly handle, name, photo, artist flag',
  pg_get_function_result('public.public_profile_card(text)'::regprocedure),
  'TABLE(username text, display_name text, avatar_url text, is_artist boolean)');

select pg_temp.assert(
  'public_profile_card runs with definer rights (anon has no grant on auth or profiles)',
  (select prosecdef from pg_proc where oid = 'public.public_profile_card(text)'::regprocedure),
  true);

select pg_temp.assert(
  'public_profile_card pins its search_path',
  (select 'search_path=public, pg_temp' = any(proconfig)
     from pg_proc where oid = 'public.public_profile_card(text)'::regprocedure),
  true);

set local role anon;

-- ── 2. An artist's card is readable, with the right values ─────────────────
select pg_temp.assert_count(
  'anon reads an artist card',
  (select count(*) from public.public_profile_card('pp_riya')),
  1);

select pg_temp.assert_text(
  'display name comes back when it is not the email local part',
  (select display_name from public.public_profile_card('pp_riya')),
  'Riya');

select pg_temp.assert_text(
  'avatar comes back',
  (select avatar_url from public.public_profile_card('pp_riya')),
  'https://example.invalid/riya.jpg');

select pg_temp.assert(
  'an artist is flagged as an artist',
  (select is_artist from public.public_profile_card('pp_riya')),
  true);

-- People type and paste handles however they like; the link must still resolve.
select pg_temp.assert_count(
  'lookup ignores case and surrounding spaces',
  (select count(*) from public.public_profile_card('  PP_Riya ')),
  1);

-- ── 3. A listener's card exists, but is not an artist ───────────────────────
select pg_temp.assert_count(
  'anon reads a listener card (the link still works for sharing)',
  (select count(*) from public.public_profile_card('pp_sam')),
  1);

-- Sam has no email row at all. The email guard must not null a real name on a NULL email.
select pg_temp.assert_text(
  'a missing email does not hide a real display name',
  (select display_name from public.public_profile_card('pp_sam')),
  'Sam');

select pg_temp.assert(
  'a repost does not make someone an artist',
  (select is_artist from public.public_profile_card('pp_sam')),
  false);

select pg_temp.assert(
  'a taken-down track does not make someone an artist',
  (select is_artist from public.public_profile_card('pp_struck')),
  false);

-- ── 4. An email address never leaves through the display name ───────────────
select pg_temp.assert_count(
  'an account whose display name is its email local part still has a card',
  (select count(*) from public.public_profile_card('pp_mailname')),
  1);

select pg_temp.assert(
  'that display name comes back NULL, so the page shows the handle',
  (select display_name is null from public.public_profile_card('pp_mailname')),
  true);

-- ── 5. Accounts that must not be visible at all ─────────────────────────────
select pg_temp.assert_count(
  'an unconfirmed sign-up has no card',
  (select count(*) from public.public_profile_card('pp_ghost')),
  0);

select pg_temp.assert_count(
  'a placeholder username has no card',
  (select count(*) from public.public_profile_card('pp_placeholder')),
  0);

select pg_temp.assert_count(
  'an unknown handle returns nothing, and does not raise',
  (select count(*) from public.public_profile_card('nobody_here')),
  0);

select pg_temp.assert_count(
  'an empty handle returns nothing, and does not raise',
  (select count(*) from public.public_profile_card('')),
  0);

-- ── 6. The tables themselves stay shut ──────────────────────────────────────
-- The function exists so this never has to change. A suite that only exercised it would
-- pass just as happily against a widened profiles policy.
select pg_temp.assert_count(
  'anon still sees no profile rows directly',
  (select count(*) from public.profiles where username like 'pp\_%'),
  0);

reset role;

-- ── 7. The ADR-0025 cache is not trusted blindly ────────────────────────────
-- email_confirmed is a CACHE that is only ever wrong in the false direction (the purge
-- job heals it). A confirmed user whose cached flag still says false must be visible —
-- auth.users is the truth.
update profiles set email_confirmed = false where id = 'e1000000-0000-0000-0000-000000000001';

set local role anon;
select pg_temp.assert_count(
  'a stale false cache still resolves from auth.users',
  (select count(*) from public.public_profile_card('pp_riya')),
  1);
reset role;

rollback;
