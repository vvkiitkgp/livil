-- ============================================================================
-- Jam Suggests — listeners suggest songs to the host (ADR-0022, ADR-0023)
-- ============================================================================
-- In a jam the host drives playback. A listener who taps a song anywhere in the app now
-- SUGGESTS it to the jam instead of playing it. Everyone in the jam sees the suggestions
-- (grouped by song, "suggested by" faces, most-suggested first); only the host can act
-- on one — Play now or Add to queue — which marks it played / queued for everyone.
--
-- ── 1. jam_room_members: a member can no longer rewrite their own permissions ──
--
-- `jmem_update` was USING (host OR user_id = auth.uid()) with no WITH CHECK and no
-- column restriction, so a listener could UPDATE their own membership row — including
-- `permissions` and `role`. Nothing in the app updates this table at all (joining is the
-- join RPC, leaving is a DELETE), so UPDATE becomes host-only, checked both ways. Without
-- this, the `can_suggest` gate below would be decoration.
--
-- ── 2. jam_suggestions ───────────────────────────────────────────────────────
--
-- One row per (jam, post, suggester): "suggested by 3" is a count of rows, never a
-- stored counter, so it cannot drift. It references the POST (not the track): playing a
-- suggestion needs the post's media and clip window. No title/cover is copied: the
-- client reads the post, so a song taken down or deleted mid-jam simply drops out
-- (post_id ON DELETE CASCADE).
--
-- `status` (waiting | queued | played) is what listeners see on the card. It is PER
-- SONG: the host's action updates every row of that post. Only the host may update, and
-- only `status` (a trigger freezes everything else).
--
-- Suggestions exist only for the life of the jam: when the host ends it (status →
-- 'ended'), every suggestion is deleted. Product decision 2026-09-29: no Undo — the
-- whole list vanishes at the end.
--
-- ── Why there is a cap at all ────────────────────────────────────────────────
--
-- Product asked for no per-person limit, so there is none. There is one SAFETY cap of
-- 200 songs waiting per jam: the table is written by a tap, and a stuck finger, a
-- script or a modified client could otherwise write rows without bound into a list every
-- member downloads and re-renders live. 200 is far past any real session.
--
-- Forward-only. Nothing existing is rewritten: the table and jam_rooms.last_played_at are
-- new. Jams already running when this ships have no heartbeat yet and fall back to
-- started_at, so an old abandoned jam ends on its members' next check — which is the
-- point.
-- ============================================================================

-- ── 1. Close the self-edit of jam membership ────────────────────────────────
drop policy if exists "jmem_update" on public.jam_room_members;
create policy "jmem_update" on public.jam_room_members for update
  using (
    exists (
      select 1 from public.jam_rooms r
      where r.id = jam_room_members.jam_room_id and r.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.jam_rooms r
      where r.id = jam_room_members.jam_room_id and r.host_id = auth.uid()
    )
  );

-- ── 2. The table ─────────────────────────────────────────────────────────────
create table if not exists public.jam_suggestions (
  id            uuid primary key default gen_random_uuid(),
  jam_room_id   uuid not null references public.jam_rooms (id) on delete cascade,
  post_id       uuid not null references public.posts (id) on delete cascade,
  suggested_by  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'waiting'
                check (status in ('waiting', 'queued', 'played')),
  created_at    timestamptz not null default now(),
  status_at     timestamptz,
  unique (jam_room_id, post_id, suggested_by)
);

create index if not exists jam_suggestions_room_created_idx
  on public.jam_suggestions (jam_room_id, created_at desc);

alter table public.jam_suggestions enable row level security;

