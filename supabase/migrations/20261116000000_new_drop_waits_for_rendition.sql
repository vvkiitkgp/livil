-- ============================================================================
-- "New song from a friend" waits for the light copy
-- ============================================================================
--
-- WHY
--
-- The new-drop push (20261027000000, section 7) announces an upload to the uploader's
-- friends and starrers ~2–7 minutes after it lands — "be one of the first to listen".
-- Since 20261115000000 (ADR-0033) a heavy upload is re-encoded by a job that also runs
-- every 5 minutes, so the push and the light copy raced: about half the time the friend
-- who tapped the card got the raw 4K/WAV original and a spinner, on exactly the post we
-- had just asked them to be first to hear.
--
-- WHAT
--
-- push_run_new_drops() now announces an upload only once the transcoder has LOOKED at
-- it (tracks.transcode_status is set — `done` or `skipped` both mean the file that will
-- be served is the file that is there now), or once the upload is 30 minutes old — so a
-- stalled job delays the push, never cancels it. The existing 2-hour window still bounds
-- how late a drop can be announced. Body otherwise verbatim from 20261027000000.
--
-- PRODUCTION SAFETY — server-only; no app reads this function. Safe to apply any time.
-- ============================================================================

create or replace function public.push_run_new_drops()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_slot  public.push_slots;
  v_msg   public.push_messages;
  v_up    record;
  v_send  uuid;
  v_count integer;
  v_done  integer := 0;
  v_name  text;
  v_song  text;
begin
  select * into v_slot from public.push_slots where slot = 'new_drop' for update;
  if not found or not v_slot.enabled then
    return 0;
  end if;

  for v_up in
    select * from (
      select distinct on (u.author_id)
             u.id, u.author_id, u.created_at, t.title, a.display_name, a.username, a.avatar_url
        from public.posts u
        join public.tracks t on t.id = u.track_id and t.uploader_id = u.author_id
        join public.profiles a on a.id = u.author_id
       where u.kind = 'upload'
         and u.created_at < now() - interval '2 minutes'
         and u.created_at > greatest(now() - interval '2 hours', v_slot.updated_at)
         -- The light copy is in place (or the file never needed one) — or the
         -- transcoder is late and the drop should not wait on it any longer.
         and (t.transcode_status is not null
              or u.created_at < now() - interval '30 minutes')
         and not exists (select 1 from public.push_sends s
                          where s.slot = 'new_drop' and s.post_id = u.id)
         and not exists (select 1 from public.push_sends s
                          where s.slot = 'new_drop' and s.author_id = u.author_id
                            and s.created_at > now() - interval '24 hours')
       order by u.author_id, u.created_at
    ) one_each
     order by one_each.created_at
     limit 50
  loop
    select * into v_msg
      from public.push_messages m
     where m.pool = 'new_drop' and m.active
     order by (m.position <= v_slot.last_position), m.position
     limit 1;
    if not found then
      return v_done;
    end if;

    v_send := null;  -- RETURNING INTO leaves it untouched on a conflict
    insert into public.push_sends (slot, kind, message_id, post_id, author_id)
    values ('new_drop', 'new_drop', v_msg.id, v_up.id, v_up.author_id)
    on conflict do nothing
    returning id into v_send;
    if v_send is null then
      continue;  -- announced by a concurrent run
    end if;

    v_name := public.push_person_name(v_up.display_name, v_up.username);
    v_song := public.push_song_title(v_up.title);

    insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
    select v_send, r.id,
           public.push_render_drop(v_msg.title, v_name, v_song),
           public.push_render_drop(v_msg.body,  v_name, v_song),
           v_up.avatar_url
      from (
        select case when f.user_a_id = v_up.author_id then f.user_b_id else f.user_a_id end as id
          from public.friendships f
         where f.status = 'accepted'
           and (f.user_a_id = v_up.author_id or f.user_b_id = v_up.author_id)
        union
        select fo.follower_id
          from public.follows fo
         where fo.following_id = v_up.author_id and fo.kind = 'star'
      ) r
     where r.id <> v_up.author_id
       and exists (select 1 from public.device_tokens t where t.user_id = r.id)
       and coalesce((select np.new_music from public.notification_preferences np
                      where np.user_id = r.id), true)
       and not public.is_blocked_between(r.id, v_up.author_id)
       and not exists (
         select 1 from public.push_deliveries d
           join public.push_sends s on s.id = d.send_id
          where d.recipient_id = r.id
            and s.slot = 'new_drop'          -- an operator's preview does not count
            and d.created_at > now() - interval '24 hours');

    get diagnostics v_count = row_count;
    update public.push_sends set recipients = v_count where id = v_send;
    update public.push_slots set last_position = v_msg.position where slot = 'new_drop';
    v_slot.last_position := v_msg.position;
    if v_count > 0 then
      perform public.push_dispatch(v_send);
    end if;
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

comment on function public.push_run_new_drops() is
  'Announces fresh uploads to friends and starrers, one per uploader per day. Waits for '
  'the transcoder to have looked at the track (tracks.transcode_status set) or for the '
  'upload to be 30 minutes old, whichever comes first (20261116000000).';
