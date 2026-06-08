-- Activity notifications: carry comment text + id in payload so the in-app
-- bubble can render the snippet inline ("X commented on your post: '…'") and
-- so the tap-through can highlight the originating comment in CommentsSheet.
--
-- Re-declares activity_notify_post with two new optional params. Existing
-- callers (like, repost) keep working — they pass NULL for both.

create or replace function public.activity_notify_post(
  p_post_id      uuid,
  p_type         text,                 -- 'like' | 'comment' | 'repost'
  p_comment_text text default null,
  p_comment_id   uuid default null
) returns table (
  recipient_id          uuid,
  notification_id       uuid,
  agg_count             int,
  actor_display_name    text,
  recipient_should_push boolean
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_actor   uuid := auth.uid();
  v_author  uuid;
  v_agg_key text;
  v_id      uuid;
  v_count   int;
  v_name    text;
  v_payload jsonb := '{}'::jsonb;
  v_snippet text;
begin
  if v_actor is null then return; end if;
  if p_type not in ('like','comment','repost') then return; end if;

  select author_id into v_author from posts where id = p_post_id;
  if v_author is null or v_author = v_actor then return; end if;

  select coalesce(display_name, '@' || username) into v_name
    from profiles where id = v_actor;

  if p_type = 'comment' then
    if p_comment_text is not null then
      v_snippet := substring(p_comment_text from 1 for 280);
      v_payload := v_payload || jsonb_build_object('comment_text', v_snippet);
    end if;
    if p_comment_id is not null then
      v_payload := v_payload || jsonb_build_object('comment_id', p_comment_id);
    end if;
  end if;

  if p_type = 'like' then
    v_agg_key := 'like:' || p_post_id::text;
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, updated_at)
    values
      (v_author, 'like', v_actor, p_post_id, v_agg_key, 1, now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = activity_notifications.agg_count + 1,
          actor_id   = excluded.actor_id,
          is_read    = false,
          updated_at = now()
    returning id, agg_count into v_id, v_count;
  else
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, payload, updated_at)
    values
      (v_author, p_type, v_actor, p_post_id, v_payload, now())
    returning id, 1 into v_id, v_count;
  end if;

  return query select v_author, v_id, v_count, v_name, true;
end;
$$;
