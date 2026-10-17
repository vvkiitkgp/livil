-- ============================================================================
-- A post's owner can delete any comment on it — their upload or their repost
-- ============================================================================
--
-- Until now only a comment's author could delete it (post_comments_delete_self). The
-- person whose post it is had no way to remove an unwanted comment under it. Now:
--
--   * A comments on B's repost → A can delete it (unchanged), and so can B;
--   * C, D, E — anyone else — still cannot;
--   * a repost is its own post: B owns the comments on B's repost, NOT the comments on the
--     original upload, and the original's uploader does not own the comments on B's repost.
--
-- Nobody is notified when their comment is deleted (owner's decision, 2026-10-17). Replies
-- under it go with it (parent_comment_id is ON DELETE CASCADE), as when its author deletes
-- it; the comments sheet's confirm already says so.
--
-- ADDITIVE: a second, permissive DELETE policy, OR-ed with post_comments_delete_self.
-- Shipped apps only offer Delete on your own comments, so for them nothing changes.
-- ============================================================================

drop policy if exists "post_comments_delete_post_owner" on public.post_comments;
create policy "post_comments_delete_post_owner" on public.post_comments
  for delete to authenticated
  using (exists (
    select 1 from public.posts p
     where p.id = post_comments.post_id
       and p.author_id = auth.uid()
  ));
