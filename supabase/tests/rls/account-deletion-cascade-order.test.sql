-- Account deletion must not depend on the order the database runs its cascades in
-- (20261121010000_account_delete_cascade_order.sql).
--
-- On production, deleting an account that had liked someone else's comment on its OWN post
-- failed with activity_notifications_post_id_fkey: the like's trigger ran after the post was
-- deleted but before the post's notifications had cascaded away. A friend's repost of the
-- user's upload, liked and commented on by the user, fails the same way through the counter
-- triggers (posts_track_id_fkey / posts_original_post_id_fkey). Whether either happens
-- depends on which of the profile's cascades fires first, which follows constraint OIDs —
-- production's dump-restored order differs from a fresh replay's. So this file runs the same
-- deletion under BOTH orders, by re-creating one constraint inside a savepoint (a re-created
-- constraint gets the newest OID, so its cascade fires last):
--   A  posts.author_id last  — production's order, the one that failed;
--   B  post_comment_likes.user_id last — the order a fresh replay happens to have.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/account-deletion-cascade-order.test.sql

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
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   DEPARTING (…01) — has a Spotify repost P1 and an upload P2; liked Sam's comment on each,
--                     and Sam's comment on Riya's post R; liked and commented on R itself,
--                     and on R2, Riya's repost of P2
--   SAM       (…02) — commented on P1, P2 and R
--   RIYA      (…03) — owns R and R2; liked Sam's comment on R too
insert into auth.users (id, email) values
  ('d8000000-0000-0000-0000-000000000001', 'cascade_departing@example.invalid'),
  ('d8000000-0000-0000-0000-000000000002', 'cascade_sam@example.invalid'),
  ('d8000000-0000-0000-0000-000000000003', 'cascade_riya@example.invalid');

insert into profiles (id, username, username_set) values
  ('d8000000-0000-0000-0000-000000000001', 'cascade_departing', true),
  ('d8000000-0000-0000-0000-000000000002', 'cascade_sam',       true),
  ('d8000000-0000-0000-0000-000000000003', 'cascade_riya',      true);

insert into tracks (id, uploader_id, title, media_kind, audio_url) values
  ('d8100000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000001',
   'Departing upload', 'audio', 'https://example.invalid/d.mp3'),
  ('d8100000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000003',
   'Riya upload', 'audio', 'https://example.invalid/r.mp3');

-- The repost on production was a Spotify one; the switch is on there and off in a replay.
update app_switches set enabled = true where key = 'spotify_reposts';
insert into posts (id, author_id, kind, track_id, spotify_track_id) values
  ('d8200000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001',
   'repost', null, '4uLU6hMCjMI75M1A2tKUQC'),
  ('d8200000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000001',
   'upload', 'd8100000-0000-0000-0000-000000000002', null),
  ('d8200000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000003',
   'upload', 'd8100000-0000-0000-0000-000000000003', null);

-- Riya reposts the departing user's upload, as the app does: same track, original named.
insert into posts (id, author_id, kind, track_id, original_post_id) values
  ('d8200000-0000-0000-0000-000000000004', 'd8000000-0000-0000-0000-000000000003',
   'repost', 'd8100000-0000-0000-0000-000000000002', 'd8200000-0000-0000-0000-000000000002');

insert into post_comments (id, post_id, author_id, body) values
  ('d8300000-0000-0000-0000-000000000001', 'd8200000-0000-0000-0000-000000000001',
   'd8000000-0000-0000-0000-000000000002', 'great pick'),
  ('d8300000-0000-0000-0000-000000000002', 'd8200000-0000-0000-0000-000000000002',
   'd8000000-0000-0000-0000-000000000002', 'love this'),
  ('d8300000-0000-0000-0000-000000000003', 'd8200000-0000-0000-0000-000000000003',
   'd8000000-0000-0000-0000-000000000002', 'on repeat'),
  ('d8300000-0000-0000-0000-000000000004', 'd8200000-0000-0000-0000-000000000003',
   'd8000000-0000-0000-0000-000000000001', 'proud of you'),
  ('d8300000-0000-0000-0000-000000000005', 'd8200000-0000-0000-0000-000000000004',
   'd8000000-0000-0000-0000-000000000001', 'thanks for sharing');

insert into post_likes (post_id, user_id) values
  ('d8200000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000001'),
  ('d8200000-0000-0000-0000-000000000004', 'd8000000-0000-0000-0000-000000000001');

