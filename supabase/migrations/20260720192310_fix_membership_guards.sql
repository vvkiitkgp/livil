-- Adds authorization guards to three SECURITY DEFINER functions that bypass RLS.
--
-- Each previously checked only that the caller was AUTHENTICATED, which proves
-- nothing about whether they may touch the resource named in the parameters.
-- All three write to access-granting tables (conversations, conversation_members,
-- jam_rooms, jam_room_members) using a caller-supplied object id, so any
-- authenticated user holding a UUID could grant themselves access.
--
-- The guard pattern copies is_conversation_member() / assert_friendship(),
-- already used correctly by get_or_create_dm(). Bodies are otherwise preserved
-- VERBATIM FROM PRODUCTION as of 2026-07-21, including create_jam_room's
-- stale-jam cleanup, which exists live but not in any earlier migration file.

-- 1. create_jam_room: caller must be a member of the target conversation.
create or replace function public.create_jam_room(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_me uuid := auth.uid();
  v_stale_cutoff timestamptz := now() - interval '1 hour';
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  -- AUTHORIZATION: only a member of the conversation may start a jam in it.
  if not is_conversation_member(p_conversation_id) then
    raise exception 'not_conversation_member';
  end if;

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
$function$;

-- 2. get_jam_snapshot: caller must belong to the jam's parent conversation
--    before being self-joined as a listener.
create or replace function public.get_jam_snapshot(p_jam_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me   uuid := auth.uid();
  v_room jam_rooms%rowtype;
  v_host_username text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select * into v_room from jam_rooms where id = p_jam_room_id and status = 'active';
  if not found then raise exception 'jam_not_found'; end if;

  -- AUTHORIZATION: a jam is scoped to its conversation. Without this check any
  -- authenticated user holding the room UUID could self-join a private jam and
  -- gain read access to its queue.
  if not is_conversation_member(v_room.conversation_id) then
    raise exception 'not_conversation_member';
  end if;

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
$function$;

-- 3. create_group: may only add users the creator is actually friends with.
--    Mirrors the check get_or_create_dm() already performs for DMs.
create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id   uuid;
  v_me   uuid := auth.uid();
  v_uid  uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- AUTHORIZATION: validate every member BEFORE creating anything, so a rejected
  -- member cannot leave a half-built group behind.
  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      perform assert_friendship(v_me, v_uid);
    end if;
  end loop;

  insert into conversations (kind, name, created_by)
  values ('group', p_name, v_me)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'admin');

  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      insert into conversation_members (conversation_id, user_id, role)
      values (v_id, v_uid, 'member')
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end loop;

  return v_id;
end;
$function$;
