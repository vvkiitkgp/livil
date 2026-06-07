-- Soften the original_post_id cascade.
--
-- Previously: deleting an upload CASCADED to every repost of it, wiping
-- other users' content without warning. That was too aggressive — a
-- reposter's own comments/likes on their repost are independent of the
-- original post and shouldn't vanish just because the original author
-- retracted theirs.
--
-- New behavior: deleting the original post NULLs out original_post_id on
-- every repost of it. The repost row survives with its own comments, likes,
-- views, and reposter intact. The UI detects the null original_post_id and
-- renders an "Original post not available" tombstone instead of playable
-- media.
--
-- The original post's own comments/likes/views are still hard-deleted via
-- their own ON DELETE CASCADE FKs — that's intentional (the author wants
-- their content gone).

alter table public.posts
  drop constraint if exists posts_original_post_id_fkey;

alter table public.posts
  add constraint posts_original_post_id_fkey
  foreign key (original_post_id) references public.posts(id) on delete set null;
