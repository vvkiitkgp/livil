-- Fix: 20260606000000_create_jam_room_auto_end_stale referenced
-- jam_rooms.created_at, but the column is actually started_at (defaults
-- to now()). The RPC raised 42703 "column \"created_at\" does not exist"
-- on every call, so Jam Rooms couldn't be started.
--
-- Replace created_at with started_at in the coalesce.

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
    and coalesce(host_clock_at, started_at) < v_stale_cutoff;

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
