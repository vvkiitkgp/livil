-- One-shot resync of denormalized counters on `posts`.
--
-- The seed data wrote `comments_count`, `likes_count`, `reposts_count`,
-- and `views_count` directly without going through the AFTER-INSERT triggers
-- that maintain them, so the stored values drifted from the actual source
-- tables. FullScreenPlayer and PostCard read the stored values, so users were
-- seeing counts like "2 comments" with zero actual comment rows.
--
-- This migration recomputes each counter from the source-of-truth tables.
-- The triggers continue to keep things consistent going forward.

update public.posts p
   set comments_count = coalesce((
         select count(*) from public.post_comments c where c.post_id = p.id
       ), 0);

update public.posts p
   set likes_count = coalesce((
         select count(*) from public.post_likes l where l.post_id = p.id
       ), 0);

update public.posts p
   set reposts_count = coalesce((
         select count(*) from public.posts r
          where r.original_post_id = p.id and r.kind = 'repost'
       ), 0);

update public.posts p
   set views_count = coalesce((
         select count(*) from public.post_views v where v.post_id = p.id
       ), 0);
