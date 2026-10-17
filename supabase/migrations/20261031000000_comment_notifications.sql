-- ============================================================================
-- Comment notifications: "liked your comment" and "replied to your comment"
-- ============================================================================
--
-- Until now only the POST's author heard about comments. Two new activity types:
--
--   comment_like  — to the comment's author. One row per comment ("Sam and 2 others
--                   liked your comment"), agg_key 'comment_like:<comment_id>', counted and
--                   de-duplicated exactly like post likes (20260929010000): agg_count is
--                   recomputed from post_comment_likes, payload.notified pushes each liker
--                   once, an unlike recomputes, and the last unlike hides the row.
--   comment_reply — to the parent comment's author, one row per reply.
--
-- Both are created by activity_notify_comment, which the app calls after the like / reply
-- is written. Like activity_notify_post it is SECURITY DEFINER and proves the caller did
-- the thing (their like row, their reply) before writing anything. It also refuses
-- between blocked people — the comment_* kinds are the first whose recipient is not the
-- post's author, and can_comment_on_post only checks the author.
--
-- ── Old apps ────────────────────────────────────────────────────────────────
-- 2.0.7 and older crash their Activity screen on a type they do not know; 2.1.x skip it.
-- So activity_list — what every shipped app reads — never returns the new types, and new
-- apps read activity_list_v2, which returns everything. One exception, so an old app
-- loses nothing it had: a reply to the POST AUTHOR's own comment. The new app sends that
-- as comment_reply INSTEAD of "commented on your post" (told once, not twice), so for the
-- author activity_list returns it as the 'comment' it would have been — same payload
-- keys, so 2.1.x draws the old bubble and opens the comments at the reply.
-- The unread count still includes the new types (it is one number); an old app clears it
-- on opening Activity, and its user may get a push for a like or reply it cannot list.
--
-- ── Abuse ───────────────────────────────────────────────────────────────────
-- A reply notifies ONCE (agg_key 'comment_reply:<id>'), and a comment can no longer move
-- to another thread (section 0): before, an author could re-point an old comment's
-- parent_comment_id at anyone's comment on that post and announce it again and again.
-- A reply also needs can_comment_on_post — the post author's block / friends-only bar.
-- Blocked people are never counted or named in a comment's likes, and activity_list_v2
-- leaves out any row whose actor the viewer is blocked with.
--
-- ADDITIVE for shipped apps: the type check only widens, activity_list returns what it
-- did (no comment_* rows exist yet), nothing an old app calls changes shape, and no app
-- has ever updated a comment's parent_comment_id.
-- ============================================================================

-- ── 0. A comment stays in the thread it was posted in ───────────────────────
-- post_comments_update_self lets authors update their own rows, and no app uses it. Left
-- open, it re-aims replies (see Abuse above). The parent FK is ON DELETE CASCADE, so no
-- legitimate path ever changes it either.
create or replace function public.post_comments_freeze_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.parent_comment_id is distinct from old.parent_comment_id then
    raise exception 'a comment cannot move to another thread' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.post_comments_freeze_parent() from public, anon, authenticated;

drop trigger if exists trg_post_comments_freeze_parent on public.post_comments;
create trigger trg_post_comments_freeze_parent
  before update of parent_comment_id on public.post_comments
  for each row execute function public.post_comments_freeze_parent();

-- ── 1. The two types ────────────────────────────────────────────────────────
alter table public.activity_notifications
  drop constraint if exists activity_notifications_type_check;

alter table public.activity_notifications
  add constraint activity_notifications_type_check check (type in (
    'like','comment','repost','play_milestone',
    'new_fan','friend_accepted','friend_rejected',
    'credited','credit_accepted','credit_declined',
    'badge_granted',
    'content_removed',
    -- payload: {"comment_id","comment_text","notified"}. agg_key 'comment_like:<id>'.
    'comment_like',
    -- payload: {"comment_id" (the reply),"comment_text" (the reply),"parent_comment_id"}.
    'comment_reply'
  ));

