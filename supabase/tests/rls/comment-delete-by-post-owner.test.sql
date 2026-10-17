-- Who may delete a comment (20261101000000_post_owner_deletes_comments.sql).
--
-- On B's repost of U's upload:
--   * A can delete A's own comment; B (the repost's owner) can delete anyone's;
--   * C cannot delete someone else's;
--   * B cannot delete comments on the ORIGINAL, and U cannot delete comments on B's repost.
--
-- A refused DELETE under RLS does not raise — it matches no rows — so each case is
-- asserted on whether the row is still there.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/comment-delete-by-post-owner.test.sql

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

create or replace function pg_temp.exists_comment(cid uuid)
returns boolean language sql as $$ select exists (select 1 from public.post_comments where id = cid) $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   U (…01) uploaded the track; B (…02) reposted it; A (…03) and C (…04) comment.
insert into auth.users (id) values
  ('d7777777-0000-0000-0000-000000000001'),
  ('d7777777-0000-0000-0000-000000000002'),
  ('d7777777-0000-0000-0000-000000000003'),
  ('d7777777-0000-0000-0000-000000000004')
on conflict do nothing;

insert into profiles (id, username, username_set) values
  ('d7777777-0000-0000-0000-000000000001', 'cd_uploader', true),
  ('d7777777-0000-0000-0000-000000000002', 'cd_reposter', true),
  ('d7777777-0000-0000-0000-000000000003', 'cd_a', true),
  ('d7777777-0000-0000-0000-000000000004', 'cd_c', true)
on conflict do nothing;

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('d8888888-0000-0000-0000-000000000001', 'd7777777-0000-0000-0000-000000000001',
   'Kesariya', 'audio', 'https://example.invalid/k.mp3')
on conflict do nothing;

insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('d9999999-0000-0000-0000-000000000001', 'd7777777-0000-0000-0000-000000000001',
   'upload', 'd8888888-0000-0000-0000-000000000001', null),
  ('d9999999-0000-0000-0000-000000000002', 'd7777777-0000-0000-0000-000000000002',
   'repost', 'd8888888-0000-0000-0000-000000000001', 'd9999999-0000-0000-0000-000000000001')
on conflict do nothing;

insert into post_comments (id, post_id, author_id, body) values
  -- on B's repost
  ('dccccccc-0000-0000-0000-000000000001', 'd9999999-0000-0000-0000-000000000002',
   'd7777777-0000-0000-0000-000000000003', 'A on the repost'),
  ('dccccccc-0000-0000-0000-000000000002', 'd9999999-0000-0000-0000-000000000002',
   'd7777777-0000-0000-0000-000000000004', 'C on the repost'),
  ('dccccccc-0000-0000-0000-000000000003', 'd9999999-0000-0000-0000-000000000002',
   'd7777777-0000-0000-0000-000000000003', 'A again on the repost'),
  -- on U's original
  ('dccccccc-0000-0000-0000-000000000004', 'd9999999-0000-0000-0000-000000000001',
   'd7777777-0000-0000-0000-000000000003', 'A on the original')
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body, parent_comment_id) values
  -- C's reply under A's comment on the repost
  ('dccccccc-0000-0000-0000-000000000005', 'd9999999-0000-0000-0000-000000000002',
   'd7777777-0000-0000-0000-000000000004', 'C replying to A', 'dccccccc-0000-0000-0000-000000000001')
on conflict do nothing;

-- ── C, D, E: not someone else's ─────────────────────────────────────────────
select pg_temp.set_user('d7777777-0000-0000-0000-000000000004');
set local role authenticated;
delete from post_comments where id = 'dccccccc-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#1 C cannot delete A''s comment',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000001'), true);

-- ── The original's uploader does not own the repost's comments ──────────────
select pg_temp.set_user('d7777777-0000-0000-0000-000000000001');
set local role authenticated;
delete from post_comments where id = 'dccccccc-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#2 U (the uploader) cannot delete a comment on B''s repost',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000002'), true);

-- ── B owns the repost's comments, and only those ────────────────────────────
select pg_temp.set_user('d7777777-0000-0000-0000-000000000002');
set local role authenticated;
delete from post_comments where id = 'dccccccc-0000-0000-0000-000000000004';
reset role;
select pg_temp.assert('#3 B cannot delete a comment on the ORIGINAL',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000004'), true);

select pg_temp.set_user('d7777777-0000-0000-0000-000000000002');
set local role authenticated;
delete from post_comments where id = 'dccccccc-0000-0000-0000-000000000002';
reset role;
select pg_temp.assert('#4 B deletes C''s comment on B''s repost',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000002'), false);

select pg_temp.set_user('d7777777-0000-0000-0000-000000000002');
set local role authenticated;
delete from post_comments where id = 'dccccccc-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#5 B deletes A''s comment on B''s repost',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000001'), false);
select pg_temp.assert('#5 and the reply under it goes with it',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000005'), false);

-- ── A still deletes A's own, anywhere ───────────────────────────────────────
select pg_temp.set_user('d7777777-0000-0000-0000-000000000003');
set local role authenticated;
delete from post_comments where id in ('dccccccc-0000-0000-0000-000000000003', 'dccccccc-0000-0000-0000-000000000004');
reset role;
select pg_temp.assert('#6 A deletes A''s own comment on the repost',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000003'), false);
select pg_temp.assert('#6 and on the original',
  pg_temp.exists_comment('dccccccc-0000-0000-0000-000000000004'), false);

rollback;
