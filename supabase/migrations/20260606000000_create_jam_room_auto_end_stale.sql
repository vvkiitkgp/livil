-- Fix: create_jam_room was returning zombie active jams.
--
-- Repro (2026-06-06): a jam from 5 days earlier was still status='active'
-- because the host closed the app without tapping End. When another
-- conversation member tapped "Start jam", the idempotency lookup
-- returned that stale row, and the caller was added as a listener to
-- someone else's old jam instead of starting a fresh one as host.
--
-- Fix: auto-end any active jam whose host has been inactive for >1 hour
-- before running the idempotency lookup. host_clock_at is bumped on every
-- playback update; if it's null the jam was created but never played, so
-- fall back to created_at.

create or replace function create_jam_room(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_me uuid := auth.uid();
  v_stale_cutoff timestamptz := now() - interval '1 hour';
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  update jam_rooms
  set status = 'ended', ended_at = now()
  where conversation_id = p_conversation_id
    and status = 'active'
    and coalesce(host_clock_at, created_at) < v_stale_cutoff;

  select id into v_id
  from jam_rooms
  where conversation_id = p_conversation_id and status = 'active'
  limit 1;
  if v_id is not null then return v_id; end if;

  insert into jam_rooms (conversation_id, host_id, status)
  values (p_conversation_id, v_me, 'active')
  returning id into v_id;

  insert into jam_room_members (jam_room_id, user_id, role, permissions)
  values (v_id, v_me, 'host',
    '{"can_play_pause":true,"can_seek":true,"can_skip":true,"can_change_track":true,"can_suggest":true}'::jsonb);

  return v_id;
end;
$$;
