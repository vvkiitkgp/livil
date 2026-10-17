-- A posted comment cannot be edited (20261103000000_comment_text_locked.sql).
--
--   * its author cannot rewrite its words, or swap its song or GIF;
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
insert into post_comments (id, post_id, author_id, body) values
  ('b9999999-0000-0000-0000-000000000001', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', 'you are awful')
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body, gif_provider, gif_id, gif_width, gif_height) values
  ('b9999999-0000-0000-0000-000000000002', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', E'lol\n🎞 GIF', 'giphy', '3o7TKSjRrfIPjeiVyM', 200, 150)
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body, song_post_id, song_label) values
  ('b9999999-0000-0000-0000-000000000003', 'b8888888-0000-0000-0000-000000000001',
   'b6666666-0000-0000-0000-000000000001', E'listen\n🎵 Shared', 'b8888888-0000-0000-0000-000000000002', '🎵 Shared')
on conflict do nothing;

-- ── Sam cannot rewrite what he posted ───────────────────────────────────────
select pg_temp.set_user('b6666666-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.assert('#1 the words cannot be changed after posting', pg_temp.allows($$
  update post_comments set body = 'nice song 🙂' where id = 'b9999999-0000-0000-0000-000000000001'$$), false);
select pg_temp.assert('#2 nor the GIF swapped', pg_temp.allows($$
  update post_comments set gif_id = 'xT9IgG50Fb7Mi0prBC' where id = 'b9999999-0000-0000-0000-000000000002'$$), false);
select pg_temp.assert('#3 nor the shared song pointed elsewhere', pg_temp.allows($$
  update post_comments set song_post_id = 'b8888888-0000-0000-0000-000000000001'
   where id = 'b9999999-0000-0000-0000-000000000003'$$), false);
select pg_temp.assert('#4 nor the song''s label rewritten', pg_temp.allows($$
  update post_comments set song_label = '🎵 Something else' where id = 'b9999999-0000-0000-0000-000000000003'$$), false);
reset role;
select pg_temp.assert('#1 it still says what it said',
  (select body = 'you are awful' from post_comments where id = 'b9999999-0000-0000-0000-000000000001'), true);

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

rollback;
