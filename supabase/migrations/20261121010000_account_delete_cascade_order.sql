-- ============================================================================
-- Account deletion: no longer depends on the order the database cascades in (2026-11-21)
-- ============================================================================
--
-- THE BUG. delete_my_account failed on production (four attempts, 2026-11-20/21) with
--   insert or update on table "activity_notifications" violates foreign key constraint
--   "activity_notifications_post_id_fkey"
-- The whole deletion rolls back, so the account stays — after the app has already deleted the
-- account's files from Storage (deleteMyAccount sweeps Storage before calling the RPC).
--
-- WHY. Until now the function deleted auth.users and let ONE cascade remove everything. RI
-- cascades run with fire_triggers = false: the AFTER triggers of each cascaded row are QUEUED
-- behind the profile's other cascades instead of running in between. So a counter or
-- notification trigger on a deleted child row can run after a parent it points at is gone but
-- before that parent's own cascades have removed the rows it is about to UPDATE — and if that
-- row was already modified earlier in the transaction, its FK check is not skipped and fails.
-- The failing case: the user liked Sam's comment on their OWN repost P.
--   1. activity_notifications.actor_id SET NULL rewrites "liked your comment" (row now
--      modified in this transaction);
--   2. the like is deleted — activity_comment_like_removed is queued;
--   3. P is deleted (posts.author_id) — its cascades are queued AFTER step 2's trigger;
--   4. the trigger runs, the comment still exists, it UPDATEs the notification → post_id
--      points at the deleted P → 23503.
-- It depends on which profile cascade fires first, which follows constraint OIDs. Production's
-- (from the 2026-07-07 dump restore, in table-name order) puts post_comment_likes before posts;
-- a fresh replay puts posts first, which is why CI never saw it. The same shape breaks other
-- triggers too — e.g. a friend's repost of your upload that you liked AND commented on: the
-- second counter update on it is FK-checked after your track (its track_id) is gone.
--
-- THE FIX, in two parts.
--   1. delete_my_account removes the user's posts, then their tracks, as separate statements
--      BEFORE auth.users. A plpgsql statement fires its own AFTER triggers when it ends, so each
--      finishes its whole cascade top-down — the post, then what hangs off it — while every
--      other row still exists. What is left for the auth.users cascade then only points at
--      other people's content, which stays. The end state is identical to before: the same
--      rows are deleted, only in a fixed order.
--   2. activity_comment_like_removed returns when the comment's POST is gone, as it already
--      did when the comment is gone — both are about to cascade away. activity_like_removed has
--      had this guard since 20260929010000. Defence in depth for any other path that deletes a
--      user or a post in one statement.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Checked at the last release (2.2.1, 1843c3c) and HEAD.
--   * delete_my_account keeps its name, no arguments, returns void, and the same grants
--     (create or replace keeps them; restated below). Installed apps call it exactly as before
--     and get the same outcome — the account and everything it made are gone — except that it
--     now succeeds for the accounts it used to fail for.
--   * activity_comment_like_removed is not callable by any app (trigger only, execute revoked).
--     For an ordinary unlike the post exists, so the added join changes nothing.
--   * No data is rewritten by applying this.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Written before auth.users goes, while the email and username are still readable.
  insert into public.deleted_accounts (email_sha256, username)
  select public.account_email_hash(u.email), lower(btrim(p.username))
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = v_me;

  -- End any jam this user is hosting first. host_id is about to become null, and a live
  -- room with no host is unusable but still advertised: broadcast_jam_state gates on
  -- `host_id = auth.uid()`, so nobody could ever drive it again.
  update public.jam_rooms
     set status = 'ended', ended_at = now()
   where host_id = v_me
     and status = 'active';

  -- A DM goes whole — ratified, not an oversight. Cascades from conversations take
  -- conversation_members, messages, message_reactions, jam_rooms and jam_queue with it.
  --
  -- EXACTLY TWO MEMBERS, and that clause is load-bearing. What the maintainer ratified is
  -- a two-party thread going with the party who leaves. `kind = 'dm'` alone does not mean
  -- two parties: 20260730000000 §6 closes the way a third person gets added, but a `dm`
  -- that already has three members would otherwise let one of them destroy the other two's
  -- history. Anything wider is treated as a group — only the departing user's own messages
  -- go, which is the fail-safe direction.
  delete from public.conversations c
   where c.kind = 'dm'
     and exists (
       select 1 from public.conversation_members m
        where m.conversation_id = c.id
          and m.user_id = v_me
     )
     and (select count(*) from public.conversation_members m2
           where m2.conversation_id = c.id) = 2;

  -- Groups keep everyone else's messages. Runs after the DM sweep, so this is the
  -- group remainder.
  delete from public.messages where sender_id = v_me;

  -- Storage is NOT touched here — see 20260802000000. The client sweeps it through the
  -- Storage API before calling this function.

  -- Posts, then tracks, each as its own statement — see the header (20261121010000). Each
  -- statement's cascade completes before the next begins, so no trigger meets a row whose
  -- parent this deletion has already removed. The tracks pass takes other people's reposts of
  -- these uploads with it, as the cascade always has (posts.track_id is ON DELETE CASCADE).
  -- Do NOT fold these back into the auth.users cascade.
  delete from public.posts  where author_id   = v_me;
  delete from public.tracks where uploader_id = v_me;

  -- The cascade does the rest: what remains points only at other people's content.
  delete from auth.users where id = v_me;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;

create or replace function public.activity_comment_like_removed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_count  int;
  v_latest uuid;
begin
  -- The comment, or the post under it, is being deleted (the notification cascades away with
  -- the post), or this is the author's own like, which never counted.
  select c.author_id into v_author
    from post_comments c
    join posts p on p.id = c.post_id
   where c.id = old.comment_id;
  if v_author is null or v_author = old.user_id then return old; end if;

  -- As activity_notify_comment counts: never someone the author is blocked with — nor
  -- name them in place of the unliker.
  select count(*)::int into v_count
    from post_comment_likes l
   where l.comment_id = old.comment_id and l.user_id <> v_author
     and not is_blocked_between(l.user_id, v_author);

  select l.user_id into v_latest
    from post_comment_likes l
   where l.comment_id = old.comment_id and l.user_id <> v_author
     and not is_blocked_between(l.user_id, v_author)
   order by l.created_at desc
   limit 1;

  update activity_notifications n
     set agg_count = v_count,
         actor_id  = case when n.actor_id = old.user_id then v_latest else n.actor_id end,
         is_read   = case when v_count = 0 then true else n.is_read end
   where n.recipient_id = v_author
     and n.agg_key = 'comment_like:' || old.comment_id::text;

  return old;
end;
$$;

revoke execute on function public.activity_comment_like_removed() from public, anon, authenticated;