-- Is the caller a member of this jam (host included — the host has a member row)?
-- SECURITY DEFINER so the policies below do not recurse through jam_room_members' own
-- policies; it answers only about auth.uid().
create or replace function public.is_jam_member(p_jam_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from jam_room_members m
    where m.jam_room_id = p_jam_room_id and m.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_jam_member(uuid) from public;
revoke execute on function public.is_jam_member(uuid) from anon;
grant execute on function public.is_jam_member(uuid) to authenticated;

-- Read: members of the jam.
drop policy if exists jam_suggestions_select on public.jam_suggestions;
create policy jam_suggestions_select on public.jam_suggestions for select
  to authenticated
  using (public.is_jam_member(jam_room_id));

-- Add: yourself, into an ACTIVE jam you are a member of, with can_suggest, for a post
-- you can see (the EXISTS on posts is evaluated under posts' own RLS, so a blocked or
-- taken-down post cannot be suggested).
drop policy if exists jam_suggestions_insert on public.jam_suggestions;
create policy jam_suggestions_insert on public.jam_suggestions for insert
  to authenticated
  with check (
    suggested_by = auth.uid()
    and status = 'waiting'
    and exists (
      select 1 from public.jam_rooms r
      where r.id = jam_suggestions.jam_room_id and r.status = 'active'
    )
    and exists (
      select 1 from public.jam_room_members m
      where m.jam_room_id = jam_suggestions.jam_room_id
        and m.user_id = auth.uid()
        and coalesce((m.permissions ->> 'can_suggest')::boolean, true)
    )
    and exists (select 1 from public.posts p where p.id = jam_suggestions.post_id)
  );

-- Update (status only — see the trigger): the host.
drop policy if exists jam_suggestions_update on public.jam_suggestions;
create policy jam_suggestions_update on public.jam_suggestions for update
  to authenticated
  using (
    exists (select 1 from public.jam_rooms r
            where r.id = jam_suggestions.jam_room_id and r.host_id = auth.uid())
  )
  with check (
    exists (select 1 from public.jam_rooms r
            where r.id = jam_suggestions.jam_room_id and r.host_id = auth.uid())
  );

-- Delete: the host (dismiss). Suggesters cannot withdraw — no Undo, by product decision.
drop policy if exists jam_suggestions_delete on public.jam_suggestions;
create policy jam_suggestions_delete on public.jam_suggestions for delete
  to authenticated
  using (
    exists (select 1 from public.jam_rooms r
            where r.id = jam_suggestions.jam_room_id and r.host_id = auth.uid())
  );

-- ── Integrity triggers ───────────────────────────────────────────────────────
-- Only `status` (and its timestamp) ever changes after insert; the safety cap holds.
create or replace function public.jam_suggestions_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_waiting int;
begin
  if tg_op = 'UPDATE' then
    if new.jam_room_id  is distinct from old.jam_room_id
       or new.post_id      is distinct from old.post_id
       or new.suggested_by is distinct from old.suggested_by
       or new.created_at   is distinct from old.created_at then
      raise exception 'jam_suggestion_identity_is_immutable' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      new.status_at := now();
    end if;
    return new;
  end if;

  -- INSERT: server clock, and the per-jam safety cap.
  new.created_at := now();
  new.status_at  := null;
  select count(*) into v_waiting
    from jam_suggestions
   where jam_room_id = new.jam_room_id and status = 'waiting';
  if v_waiting >= 200 then
    raise exception 'jam_suggestions_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.jam_suggestions_guard() from public;
revoke execute on function public.jam_suggestions_guard() from anon, authenticated;

drop trigger if exists trg_jam_suggestions_guard on public.jam_suggestions;
create trigger trg_jam_suggestions_guard
  before insert or update on public.jam_suggestions
  for each row execute function public.jam_suggestions_guard();

-- The jam ends → its suggestions go.
create or replace function public.jam_suggestions_clear_on_end()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    delete from jam_suggestions where jam_room_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.jam_suggestions_clear_on_end() from public;
revoke execute on function public.jam_suggestions_clear_on_end() from anon, authenticated;

drop trigger if exists trg_jam_rooms_clear_suggestions on public.jam_rooms;
create trigger trg_jam_rooms_clear_suggestions
  after update of status on public.jam_rooms
  for each row execute function public.jam_suggestions_clear_on_end();

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Everyone in the jam sees suggestions and status changes live. REPLICA IDENTITY FULL
-- so UPDATE/DELETE events carry jam_room_id for the client's filter.
alter table public.jam_suggestions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jam_suggestions'
  ) then
    alter publication supabase_realtime add table public.jam_suggestions;
  end if;
