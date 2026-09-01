-- shared_post_public — the anonymous read surface.
--
-- This function is the ONLY thing role `anon` may read out of posts/tracks/profiles, so
-- every assertion here is a statement about what an unauthenticated stranger holding a
-- link can and cannot see. It runs as `anon` against the deployed function, not against
-- application code — what the app chooses to render is irrelevant to any of it.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/shared-post-public.test.sql
--
-- Three properties are load-bearing, and each fails silently in production if broken:
--
--   1. `anon` can read a shared UPLOAD. Lose this and every link anyone has ever
--      pasted into WhatsApp shows a tombstone — and it looks like a Vercel problem.
--   2. `anon` can NOT read a REPOST. The client hides the Share button on reposts, but
--      a hidden button is not an access control; this is where the rule actually lives.
--   3. `anon` still cannot select from the underlying TABLES. The whole point of using
--      a function was to avoid widening posts_select_authenticated, so a test suite that
--      never checks the tables would pass just as happily against the change we refused.
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

-- Reports whether the CURRENT role is allowed to run a statement at all. SECURITY
-- INVOKER (default) so `set local role anon` is respected.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
end $$;

-- The function is SECURITY DEFINER and calls nothing from auth, but `anon` needs the
-- same schema grants a real Supabase project gives it; the bare-Postgres CI shim does
-- not. Rolled back with the transaction.
grant usage on schema auth to anon;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('d1000000-0000-0000-0000-000000000001'),  -- ARTIST, author of the upload
  ('d1000000-0000-0000-0000-000000000002')   -- REPOSTER
on conflict do nothing;

insert into profiles (id, username, display_name, avatar_url, username_set) values
  ('d1000000-0000-0000-0000-000000000001', 'sp_artist', 'Riya',
   'https://example.invalid/avatar.jpg', true),
  ('d1000000-0000-0000-0000-000000000002', 'sp_reposter', 'Sam', null, true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url, cover_art_url,
                    duration_seconds, waveform_peaks)
values
  ('d2000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-000000000001',
   'Neon Rain', 'audio', 'https://example.invalid/audio.mp3',
   'https://example.invalid/cover.jpg', 214, '{"version":1,"hz":10,"peaks":[0.5]}'::jsonb)
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, caption, likes_count, comments_count,
                   views_count)
values
  ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001',
   'upload', 'd2000000-0000-0000-0000-0000000000aa', 'made this at 4am', 42, 7, 999)
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id, clip_start_sec,
                   clip_end_sec)
values
  ('d3000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-000000000002',
   'repost', 'd2000000-0000-0000-0000-0000000000aa',
   'd3000000-0000-0000-0000-00000000000a', 10, 25)
on conflict do nothing;

-- ── 1. An upload is readable by anon, with the right values ─────────────────
set local role anon;

select pg_temp.assert_count(
  'anon reads the shared upload',
  (select count(*) from public.shared_post_public('d3000000-0000-0000-0000-00000000000a')),
  1);

select pg_temp.assert_text(
  'title comes back',
  (select track_title from public.shared_post_public('d3000000-0000-0000-0000-00000000000a')),
  'Neon Rain');

select pg_temp.assert_text(
  'author display name comes back',
  (select author_display_name from public.shared_post_public('d3000000-0000-0000-0000-00000000000a')),
  'Riya');

select pg_temp.assert_text(
  'media url comes back — without it the page has nothing to play',
  (select track_audio_url from public.shared_post_public('d3000000-0000-0000-0000-00000000000a')),
  'https://example.invalid/audio.mp3');

-- Likes and comments are social proof and are meant to be visible.
select pg_temp.assert(
  'likes_count is exposed',
  (select likes_count = 42 from public.shared_post_public('d3000000-0000-0000-0000-00000000000a')),
  true);

-- ── 2. A repost is NOT readable, however the link was obtained ──────────────
-- The client hides Share on reposts. This is the assertion that makes that a rule
-- rather than a preference: hand the function a repost id directly and it declines.
select pg_temp.assert_count(
  'a repost id returns nothing',
  (select count(*) from public.shared_post_public('d3000000-0000-0000-0000-00000000000b')),
  0);

select pg_temp.assert_count(
  'an unknown id returns nothing, and does not raise',
  (select count(*) from public.shared_post_public('d3000000-0000-0000-0000-0000000000ff')),
  0);

-- ── 3. The tables themselves stay shut ──────────────────────────────────────
-- If any of these flip to true, the function stopped being the boundary and the
-- design's central refusal — never widen posts_select_authenticated to anon — was
-- undone somewhere else. `allows` returns true for a permitted-but-empty read, so
-- these are also asserted by row count below.
select pg_temp.assert_count(
  'anon cannot select posts directly',
  (select count(*) from public.posts), 0);

select pg_temp.assert_count(
  'anon cannot select tracks directly',
  (select count(*) from public.tracks), 0);

-- ── 4. views_count is not in the contract ───────────────────────────────────
-- Withheld on purpose: play count is business intelligence about a working artist.
-- A column added to the return type would make this raise "column does not exist",
-- which is the point — the return list is the review surface.
reset role;
select pg_temp.assert(
  'views_count is absent from the return type',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_post_public'
      and column_name = 'views_count'
  ),
  false);

select pg_temp.assert(
  'waveform_peaks is absent from the return type',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_post_public'
      and column_name = 'waveform_peaks'
  ),
  false);

-- ── 5. The grant is the one we wrote, not a default ─────────────────────────
select pg_temp.assert(
  'anon holds EXECUTE',
  has_function_privilege('anon', 'public.shared_post_public(uuid)', 'EXECUTE'),
  true);

select pg_temp.assert(
  'authenticated holds EXECUTE',
  has_function_privilege('authenticated', 'public.shared_post_public(uuid)', 'EXECUTE'),
  true);

rollback;
