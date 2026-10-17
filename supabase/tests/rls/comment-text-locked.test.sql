-- A posted comment cannot be edited (20261103000000_comment_text_locked.sql).
--
--   * its author cannot rewrite its words, swap its song or GIF, or change its id or time;
--   * deleting it and posting the harmless version under the same id and time does not
--     work either: a new comment always gets a new id, the time now and no likes;
--   * its like counter still moves, deleting it still works, and deleting the post a
--     comment shared still clears that song (ON DELETE SET NULL).
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/comment-text-locked.test.sql

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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
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
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   SAM (…01) wrote the comments; RIYA (…02) owns the posts and likes a comment
insert into auth.users (id) values
  ('b6666666-0000-0000-0000-000000000001'),
  ('b6666666-0000-0000-0000-000000000002')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('b6666666-0000-0000-0000-000000000001', 'ctl_sam', true),
  ('b6666666-0000-0000-0000-000000000002', 'ctl_riya', true)
on conflict do nothing;
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('b7777777-0000-0000-0000-000000000001', 'b6666666-0000-0000-0000-000000000002',
   'Kesariya', 'audio', 'https://example.invalid/k.mp3'),
  ('b7777777-0000-0000-0000-000000000002', 'b6666666-0000-0000-0000-000000000002',
   'Shared', 'audio', 'https://example.invalid/s.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id) values
  ('b8888888-0000-0000-0000-000000000001', 'b6666666-0000-0000-0000-000000000002',
   'upload', 'b7777777-0000-0000-0000-000000000001'),
  ('b8888888-0000-0000-0000-000000000002', 'b6666666-0000-0000-0000-000000000002',
   'upload', 'b7777777-0000-0000-0000-000000000002')
on conflict do nothing;
-- Placed by the owner role, so they keep the ids written here (the insert clamp is for
-- rows that come in through the API).
insert into post_comments (id, post_id, author_id, body, created_at) values
  ('b9999999-0000-0000-0000-000000000001', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', 'you are awful', '2026-10-17 09:00:00+00')
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
  ('b9999999-0000-0000-0000-000000000002', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', E'lol\n🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 200, 150)
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body, song_post_id, song_label) values
  ('b9999999-0000-0000-0000-000000000003', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', E'listen\n🎵 Shared', 'b8888888-0000-0000-0000-000000000002', '🎵 Shared')
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body, song_spotify_track_id, song_label) values
  ('b9999999-0000-0000-0000-000000000004', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', E'this one\n🎵 Song — Artist', '4uLU6hMCjMI75M1A2tKUQC', '🎵 Song — Artist')
on conflict do nothing;
select pg_temp.assert('#0 rows placed by the owner role keep their id and time',
  (select created_at = '2026-10-17 09:00:00+00' from post_comments
    where id = 'b9999999-0000-0000-0000-000000000001'), true);

-- ── Sam cannot rewrite what he posted ───────────────────────────────────────
select pg_temp.set_user('b6666666-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#1 the words cannot be changed after posting', pg_temp.allows($$
  update post_comments set body = 'nice song 🙂' where id = 'b9999999-0000-0000-0000-000000000001'$$), false);
select pg_temp.assert('#2 nor the GIF swapped', pg_temp.allows($$
  update post_comments set gif_id = 'xT9IgG50Fb7Mi0prBC' where id = 'b9999999-0000-0000-0000-000000000002'$$), false);
select pg_temp.assert('#2b nor the GIF''s width changed', pg_temp.allows($$
  update post_comments set gif_width = 300 where id = 'b9999999-0000-0000-0000-000000000002'$$), false);
select pg_temp.assert('#2c nor its height', pg_temp.allows($$
  update post_comments set gif_height = 300 where id = 'b9999999-0000-0000-0000-000000000002'$$), false);
select pg_temp.assert('#3 nor the shared song pointed elsewhere', pg_temp.allows($$
  update post_comments set song_post_id = 'b8888888-0000-0000-0000-000000000001'
   where id = 'b9999999-0000-0000-0000-000000000003'$$), false);
select pg_temp.assert('#3b nor the shared song taken off by hand', pg_temp.allows($$
  update post_comments set song_post_id = null where id = 'b9999999-0000-0000-0000-000000000003'$$), false);
select pg_temp.assert('#4 nor the song''s label rewritten', pg_temp.allows($$
  update post_comments set song_label = '🎵 Something else' where id = 'b9999999-0000-0000-0000-000000000003'$$), false);
select pg_temp.assert('#4b nor a Spotify song swapped', pg_temp.allows($$
  update post_comments set song_spotify_track_id = '0VjIjW4GlUZAMYd2vXMi3b'
   where id = 'b9999999-0000-0000-0000-000000000004'$$), false);
select pg_temp.assert('#4c nor its time changed', pg_temp.allows($$
  update post_comments set created_at = now() + interval '5 years'
   where id = 'b9999999-0000-0000-0000-000000000001'$$), false);
select pg_temp.assert('#4d nor its id', pg_temp.allows($$
  update post_comments set id = 'b9999999-0000-0000-0000-0000000000ff'
   where id = 'b9999999-0000-0000-0000-000000000004'$$), false);
-- What an API upsert sends. The new row gets its own id, so it can never land on (and
-- update) the existing comment.
insert into post_comments (id, post_id, author_id, body)
values ('b9999999-0000-0000-0000-000000000001', 'b8888888-0000-0000-0000-000000000001',
        'b6666666-0000-0000-0000-000000000001', 'nice song 🙂')
on conflict (id) do update set body = excluded.body;
reset role;
select pg_temp.assert('#1 it still says what it said, at the time it said it, even after an upsert',
  (select body = 'you are awful' and created_at = '2026-10-17 09:00:00+00'
     from post_comments where id = 'b9999999-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#3b the shared song is still there',
  (select song_post_id = 'b8888888-0000-0000-0000-000000000002'
     from post_comments where id = 'b9999999-0000-0000-0000-000000000003'), true);
-- The upsert's comment, posted as a new one; cleared so later counts are not affected.
delete from post_comments where body = 'nice song 🙂';

-- ── What still works ────────────────────────────────────────────────────────
select pg_temp.set_user('b6666666-0000-0000-0000-000000000002');
set local role authenticated;
insert into post_comment_likes (comment_id, user_id)
values ('b9999999-0000-0000-0000-000000000001', 'b6666666-0000-0000-0000-000000000002');
reset role;
select pg_temp.assert('#5 a like still moves the counter',
  (select like_count = 1 from post_comments where id = 'b9999999-0000-0000-0000-000000000001'), true);

-- Riya deletes the post Sam's comment shared: the database clears the song, as before.
select pg_temp.set_user('b6666666-0000-0000-0000-000000000002');
set local role authenticated;
delete from posts where id = 'b8888888-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#6 deleting a shared post still clears the comment''s song',
  (select song_post_id is null and song_label = '🎵 Shared'
     from post_comments where id = 'b9999999-0000-0000-0000-000000000003'), true);

select pg_temp.set_user('b6666666-0000-0000-0000-000000000001');
set local role authenticated;
delete from post_comments where id = 'b9999999-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#7 its author can still delete it',
  exists (select 1 from post_comments where id = 'b9999999-0000-0000-0000-000000000001'), false);

-- ── Deleting and re-posting does not bring the old comment back ─────────────
-- Sam re-posts the harmless version under the deleted comment's id and time, with a
-- like count to pin it to the top of the thread.
select pg_temp.set_user('b6666666-0000-0000-0000-000000000001');
set local role authenticated;
insert into post_comments (id, post_id, author_id, body, created_at, like_count)
values ('b9999999-0000-0000-0000-000000000001', 'b8888888-0000-0000-0000-000000000001',
        'b6666666-0000-0000-0000-000000000001', 'great song!', '2026-10-17 09:00:00+00', 9999);
reset role;
select pg_temp.assert('#8 the old comment''s id stays empty',
  exists (select 1 from post_comments where id = 'b9999999-0000-0000-0000-000000000001'), false);
select pg_temp.assert('#9 the re-post is a new comment: new id, posted now, no likes',
  (select id <> 'b9999999-0000-0000-0000-000000000001'
      and created_at = now()
      and like_count = 0
     from post_comments where body = 'great song!'), true);

rollback;