-- Riya likes Sam's comment on her post first, then the departing user likes all three —
-- each announced through the real RPC, so the notifications are the ones the app makes.
reset role;
select pg_temp.set_user('d8000000-0000-0000-0000-000000000003');
set role authenticated;
insert into post_comment_likes (comment_id, user_id, created_at) values
  ('d8300000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000003', now() - interval '1 hour');
select count(*) from activity_notify_comment('d8300000-0000-0000-0000-000000000003', 'comment_like');

reset role;
select pg_temp.set_user('d8000000-0000-0000-0000-000000000001');
set role authenticated;
insert into post_comment_likes (comment_id, user_id) values
  ('d8300000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-000000000001'),
  ('d8300000-0000-0000-0000-000000000002', 'd8000000-0000-0000-0000-000000000001'),
  ('d8300000-0000-0000-0000-000000000003', 'd8000000-0000-0000-0000-000000000001');
select count(*) from activity_notify_comment('d8300000-0000-0000-0000-000000000001', 'comment_like');
select count(*) from activity_notify_comment('d8300000-0000-0000-0000-000000000002', 'comment_like');
select count(*) from activity_notify_comment('d8300000-0000-0000-0000-000000000003', 'comment_like');
reset role;

select pg_temp.assert('#0 Sam has a "liked your comment" for each of his three comments',
  (select count(*) = 3 from activity_notifications
    where recipient_id = 'd8000000-0000-0000-0000-000000000002' and type = 'comment_like'), true);

-- Runs the deletion as the departing user, then checks what is left. Called once per order.
create or replace function pg_temp.delete_and_check(label text)
returns void language plpgsql as $$
begin
  perform pg_temp.set_user('d8000000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';
  perform delete_my_account();
  execute 'reset role';

  perform pg_temp.assert(label || ' the account is gone',
    not exists (select 1 from auth.users where id = 'd8000000-0000-0000-0000-000000000001')
    and not exists (select 1 from profiles where id = 'd8000000-0000-0000-0000-000000000001')
    and not exists (select 1 from posts where author_id = 'd8000000-0000-0000-0000-000000000001'),
    true);
  perform pg_temp.assert(label || ' Sam''s comments on the departed posts, and their notifications, went with them',
    not exists (select 1 from post_comments
                 where id in ('d8300000-0000-0000-0000-000000000001', 'd8300000-0000-0000-0000-000000000002'))
    and not exists (select 1 from activity_notifications
                     where agg_key in ('comment_like:d8300000-0000-0000-0000-000000000001',
                                       'comment_like:d8300000-0000-0000-0000-000000000002')),
    true);
  perform pg_temp.assert(label || ' Riya''s repost of the departed upload went with the track',
    not exists (select 1 from posts where id = 'd8200000-0000-0000-0000-000000000004'), true);
  -- Riya's own post stays, and every counter on it is recomputed as on an unlike / a deleted
  -- comment: Sam's comment and Riya's like on it remain, the departed user's are gone.
  perform pg_temp.assert(label || ' Sam''s comment on Riya''s post now counts 1 like',
    (select c.like_count = 1 and n.agg_count = 1
       from post_comments c
       join activity_notifications n
         on n.recipient_id = 'd8000000-0000-0000-0000-000000000002'
        and n.agg_key = 'comment_like:' || c.id::text
      where c.id = 'd8300000-0000-0000-0000-000000000003'),
    true);
  perform pg_temp.assert(label || ' Riya''s post now counts 0 likes and 1 comment',
    (select likes_count = 0 and comments_count = 1
       from posts where id = 'd8200000-0000-0000-0000-000000000003'),
    true);
end $$;

-- ── A: production's order — posts.author_id cascades last ──────────────────
savepoint order_a;
alter table posts
  drop constraint posts_author_id_fkey,
  add constraint posts_author_id_fkey
    foreign key (author_id) references profiles (id) on delete cascade;
select pg_temp.delete_and_check('#1 (posts last)');
rollback to savepoint order_a;

-- ── B: a fresh replay's order — post_comment_likes.user_id cascades last ────
savepoint order_b;
alter table post_comment_likes
  drop constraint post_comment_likes_user_id_fkey,
  add constraint post_comment_likes_user_id_fkey
    foreign key (user_id) references profiles (id) on delete cascade;
select pg_temp.delete_and_check('#2 (likes last)');
rollback to savepoint order_b;

rollback;
