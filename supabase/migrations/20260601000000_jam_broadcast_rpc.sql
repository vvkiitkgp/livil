-- broadcast_jam_state: server-side broadcast RPC for jam playback state.
--
-- Workaround for a Supabase Realtime quirk observed on this project:
-- client-side channel.send({type:'broadcast', ...}) returns 'ok' (even with
-- broadcast.ack:true) but the message never reaches subscribers. Server-side
-- realtime.send() works as expected. So the host calls this RPC, which checks
-- that the caller is the active host and then invokes realtime.send() to push
-- a PLAYBACK_STATE event on the jam:<id> topic. Listeners subscribed to that
-- topic via channel.on('broadcast', { event: 'PLAYBACK_STATE' }, ...) receive
-- it normally.
--
-- SECURITY DEFINER + an explicit host check is required because realtime.send
-- otherwise needs broadcast RLS policies on realtime.messages, which would be
-- harder to scope per jam_room. The host check here gives the same effect.

create or replace function broadcast_jam_state(
  p_jam_room_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1 from jam_rooms
    where id = p_jam_room_id
      and status = 'active'
      and host_id = auth.uid()
  ) then
    raise exception 'not_host_of_active_jam';
  end if;

  perform realtime.send(
    p_payload,
    'PLAYBACK_STATE',
    'jam:' || p_jam_room_id::text,
    false  -- public channel
  );
end;
$$;

grant execute on function broadcast_jam_state(uuid, jsonb) to authenticated;
