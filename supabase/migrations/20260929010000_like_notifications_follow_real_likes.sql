-- ============================================================================
-- Like notifications follow the real likes — an unlike takes its like back
-- ============================================================================
-- A post's likes are ONE aggregated notification per post ("Sam and 2 others liked your
-- post", agg_key 'like:<post_id>'). Until now:
--
--   * every like did `agg_count = agg_count + 1`, and an unlike did nothing at all, so
--     one person tapping like → unlike → like → unlike → like produced "Sam and 2 others
--     liked your post" on a post with ONE like — or with zero, if they ended on unlike;
--   * and every one of those likes sent the owner another push.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
--
-- 1. agg_count is RECOMPUTED from post_likes on every like and every unlike — the number
--    of distinct people (other than the author) who like the post right now. It can no
--    longer drift, because it is never incremented.
--
-- 2. An unlike (AFTER DELETE on post_likes) recomputes it too. If the unliker was the
--    person the notification names, it names the most recent remaining liker instead.
--    When nobody likes the post any more the row stays, at 0, marked read and hidden from
--    the Activity list (activity_list filters it) — kept rather than deleted so that
--    point 3 still knows who was already told about.
--
-- 3. One push per person per post. payload.notified is the list of actors the owner has
--    already been pushed about for this post; a like from someone already on it updates
--    the count silently (recipient_should_push = false) and does not re-surface the row
--    as unread. The client already honours recipient_should_push (src/services/
--    activity.ts notifyPostActivity).
--
-- Comments and reposts are untouched — only the 'like' branch of activity_notify_post
-- changes; the rest of the body is copied verbatim from 20260807020000.
--
-- ── EXISTING DATA ──────────────────────────────────────────────────────────
--
-- Every existing like notification has its agg_count corrected to the real count, and
-- payload.notified seeded with the current likers (they were each pushed about already).
-- Rows whose post has no likes left drop to 0 and disappear from the Activity list. The
-- inflated numbers are overwritten; they were wrong, so nothing of value is lost. No
-- notification row is deleted.
-- ============================================================================

-- ── 1. activity_notify_post: the like branch recomputes and de-duplicates ──
CREATE OR REPLACE FUNCTION public.activity_notify_post(p_post_id uuid, p_type text, p_comment_text text DEFAULT NULL::text, p_comment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(recipient_id uuid, notification_id uuid, agg_count integer, actor_display_name text, recipient_should_push boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_actor   uuid := auth.uid();
  v_author  uuid;
  v_agg_key text;
  v_id      uuid;
  v_count   int;
  v_name    text;
  v_payload jsonb := '{}'::jsonb;
  v_body    text;
  v_seen    boolean;
begin
  if v_actor is null then return; end if;
  if p_type not in ('like','comment','repost') then return; end if;

  select author_id into v_author from posts where id = p_post_id;
  if v_author is null or v_author = v_actor then return; end if;

  -- ── AUTHORIZATION: the caller must have actually performed the action ──────
  -- Authentication got us this far and proves nothing about this post.
  if p_type = 'like' then
    if not exists (
      select 1 from post_likes
      where post_id = p_post_id and user_id = v_actor
    ) then return; end if;

  elsif p_type = 'comment' then
    if not exists (
      select 1 from post_comments
      where post_id = p_post_id and author_id = v_actor
    ) then return; end if;

  else -- repost
    if not exists (
      select 1 from posts
      where original_post_id = p_post_id
        and author_id = v_actor
        and kind = 'repost'
    ) then return; end if;
  end if;

  select coalesce(display_name, '@' || username) into v_name
    from profiles where id = v_actor;

  if p_type = 'comment' and p_comment_id is not null then
    -- Snippet is read from the stored comment, never from the parameter. If the id
    -- does not name a comment the actor wrote on this post, v_body is null and the
    -- notification simply carries no snippet.
    select body into v_body
      from post_comments
     where id = p_comment_id
       and post_id = p_post_id
       and author_id = v_actor;

    if v_body is not null then
      v_payload := v_payload || jsonb_build_object(
        'comment_text', substring(v_body from 1 for 280),
        'comment_id',   p_comment_id
      );
    end if;
  end if;

  if p_type = 'like' then
    v_agg_key := 'like:' || p_post_id::text;

    -- The real number of people (other than the author) who like it right now.
    select count(*)::int into v_count
      from post_likes
     where post_id = p_post_id and user_id <> v_author;

    -- Was the owner already pushed about THIS person liking THIS post?
    select coalesce(n.payload -> 'notified' ? v_actor::text, false) into v_seen
      from activity_notifications n
     where n.recipient_id = v_author and n.agg_key = v_agg_key;
    v_seen := coalesce(v_seen, false);

    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, payload, updated_at)
    values
      (v_author, 'like', v_actor, p_post_id, v_agg_key, v_count,
       jsonb_build_object('notified', jsonb_build_array(v_actor::text)), now())
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

    return query select v_author, v_id, v_count, v_name, not v_seen;
    return;
  else
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, payload, updated_at)
    values
      (v_author, p_type, v_actor, p_post_id, v_payload, now())
    returning id, 1 into v_id, v_count;
  end if;

  return query select v_author, v_id, v_count, v_name, true;
end;
$function$
;