-- ── 2. Creating them ────────────────────────────────────────────────────────
-- p_comment_id is the LIKED comment for comment_like, and the REPLY for comment_reply.
-- recipient_is_post_author tells the app that this reply's recipient also owns the post,
-- so it skips the post's own "commented on your post" — one notification, not two.
create or replace function public.activity_notify_comment(p_comment_id uuid, p_type text)
returns table(
  recipient_id uuid,
  notification_id uuid,
  agg_count integer,
  actor_display_name text,
  recipient_should_push boolean,
  recipient_is_post_author boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_actor     uuid := auth.uid();
  v_recipient uuid;
  v_post      uuid;
  v_text      text;
  v_parent    uuid;
  v_is_author boolean;
  v_agg_key   text;
  v_id        uuid;
  v_count     int;
  v_name      text;
  v_seen      boolean;
begin
  if v_actor is null then return; end if;
  if p_type not in ('comment_like','comment_reply') then return; end if;

  -- ── AUTHORIZATION: the caller must have actually done it ─────────────────
  if p_type = 'comment_like' then
    select author_id, post_id, body into v_recipient, v_post, v_text
      from post_comments where id = p_comment_id;
    if v_recipient is null then return; end if;
    if not exists (
      select 1 from post_comment_likes where comment_id = p_comment_id and user_id = v_actor
    ) then return; end if;
  else
    -- The reply is the caller's, and its parent is a comment on the SAME post (nothing
    -- else enforces that a parent belongs to its reply's post).
    select r.parent_comment_id, r.post_id, r.body into v_parent, v_post, v_text
      from post_comments r where r.id = p_comment_id and r.author_id = v_actor;
    if v_parent is null then return; end if;
    select author_id into v_recipient
      from post_comments where id = v_parent and post_id = v_post;
    if v_recipient is null then return; end if;
    -- The post author's bar (a block, or "comments from friends only") holds for replies
    -- written before it, too.
    if not can_comment_on_post(v_post) then return; end if;
  end if;

  if v_recipient = v_actor then return; end if;
  if is_blocked_between(v_actor, v_recipient) then return; end if;

  select (author_id = v_recipient) into v_is_author from posts where id = v_post;
  select coalesce(display_name, '@' || username) into v_name from profiles where id = v_actor;
  v_text := substring(coalesce(v_text, '') from 1 for 280);

  if p_type = 'comment_like' then
    v_agg_key := 'comment_like:' || p_comment_id::text;

    -- The people (other than its author, and anyone they are blocked with) who like the
    -- comment right now.
    select count(*)::int into v_count
      from post_comment_likes l
     where l.comment_id = p_comment_id and l.user_id <> v_recipient
       and not is_blocked_between(l.user_id, v_recipient);

    select coalesce(n.payload -> 'notified' ? v_actor::text, false) into v_seen
      from activity_notifications n
     where n.recipient_id = v_recipient and n.agg_key = v_agg_key;
    v_seen := coalesce(v_seen, false);

    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, payload, updated_at)
    values
      (v_recipient, 'comment_like', v_actor, v_post, v_agg_key, v_count,
       jsonb_build_object(
         'comment_id', p_comment_id,
         'comment_text', v_text,
         'notified', jsonb_build_array(v_actor::text)),
       now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = v_count,
          actor_id   = excluded.actor_id,
          payload    = case
                         when v_seen then activity_notifications.payload
                         else jsonb_set(
                                activity_notifications.payload,
                                '{notified}',
                                coalesce(activity_notifications.payload -> 'notified', '[]'::jsonb)
                                  || to_jsonb(v_actor::text))
                       end,
          is_read    = case when v_seen then activity_notifications.is_read else false end,
          updated_at = case when v_seen then activity_notifications.updated_at else now() end
    returning id into v_id;

    return query select v_recipient, v_id, v_count, v_name, not v_seen, coalesce(v_is_author, false);
    return;
  end if;

  -- Once per reply: a repeat call writes nothing and so pushes nothing.
  insert into activity_notifications
    (recipient_id, type, actor_id, post_id, agg_key, payload, updated_at)
  values
    (v_recipient, 'comment_reply', v_actor, v_post, 'comment_reply:' || p_comment_id::text,
     jsonb_build_object(
       'comment_id', p_comment_id,
       'comment_text', v_text,
       'parent_comment_id', v_parent),
     now())
  on conflict (recipient_id, agg_key) where agg_key is not null do nothing
  returning id into v_id;
  if v_id is null then return; end if;

  return query select v_recipient, v_id, 1, v_name, true, coalesce(v_is_author, false);
end;
$function$;

revoke execute on function public.activity_notify_comment(uuid, text) from public, anon;
grant execute on function public.activity_notify_comment(uuid, text) to authenticated;

-- ── 3. An unlike takes its like back ────────────────────────────────────────
-- As activity_like_removed does for posts. When the COMMENT itself is being deleted, its
-- likes cascade away with it and it is already gone here: nothing to recount — section 4
-- removes the notification instead.
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
  select author_id into v_author from post_comments where id = old.comment_id;
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

drop trigger if exists trg_post_comment_likes_activity_removed on public.post_comment_likes;
create trigger trg_post_comment_likes_activity_removed
  after delete on public.post_comment_likes
  for each row execute function public.activity_comment_like_removed();

-- ── 4. A deleted comment takes its likes notification with it ───────────────
-- Otherwise "Sam liked your comment: …" would outlive the comment. (Replies keep their
-- notification, as comments on a post always have.)
create or replace function public.activity_comment_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from activity_notifications
   where recipient_id = old.author_id
     and agg_key = 'comment_like:' || old.id::text;
  return old;
end;
$$;

revoke execute on function public.activity_comment_deleted() from public, anon, authenticated;

drop trigger if exists trg_post_comments_activity_deleted on public.post_comments;
create trigger trg_post_comments_activity_deleted
  after delete on public.post_comments
  for each row execute function public.activity_comment_deleted();

-- ── 5. The lists ────────────────────────────────────────────────────────────
-- Shipped apps: exactly what they had — every type they know. Body as in 20260929010000,
-- plus the comment_* handling described at the top: no comment_like, and a comment_reply
-- only as the 'comment' on the recipient's own post that it replaces.
create or replace function public.activity_list(
  p_limit int default 50,
  p_before timestamptz default null
) returns table (
  id                 uuid,
  type               text,
  actor_id           uuid,
  post_id            uuid,
  agg_count          int,
  is_read            boolean,
  created_at         timestamptz,
  updated_at         timestamptz,
  payload            jsonb,
  actor_username     text,
  actor_display_name text,
  actor_avatar_url   text,
  post_title         text,
  post_cover_art_url text
) language sql security definer set search_path = public, pg_temp as $$
  select
    n.id,
    case when n.type = 'comment_reply' then 'comment' else n.type end,
    n.actor_id, n.post_id, n.agg_count, n.is_read,
    n.created_at, n.updated_at, n.payload,
    a.username, a.display_name, a.avatar_url,
    t.title, t.cover_art_url
  from activity_notifications n
  left join profiles a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  left join tracks t on t.id = p.track_id
  where n.recipient_id = auth.uid()
    and (p_before is null or n.updated_at < p_before)
    and not (n.type = 'like' and n.agg_count <= 0)
    and n.type <> 'comment_like'
    and (n.type <> 'comment_reply' or p.author_id = n.recipient_id)
  order by n.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;

-- New apps: every type, minus anything from someone the viewer is blocked with (a row
-- written before the block, or a like's actor re-pointed by an unlike).
create or replace function public.activity_list_v2(
  p_limit int default 50,
  p_before timestamptz default null
) returns table (
  id                 uuid,
  type               text,
  actor_id           uuid,
  post_id            uuid,
  agg_count          int,
  is_read            boolean,
  created_at         timestamptz,
  updated_at         timestamptz,
  payload            jsonb,
  actor_username     text,
  actor_display_name text,
  actor_avatar_url   text,
  post_title         text,
  post_cover_art_url text
) language sql security definer set search_path = public, pg_temp as $$
  select
    n.id, n.type, n.actor_id, n.post_id, n.agg_count, n.is_read,
    n.created_at, n.updated_at, n.payload,
    a.username, a.display_name, a.avatar_url,
    t.title, t.cover_art_url
  from activity_notifications n
  left join profiles a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  left join tracks t on t.id = p.track_id
  where n.recipient_id = auth.uid()
    and (p_before is null or n.updated_at < p_before)
    and not (n.type in ('like','comment_like') and n.agg_count <= 0)
    and (n.actor_id is null or not is_blocked_between(n.actor_id, n.recipient_id))
  order by n.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.activity_list_v2(int, timestamptz) from public, anon;
grant execute on function public.activity_list_v2(int, timestamptz) to authenticated;