end $$;

-- ── 3. A jam ends itself when the host is gone or silent ─────────────────────
--
-- A host who swipes the app away never taps End, so their listeners sat in a dead jam
-- until someone started a new one in that chat (create_jam_room ends jams stale for an
-- hour — measured against host_clock_at, which nothing ever wrote). Now:
--
--   * the host's app writes a heartbeat every 30s while the jam runs
--     (jam_host_heartbeat): host_clock_at = now, and last_played_at = now whenever
--     something is actually playing;
--   * every member's app asks once a minute whether the jam should end
--     (jam_end_if_stale). It ends when the host has sent NO heartbeat for 3 minutes
--     (app killed / phone off / no network) or NOTHING has played for 10 minutes (host
--     idle). Either member's call ends it for everyone; the rest see status 'ended'.
--
-- Thresholds are product-chosen defaults. The 3 minutes sits well above a heartbeat
-- interval of 30s so a brief network drop never ends a live jam.

alter table public.jam_rooms add column if not exists last_played_at timestamptz;

create or replace function public.jam_host_heartbeat(p_jam_room_id uuid, p_is_playing boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update jam_rooms
     set host_clock_at  = now(),
         last_played_at = case when p_is_playing then now() else last_played_at end
   where id = p_jam_room_id
     and host_id = auth.uid()
     and status = 'active';
end;
$$;

revoke execute on function public.jam_host_heartbeat(uuid, boolean) from public;
revoke execute on function public.jam_host_heartbeat(uuid, boolean) from anon;
grant execute on function public.jam_host_heartbeat(uuid, boolean) to authenticated;

-- Returns true when the jam is (now) ended — whether this call ended it or it already
-- was. Callable by members only; a non-member learns nothing (returns null).
create or replace function public.jam_end_if_stale(p_jam_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room jam_rooms%rowtype;
begin
  if not exists (
    select 1 from jam_room_members
    where jam_room_id = p_jam_room_id and user_id = auth.uid()
  ) and not exists (
    select 1 from jam_rooms where id = p_jam_room_id and host_id = auth.uid()
  ) then
    return null;
  end if;

  select * into v_room from jam_rooms where id = p_jam_room_id for update;
  if not found then return true; end if;
  if v_room.status = 'ended' then return true; end if;

  if coalesce(v_room.host_clock_at, v_room.started_at) < now() - interval '3 minutes'
     or coalesce(v_room.last_played_at, v_room.started_at) < now() - interval '10 minutes'
  then
    update jam_rooms set status = 'ended', ended_at = now() where id = p_jam_room_id;
    if v_room.conversation_id is not null then
      insert into messages (conversation_id, sender_id, kind, body, metadata)
      values (v_room.conversation_id, null, 'system',
              'The Jam Room ended because the host was away.',
              jsonb_build_object('event', 'jam_ended', 'reason', 'host_away'));
    end if;
    return true;
  end if;
  return false;
end;
$$;

revoke execute on function public.jam_end_if_stale(uuid) from public;
revoke execute on function public.jam_end_if_stale(uuid) from anon;
grant execute on function public.jam_end_if_stale(uuid) to authenticated;

-- ── Self-test ───────────────────────────────────────────────────────────────
-- Structure only; behaviour (who may insert/update/delete) is covered by
-- supabase/tests/rls/jam-suggestions.test.sql, which needs an authenticated caller.
do $verify$
begin
  if has_function_privilege('anon', 'public.jam_suggestions_guard()', 'EXECUTE')
     or has_function_privilege('anon', 'public.jam_suggestions_clear_on_end()', 'EXECUTE') then
    raise exception 'VERIFY: a jam_suggestions trigger function is anon-callable';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'jam_room_members' and cmd = 'UPDATE') <> 1 then
    raise exception 'VERIFY: expected exactly one UPDATE policy on jam_room_members';
  end if;
end
$verify$;
