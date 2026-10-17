-- ============================================================================
-- The server's clock, not the client's, dates posts, tracks, messages and Jams
-- ============================================================================
--
-- posts.created_at, tracks.created_at, messages.created_at and jam_rooms.started_at /
-- ended_at were whatever the client sent, and posts/tracks let their owner change
-- created_at afterwards. The music score (20261104000000, ADR-0032) caps activity per DAY,
-- so a client that backdates rows across many days walks around every cap: 1,000 track
-- rows dated over 1,000 days = 25,000 points (security review, 2026-10-17). The same hole
-- lets a post dated in the future sit at the top of any feed ordered by created_at.
-- post_comments (20261103000000) and spotify_opens (20261016000000) already take the
-- server's time; these four now do too.
--
-- For API callers only (current_user authenticated / anon), as post_comments_clamp_on_insert:
-- service-role and owner-run code (seeding, ops, tests) can still place a dated row.
-- Clamped, never refused: no client sends these values (checked at release 2.1.3, 1c56cd0,
-- and HEAD, in src lib web shared supabase/functions) except jamRooms.ts, which sends
-- ended_at = the phone's "now" on leaving — replaced by the server's now, the same moment.
--
-- ADDITIVE for shipped apps: nothing is rejected; a value the app never sends is replaced.
-- ============================================================================

-- ── 1. New rows are dated by the server ─────────────────────────────────────
create or replace function public.stamp_created_at_now()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_created_at_now() from public, anon, authenticated;

drop trigger if exists trg_posts_stamp_created_at on public.posts;
create trigger trg_posts_stamp_created_at
  before insert on public.posts
  for each row execute function public.stamp_created_at_now();

drop trigger if exists trg_tracks_stamp_created_at on public.tracks;
create trigger trg_tracks_stamp_created_at
  before insert on public.tracks
  for each row execute function public.stamp_created_at_now();

drop trigger if exists trg_messages_stamp_created_at on public.messages;
create trigger trg_messages_stamp_created_at
  before insert on public.messages
  for each row execute function public.stamp_created_at_now();

-- ── 2. …and keep that date (messages already freeze it: 20260729000000) ──────
create or replace function public.keep_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_created_at() from public, anon, authenticated;

drop trigger if exists trg_posts_keep_created_at on public.posts;
create trigger trg_posts_keep_created_at
  before update of created_at on public.posts
  for each row execute function public.keep_created_at();

drop trigger if exists trg_tracks_keep_created_at on public.tracks;
create trigger trg_tracks_keep_created_at
  before update of created_at on public.tracks
  for each row execute function public.keep_created_at();

-- ── 3. Jams: started now, ended now ─────────────────────────────────────────
-- started_at can already not change after creation (jam_room_identity_is_immutable,
-- 20260930000000); this sets it at creation, stamps ended_at when a Jam ends, and keeps it.
create or replace function public.jam_rooms_server_time()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.started_at := now();
      new.ended_at := null;
    elsif old.ended_at is not null then
      -- Ended is final, like the 'ended' status: not moved later, not cleared.
      new.ended_at := old.ended_at;
    elsif new.ended_at is not null then
      -- Ending stamps the server's time.
      new.ended_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.jam_rooms_server_time() from public, anon, authenticated;

drop trigger if exists trg_jam_rooms_server_time on public.jam_rooms;
create trigger trg_jam_rooms_server_time
  before insert or update of ended_at on public.jam_rooms
  for each row execute function public.jam_rooms_server_time();
