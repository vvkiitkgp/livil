-- The previous migration switched posts.original_post_id from CASCADE to
-- SET NULL so reposts survive when the original upload is deleted. But the
-- existing `posts_kind_shape_check` constraint requires that a repost row
-- always have a non-null original_post_id, which makes the SET NULL cascade
-- impossible — Postgres rejects the implicit UPDATE with:
--
--   new row for relation "posts" violates check constraint "posts_kind_shape_check"
--
-- Relax the constraint so:
--   - uploads must still have original_post_id = NULL (unchanged)
--   - reposts may have a non-null original_post_id (live) OR null (orphaned
--     after the original was deleted; rendered as a tombstone in the UI)
--
-- Application code (createRepost in src/services/posts.ts) still requires a
-- non-null original_post_id at insert time, so a NULL value can only appear
-- via the FK SET NULL cascade — which is exactly what we want.

alter table public.posts
  drop constraint if exists posts_kind_shape_check;

alter table public.posts
  add constraint posts_kind_shape_check
  check (
    (kind = 'upload' and original_post_id is null)
    or (kind = 'repost')
  );