-- ── 2. An unlike takes its like back ─────────────────────────────────────
create or replace function public.activity_like_removed()
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
  select author_id into v_author from posts where id = old.post_id;
  -- The post itself is being deleted (its notifications cascade away) or this is the
  -- author's own like, which never counted.
  if v_author is null or v_author = old.user_id then return old; end if;

  select count(*)::int into v_count
    from post_likes
   where post_id = old.post_id and user_id <> v_author;

  select user_id into v_latest
    from post_likes
   where post_id = old.post_id and user_id <> v_author
   order by created_at desc
   limit 1;

  update activity_notifications n
     set agg_count = v_count,
         actor_id  = case when n.actor_id = old.user_id then v_latest else n.actor_id end,
         is_read   = case when v_count = 0 then true else n.is_read end
   where n.recipient_id = v_author
     and n.agg_key = 'like:' || old.post_id::text;

  return old;
end;
$$;

revoke execute on function public.activity_like_removed() from public;
revoke execute on function public.activity_like_removed() from anon, authenticated;

drop trigger if exists trg_post_likes_activity_removed on public.post_likes;
create trigger trg_post_likes_activity_removed
  after delete on public.post_likes
  for each row execute function public.activity_like_removed();

-- ── 3. Hide a like notification nobody's like is behind any more ────────
-- Body copied verbatim from 20260608000000, plus the agg_count filter.
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
    and not (n.type = 'like' and n.agg_count <= 0)
  order by n.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;

-- ── 4. Correct what is already stored ───────────────────────────────────
update public.activity_notifications n
   set agg_count = coalesce(real.cnt, 0),
       actor_id  = case when coalesce(real.cnt, 0) = 0 then n.actor_id
                        when n.actor_id = any(real.ids) then n.actor_id
                        else real.latest end,
       is_read   = case when coalesce(real.cnt, 0) = 0 then true else n.is_read end,
       payload   = jsonb_set(coalesce(n.payload, '{}'::jsonb), '{notified}',
                             coalesce(to_jsonb(real.ids_text), '[]'::jsonb))
  from (
    select p.id as post_id,
           count(l.user_id)::int as cnt,
           array_agg(l.user_id order by l.created_at desc) filter (where l.user_id is not null) as ids,
           array_agg(l.user_id::text order by l.created_at desc) filter (where l.user_id is not null) as ids_text,
           (array_agg(l.user_id order by l.created_at desc) filter (where l.user_id is not null))[1] as latest
      from public.posts p
      left join public.post_likes l on l.post_id = p.id and l.user_id <> p.author_id
     group by p.id
  ) real
 where n.type = 'like'
   and n.post_id = real.post_id;

-- ── Self-test ───────────────────────────────────────────────────────────────
-- The unlike trigger only; the RPC's push de-duplication needs an authenticated caller
-- and is covered by supabase/tests/rls/like-notifications.test.sql. (auth.uid() is NOT
-- redefined here: that would replace the real function on the live database.)
do $verify$
declare
  v_owner uuid := '0b100000-0000-0000-0000-0000000000b1';
  v_fan   uuid := '0b200000-0000-0000-0000-0000000000b2';
  v_fan2  uuid := '0b300000-0000-0000-0000-0000000000b3';
  v_track uuid := '0a0a0a0a-1111-0000-0000-0000000000b1';
  v_post  uuid := '0a0a0a0a-2222-0000-0000-0000000000b1';
  v_cnt   int;
  v_actor uuid;
  v_read  boolean;
begin
  if has_function_privilege('anon', 'public.activity_like_removed()', 'EXECUTE') then
    raise exception 'VERIFY: activity_like_removed is anon-callable';
  end if;

  insert into auth.users (id, email) values
    (v_owner, 'verify-like-owner@livil.invalid'),
    (v_fan,   'verify-like-fan@livil.invalid'),
    (v_fan2,  'verify-like-fan2@livil.invalid')
  on conflict (id) do nothing;
  insert into public.profiles (id, username) values
    (v_owner, 'verify_like_owner'), (v_fan, 'verify_like_fan'), (v_fan2, 'verify_like_fan2')
  on conflict (id) do nothing;
  insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
  values (v_track, v_owner, 'Verify like', 'audio', 'https://example.invalid/l.mp3');
  insert into public.posts (id, author_id, kind, track_id)
  values (v_post, v_owner, 'upload', v_track);

  insert into public.post_likes (post_id, user_id) values (v_post, v_fan2);
  insert into public.post_likes (post_id, user_id) values (v_post, v_fan);
  -- As the pre-fix code would have left it: inflated, naming v_fan.
  insert into public.activity_notifications
    (recipient_id, type, actor_id, post_id, agg_key, agg_count, updated_at)
  values (v_owner, 'like', v_fan, v_post, 'like:' || v_post::text, 5, now());

  -- v_fan unlikes → count 1, now names v_fan2
  delete from public.post_likes where post_id = v_post and user_id = v_fan;
  select agg_count, actor_id into v_cnt, v_actor from public.activity_notifications
   where recipient_id = v_owner and agg_key = 'like:' || v_post::text;
  if v_cnt <> 1 or v_actor is distinct from v_fan2 then
    raise exception 'VERIFY: unlike should leave count 1 naming the remaining liker (count %, actor %)', v_cnt, v_actor;
  end if;

  -- v_fan2 unlikes → count 0, read, hidden
  delete from public.post_likes where post_id = v_post and user_id = v_fan2;
  select agg_count, is_read into v_cnt, v_read from public.activity_notifications
   where recipient_id = v_owner and agg_key = 'like:' || v_post::text;
  if v_cnt <> 0 or not v_read then
    raise exception 'VERIFY: last unlike should zero the count and mark read (count %, read %)', v_cnt, v_read;
  end if;

  delete from public.posts where id = v_post;
  delete from public.tracks where id = v_track;
  delete from public.profiles where id in (v_owner, v_fan, v_fan2);
  delete from auth.users where id in (v_owner, v_fan, v_fan2);
end
$verify$;
