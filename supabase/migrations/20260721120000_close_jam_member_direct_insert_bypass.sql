-- Closes the direct-table path that 20260720192310 left open.
--
-- THE INCOMPLETE FIX
-- 20260720192310 guarded get_jam_snapshot() so it would no longer self-join a caller
-- into an arbitrary jam room. That closed the RPC path. It did not close the table.
--
-- jam_room_members is writable directly through PostgREST, and jmem_insert's check was:
--
--   (user_id = auth.uid()) OR (caller is the room host)
--
-- The first clause places NO constraint on jam_room_id. A POST to
-- /rest/v1/jam_room_members carrying any room UUID and one's own user_id satisfied it.
--
-- THE CONSEQUENCE, verified against production 2026-07-21:
--   jq_select  USING      exists(jam_room_members where jam_room_id = ... and user_id = auth.uid())
--   jq_insert  WITH CHECK exists(jam_room_members where jam_room_id = ... and user_id = auth.uid())
--
-- So the self-inserted row granted READ and WRITE on that jam's queue. The guard added
-- to the RPC was bypassed entirely by not calling the RPC.
--
-- Found by the security-reviewer agent during its calibration run — it reasoned from
-- policy source that "eb4b01e closed the RPC path but left the direct-table path open",
-- and flagged it as unverified. It was then verified in production and is correct.
--
-- THE FIX mirrors jmem_select, which already requires conversation membership.

drop policy if exists "jmem_insert" on public.jam_room_members;

create policy "jmem_insert" on public.jam_room_members
  for insert to authenticated
  with check (
    -- Self-join: only into a jam whose parent conversation you belong to.
    (
      user_id = auth.uid()
      and exists (
        select 1
        from jam_rooms jr
        join conversation_members cm on cm.conversation_id = jr.conversation_id
        where jr.id = jam_room_members.jam_room_id
          and cm.user_id = auth.uid()
      )
    )
    -- Host adding another member. The host is necessarily a conversation member,
    -- since jam_insert already requires that at room creation.
    or exists (
      select 1 from jam_rooms
      where jam_rooms.id = jam_room_members.jam_room_id
        and jam_rooms.host_id = auth.uid()
    )
  );
