-- ============================================================================
-- shared_repost_author: whose repost a chat message points at, when the reader may not
-- see the repost itself (owner, 2026-10-19)
-- ============================================================================
--
-- A repost sent in chat (src/utils/repostShare.ts, kb/architecture/post-sharing.md §11)
-- carries `metadata.repost_post_id`. The card reads the repost under the viewer's RLS. When
-- Riya keeps her reposts to friends (ADR-0028) and her friend Meera sends one to Sam, who is
-- not Riya's friend, Sam cannot read it — and the card fell back to the plain song card.
--
-- The owner's call: Sam's card says "Riya's repost" and "Only Riya's friends can see this
-- repost", with NO caption and NO song, and opens Riya's profile. Sam's app cannot learn
-- "Riya" by itself:
--   * reading the post is exactly what posts_select_authenticated refuses him;
--   * the message cannot carry it — metadata is whatever the sender's app wrote, so a
--     name or user id there would let anyone put "Riya's repost" over any song.
-- So this function answers that ONE question, and only for a message the caller can read.
--
-- ── WHAT IT REVEALS, AND TO WHOM ────────────────────────────────────────────
-- Returns the reposter's user id — nothing about the post (no caption, song, counts). The
-- app then reads that profile under profiles' own RLS, so an account the caller may not see
-- stays unseen. NULL unless ALL of:
--   1. the caller is a member of the message's conversation (msg_select's rule) and the
--      message is not deleted;
--   2. it points at a post of kind 'repost';
--   3. the SENDER may see that repost — posts_select_authenticated with the sender as the
--      viewer, repeated by hand because this is DEFINER. Without it, anyone could paste any
--      repost id into a message to a friend and read back who made it: an author oracle for
--      reposts hidden from them. With it, the function reveals only what the sender chose
--      to pass on and could already see;
--   4. no block between the caller and the reposter (a blocked pair learns nothing; the
--      card stays the plain song card).
-- What Sam learns is "Riya reposted THIS song": the message already carries the song the
-- sender chose to send (title / artist / artwork, or the Spotify link), and builds ≤ 2.1.3
-- draw it as the plain song card. The new app's locked card shows the name and NOT the song,
-- so it never draws a sender's (unchecked) pairing of the two. The owner accepted this, as
-- Instagram shows a private account's name over a shared post. Riya's caption, clip, likes
-- and comments stay friends-only.
--
-- Audience = whoever can read the message, now or later (msg_select): someone added to a
-- group after the share sees it too, and it survives the sender leaving — the sender chose
-- that chat. Clause 3 is checked LIVE, so once the sender can no longer see the repost
-- (unfriended, blocked, deleted) every old message stops naming Riya.
--
-- The predicate in clause 3 is one more hand copy of posts_select_authenticated, beside
-- record_post_impressions (20261019000000), activity_notify_mentions (20261110000000) and the
-- scheduled pushes (20261025000000). A change to that policy must update every copy.
--
-- ── OLD APPS ────────────────────────────────────────────────────────────────
-- Additive: a new function no shipped build calls. Nothing else changes. The new app falls
-- back to the plain song card when this function is missing, so the order the backend and
-- the app land in does not matter.
-- ============================================================================

create or replace function public.shared_repost_author(p_message_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select po.author_id
    from public.messages m
    join public.posts po
      on po.id = case
                   when m.metadata ->> 'repost_post_id'
                        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then (m.metadata ->> 'repost_post_id')::uuid
                 end
   where m.id = p_message_id
     and m.deleted_at is null
     and m.sender_id is not null
     -- 1. The caller may read the message (msg_select).
     and exists (
       select 1 from public.conversation_members cm
        where cm.conversation_id = m.conversation_id
          and cm.user_id = auth.uid()
     )
     -- 2. A repost.
     and po.kind = 'repost'
     -- 3. The SENDER may see it: posts_select_authenticated (20261019000000) with the
     --    sender as the viewer — the same predicate, not a paraphrase of it.
     and (
       po.author_id = m.sender_id
       or (
         not public.is_blocked_between(m.sender_id, po.author_id)
         and (
           po.kind <> 'repost'
           or public.reposts_public(po.author_id)
           or public.are_friends(m.sender_id, po.author_id)
         )
       )
     )
     -- 4. Nothing between the caller and the reposter.
     and not public.is_blocked_between(auth.uid(), po.author_id);
$$;

revoke all on function public.shared_repost_author(uuid) from public;
revoke execute on function public.shared_repost_author(uuid) from anon;
grant execute on function public.shared_repost_author(uuid) to authenticated;

comment on function public.shared_repost_author(uuid) is
  'Who made the repost a chat message points at (metadata.repost_post_id), for a member of '
  'that conversation, when the SENDER may see the repost and no block stands between the '
  'caller and the reposter; else NULL. Returns the user id only. Lets a non-friend''s card '
  'say "Riya''s repost — only her friends can see it" without showing the post. 20261112000000.';

do $$
begin
  if has_function_privilege('anon', 'public.shared_repost_author(uuid)', 'execute') then
    raise exception 'anon can execute public.shared_repost_author(uuid)';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.shared_repost_author(uuid)'::regprocedure) then
    raise exception 'shared_repost_author must be SECURITY DEFINER';
  end if;
end $$;
