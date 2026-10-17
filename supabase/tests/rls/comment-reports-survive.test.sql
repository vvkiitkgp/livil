-- Comment reports survive the comment (20261102000000_comment_reports_survive_delete.sql).
--
-- Riya reports Sam's comment on Omar's post; Omar (the post's owner) deletes it. Before,
-- the report was deleted with it. Now:
--   * the report stays, naming Sam and keeping his words and the post — all written by the
--     server from the stored comment, whatever the client sent;
--   * the moderation queue still shows it, marked as gone, with the words;
--   * the shipped app's four-field insert still works; a report of nothing is refused.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/comment-reports-survive.test.sql

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

-- Whether an insert was accepted; a NOT NULL or RLS refusal is "no".
create or replace function pg_temp.accepts(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when not_null_violation or insufficient_privilege then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   OMAR (…01) owns the post · SAM (…02) wrote the comment · RIYA (…03) reports it
--   OPS (…04) reads the queue
insert into auth.users (id) values
  ('a8888888-0000-0000-0000-000000000001'),
  ('a8888888-0000-0000-0000-000000000002'),
  ('a8888888-0000-0000-0000-000000000003'),
  ('a8888888-0000-0000-0000-000000000004')
on conflict do nothing;
insert into profiles (id, username, username_set) values
  ('a8888888-0000-0000-0000-000000000001', 'crs_omar', true),
  ('a8888888-0000-0000-0000-000000000002', 'crs_sam', true),
  ('a8888888-0000-0000-0000-000000000003', 'crs_riya', true),
  ('a8888888-0000-0000-0000-000000000004', 'crs_ops', true)
on conflict do nothing;
insert into ops_users (user_id) values ('a8888888-0000-0000-0000-000000000004') on conflict do nothing;
insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('a9999999-0000-0000-0000-000000000001', 'a8888888-0000-0000-0000-000000000001',
   'Kesariya', 'audio', 'https://example.invalid/k.mp3')
on conflict do nothing;
insert into posts (id, author_id, kind, track_id) values
  ('aaaaaaa1-0000-0000-0000-000000000001', 'a8888888-0000-0000-0000-000000000001',
   'upload', 'a9999999-0000-0000-0000-000000000001')
on conflict do nothing;
insert into post_comments (id, post_id, author_id, body) values
  ('abbbbbb1-0000-0000-0000-000000000001', 'aaaaaaa1-0000-0000-0000-000000000001',
   'a8888888-0000-0000-0000-000000000002', 'something abusive')
on conflict do nothing;

-- ── Riya reports it — as the shipped app does, four fields — and lies about whom ─
select pg_temp.set_user('a8888888-0000-0000-0000-000000000003');
set local role authenticated;
insert into post_comment_reports (id, comment_id, reporter_id, reason, details) values
  ('acccccc1-0000-0000-0000-000000000001', 'abbbbbb1-0000-0000-0000-000000000001',
   'a8888888-0000-0000-0000-000000000003', 'harassment', null);
-- A second report that names someone else as the reported user and fakes the words.
insert into post_comment_reports (id, comment_id, reporter_id, reason, reported_user_id, comment_excerpt, comment_post_id)
values ('acccccc1-0000-0000-0000-000000000002', 'abbbbbb1-0000-0000-0000-000000000001',
        'a8888888-0000-0000-0000-000000000003', 'spam',
        'a8888888-0000-0000-0000-000000000001', 'Omar said this', null);
select pg_temp.assert('#1 a report of no comment is refused',
  pg_temp.accepts($$
    insert into post_comment_reports (comment_id, reporter_id, reason)
    values (null, 'a8888888-0000-0000-0000-000000000003', 'spam')$$), false);
reset role;

select pg_temp.assert('#2 the shipped app''s report gets the server''s snapshot',
  (select reported_user_id = 'a8888888-0000-0000-0000-000000000002'
      and comment_excerpt = 'something abusive'
      and comment_post_id = 'aaaaaaa1-0000-0000-0000-000000000001'
     from post_comment_reports where id = 'acccccc1-0000-0000-0000-000000000001'), true);
select pg_temp.assert('#3 what the client claims is overwritten by the stored comment',
  (select reported_user_id = 'a8888888-0000-0000-0000-000000000002'
      and comment_excerpt = 'something abusive'
      and comment_post_id = 'aaaaaaa1-0000-0000-0000-000000000001'
     from post_comment_reports where id = 'acccccc1-0000-0000-0000-000000000002'), true);

-- ── Omar, the post's owner, deletes the comment ─────────────────────────────
select pg_temp.set_user('a8888888-0000-0000-0000-000000000001');
set local role authenticated;
delete from post_comments where id = 'abbbbbb1-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert('#4 the comment is gone',
  exists (select 1 from post_comments where id = 'abbbbbb1-0000-0000-0000-000000000001'), false);
select pg_temp.assert('#4 but both reports remain, still naming Sam and his words',
  (select count(*) = 2
          and bool_and(comment_id is null)
          and bool_and(reported_user_id = 'a8888888-0000-0000-0000-000000000002')
          and bool_and(comment_excerpt = 'something abusive')
     from post_comment_reports
    where id in ('acccccc1-0000-0000-0000-000000000001', 'acccccc1-0000-0000-0000-000000000002')), true);

-- ── The moderation queue still shows it ─────────────────────────────────────
select pg_temp.set_user('a8888888-0000-0000-0000-000000000004');
set local role authenticated;
select pg_temp.assert('#5 ops sees the report, its author, the words, and that it is gone',
  (select reported_username = 'crs_sam'
      and target_excerpt = 'something abusive'
      and target_exists = false
      and track_title = 'Kesariya'
     from ops_reports_overview(false) where id = 'acccccc1-0000-0000-0000-000000000001'), true);
reset role;

rollback;
