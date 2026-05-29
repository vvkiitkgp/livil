-- create_jam_room: atomically creates the jam room and inserts the host as a member.
-- Uses security definer to bypass the conv_select RLS on the RETURNING clause.
create or replace function create_jam_room(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  -- Idempotent: return existing active jam for this conversation
  select id into v_id
  from jam_rooms
  where conversation_id = p_conversation_id and status = 'active'
  limit 1;
  if v_id is not null then return v_id; end if;

  insert into jam_rooms (conversation_id, host_id, status)
  values (p_conversation_id, v_me, 'active')
  returning id into v_id;

  -- Host gets full permissions
  insert into jam_room_members (jam_room_id, user_id, role, permissions)
  values (v_id, v_me, 'host',
    '{"can_play_pause":true,"can_seek":true,"can_skip":true,"can_change_track":true,"can_suggest":true}'::jsonb);

  return v_id;
end;
$$;

-- get_jam_snapshot: returns playback state + host info; upserts listener as member.
create or replace function get_jam_snapshot(p_jam_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_room jam_rooms%rowtype;
  v_host_username text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select * into v_room from jam_rooms where id = p_jam_room_id and status = 'active';
  if not found then raise exception 'jam_not_found'; end if;

  -- Upsert member so listeners can self-join
  insert into jam_room_members (jam_room_id, user_id, role, permissions)
  values (p_jam_room_id, v_me, 'listener',
    '{"can_play_pause":false,"can_seek":false,"can_skip":false,"can_change_track":false,"can_suggest":true}'::jsonb)
  on conflict (jam_room_id, user_id) do nothing;

  select username into v_host_username from profiles where id = v_room.host_id;

  return jsonb_build_object(
    'jam_room_id',          v_room.id,
    'host_id',              v_room.host_id,
    'host_username',        v_host_username,
    'playback_position_ms', coalesce(v_room.playback_position_ms, 0),
    'is_playing',           coalesce(v_room.is_playing, false),
    'host_clock_at',        v_room.host_clock_at
  );
end;
$$;
