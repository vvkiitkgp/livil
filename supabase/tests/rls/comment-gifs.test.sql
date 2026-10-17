-- GIFs in comments (migration 20261030000000, ADR-0031).
--
-- What is pinned:
--   1. Old apps are untouched: a comment with no attachment columns still posts.
--   2. A whole GIF (provider + id + size) posts; a partial one is refused, because a GIF
--      without its provider or size cannot be drawn.
--   3. Only known providers and well-formed ids — the id is later sent to the provider by
--      the gifs edge function, so a malformed one must never be stored.
--   4. One attachment per comment: a GIF never rides with a song, on INSERT or UPDATE
--      (post_comments_update_self lets an author edit their own row).
--
-- Every statement under test runs as `authenticated`, so the checks are the deployed ones.
-- Each refusal is paired with a count of stored rows.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/comment-gifs.test.sql

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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- Whether the database ACCEPTED a write. A refusal by a check constraint and a refusal by
-- RLS both count as "no"; anything else is a real error and propagates.
create or replace function pg_temp.accepts(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when check_violation or insufficient_privilege then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id) values ('a6666666-0000-0000-0000-000000000001') on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('a6666666-0000-0000-0000-000000000001', 'gif_commenter', true)
on conflict do nothing;
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('b6666666-0000-0000-0000-000000000001', 'a6666666-0000-0000-0000-000000000001',
   'gif track', 'audio', 'https://example.invalid/g.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id) values
  ('c6666666-0000-0000-0000-000000000001', 'a6666666-0000-0000-0000-000000000001',
   'upload', 'b6666666-0000-0000-0000-000000000001')
on conflict do nothing;

select pg_temp.set_user('a6666666-0000-0000-0000-000000000001');

-- ============================================================================
-- 1. Old apps: no attachment columns at all
-- ============================================================================
set local role authenticated;
select pg_temp.assert('a plain comment (what old apps send) still posts', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body) values
    ('d6666666-0000-0000-0000-000000000001', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', 'love this')$$), true);

-- ============================================================================
-- 2. A whole GIF posts; a partial one does not
-- ============================================================================
select pg_temp.assert('a whole GIF posts', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
    ('d6666666-0000-0000-0000-000000000002', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', E'haha\n🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 200, 150)$$), true);

select pg_temp.assert('a GIF id without its size is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id) values
    ('d6666666-0000-0000-0000-000000000003', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM')$$), false);

select pg_temp.assert('a size without a GIF is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_width, gif_height) values
    ('d6666666-0000-0000-0000-000000000004', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', 'hm', 200, 150)$$), false);

-- ============================================================================
-- 3. Known providers, well-formed ids, sane sizes
-- ============================================================================
select pg_temp.assert('an unknown provider is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
    ('d6666666-0000-0000-0000-000000000005', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'tenor', '3o7TKSjRrfIPjeiVyM', 200, 150)$$), false);

select pg_temp.assert('an id that is a URL is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
    ('d6666666-0000-0000-0000-000000000006', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', 'https://evil.example/x.gif', 200, 150)$$), false);

select pg_temp.assert('an id with a path in it is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
    ('d6666666-0000-0000-0000-000000000007', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', '../../v1/gifs', 200, 150)$$), false);

select pg_temp.assert('a zero or huge size is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
    ('d6666666-0000-0000-0000-000000000008', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 0, 5000)$$), false);

-- ============================================================================
-- 4. One attachment per comment
-- ============================================================================
select pg_temp.assert('a GIF with a Spotify song is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height,
                             song_spotify_track_id, song_label) values
    ('d6666666-0000-0000-0000-000000000009', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 200, 150,
     '4uLU6hMCjMI75M1A2tKUQC', '🎵 Song — Artist')$$), false);

select pg_temp.assert('a GIF with a Livil song is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height,
                             song_post_id, song_label) values
    ('d6666666-0000-0000-0000-00000000000a', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 200, 150,
     'c6666666-0000-0000-0000-000000000001', '🎵 gif track')$$), false);

select pg_temp.assert('a GIF with a leftover song label is refused', pg_temp.accepts($$
  insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height, song_label) values
    ('d6666666-0000-0000-0000-00000000000b', 'c6666666-0000-0000-0000-000000000001',
     'a6666666-0000-0000-0000-000000000001', '🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 200, 150, '🎵 x')$$), false);

select pg_temp.assert('an author cannot add a song to their GIF comment afterwards', pg_temp.accepts($$
  update post_comments
     set song_spotify_track_id = '4uLU6hMCjMI75M1A2tKUQC', song_label = '🎵 Song — Artist'
   where post_id = 'c6666666-0000-0000-0000-000000000001' and gif_id is not null$$), false);

reset role;

select pg_temp.assert_count('only the plain comment and the whole GIF were stored',
  (select count(*) from post_comments where post_id = 'c6666666-0000-0000-0000-000000000001'), 2);
select pg_temp.assert('the GIF comment still has no song',
  (select song_spotify_track_id is null and song_label is null
     from post_comments where post_id = 'c6666666-0000-0000-0000-000000000001' and gif_id is not null), true);

rollback;
