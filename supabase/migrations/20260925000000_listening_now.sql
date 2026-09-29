-- ============================================================================
-- Listening now — the chat "now playing" indicator
-- ============================================================================
-- WHAT IT REPLACES. Chat showed a green "Online" dot driven by profiles.last_seen_at
-- (the app-open heartbeat). The product rule is now: the indicator depends ONLY on
-- whether the person is playing music in Livil, never on whether the app is open.
-- Playing → show the track; paused/stopped → show nothing.
--
-- listen_sessions (20260515120000) already existed with a sensible audience rule, but
-- nothing ever wrote to it, and it could not express "paused" — a row only aged out
-- after 5 minutes. This migration makes it the single source of truth:
--
--   * `playing`  — the explicit paused/playing state. A pause is an UPDATE to false,
--                  never a DELETE: realtime applies RLS to UPDATE payloads, but DELETE
--                  payloads are delivered without an RLS check.
--   * `post_id`  — what "Listen" in the chat opens. `on delete set null`, so a deleted
--                  post leaves a status with no Listen button rather than a dead link.
--   * `updated_at` is now SERVER-stamped (trigger). Liveness is judged against it, and
--                  a client clock that is minutes off would otherwise make a listener
--                  permanently stale (or permanently live).
--
-- LIVENESS. The client re-stamps the row every 60s while playing (driven by the
-- player's own progress events, which keep firing on the lock screen). A row is LIVE
-- when `playing and updated_at > now() - 150s`: one missed beat is tolerated, and a
-- process that dies mid-song (swipe-away, OOM, dead battery) stops showing within
-- ~2.5 minutes without anyone having to write `playing = false`.
--
-- ── WHO MAY SEE IT ──────────────────────────────────────────────────────────
-- ACCEPTED FRIENDS ONLY — narrowed from the 20260515 policy, which also admitted
-- anyone who STARS the listener. A star needs no approval (star_user), so that branch
-- let any stranger watch someone's live listening, while the Privacy switch tells users
-- "friends". Product decision 2026-09-25: friends only. All in `can_see_listening`:
--   1. profiles.show_activity is now enforced BY THE DATABASE. Previously only the
--      client honoured it (conversations.ts), so the "Activity status" switch in
--      Privacy did nothing against a direct select.
--   2. The owner can always see their own row — required for the client's upsert
--      (INSERT … ON CONFLICT DO UPDATE checks the existing row against SELECT).
-- A block already severs friendships in both directions (20260808100000), so it is
-- covered by the friendship test; is_blocked_between is checked anyway so this
-- function stays correct if that coupling ever changes.
--
-- ── "APP OPEN" IS NO LONGER SHOWN TO ANYONE ─────────────────────────────────
-- Product rule: whether someone has the app open must not be indicated in any way.
-- list_my_conversations().other_user_online is REDEFINED to mean "is listening now"
-- (same live test as list_listening_now, same audience). New clients do not read it;
-- the build already on the Play Store does, and draws its green dot from it — so that
-- dot now lights only while the person is playing music. The column keeps its name and
-- type so the function is replaced in place (no DROP) and old clients keep working.
-- last_seen_at itself is made ops-only by the next migration (20260925010000).
--
-- Forward-only and idempotent.
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.listen_sessions
  add column if not exists playing boolean not null default false;

alter table public.listen_sessions
  add column if not exists post_id uuid references public.posts(id) on delete set null;

-- The four pre-existing rows (last written 2026-05-15) take the default `false`, so
-- nobody appears to be listening because of data this feature never wrote. They are
-- scrubbed like any paused row once the trigger below exists (see the UPDATE after it).

-- Bounded, because the row is pushed to every viewer on every heartbeat and rendered
-- in their chat. 200 is well above any real title; the client truncates to it.
alter table public.listen_sessions drop constraint if exists listen_sessions_text_len;
alter table public.listen_sessions add constraint listen_sessions_text_len
  check (char_length(track_title) <= 200 and char_length(artist_name) <= 200);

-- ── Server-stamped updated_at, and a paused row that says nothing ───────────
-- Playing: updated_at := now() — the liveness clock, immune to client clocks.
-- Not playing: the row is scrubbed. The audience can still SELECT the row directly
-- (the policy gates WHO, not WHEN), so a paused row that kept its track and a fresh
-- timestamp would be a permanent "last listened at / had the app open at" record —
-- exactly what F5 forbids. Title/artist blanked, post cleared, and updated_at set to
-- the epoch so the pause time is not recorded. The epoch also makes the Play Store
-- build's chat header (5-minute window on updated_at, ignores `playing`) drop the
-- track the moment the listener pauses.
create or replace function public.listen_sessions_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.playing then
    new.updated_at := now();
  else
    new.track_title := '';
    new.artist_name := '';
    new.post_id     := null;
    new.updated_at  := 'epoch'::timestamptz;
  end if;
  return new;
end;
$$;

-- A trigger function is not an API. Same sweep as 20260923100000.
revoke all on function public.listen_sessions_stamp() from public, anon, authenticated;

drop trigger if exists listen_sessions_stamp on public.listen_sessions;
create trigger listen_sessions_stamp
  before insert or update on public.listen_sessions
  for each row execute function public.listen_sessions_stamp();

-- Scrub the pre-existing (never-live) rows through the trigger.
update public.listen_sessions set playing = false where not playing;

-- ── list_friend_listen_stories: same liveness as everything else ────────────
-- Unused by the current client, but still callable, and it returned the row with no
-- `playing` or freshness filter. Replaced in place (same signature and attributes)
-- so it can only ever return someone who is playing right now. Its hand-written
-- audience clause is dropped: it is INVOKER, so the listen_sessions policy
-- (can_see_listening) is the audience — one definition instead of two that drift.
create or replace function public.list_friend_listen_stories()
returns table (
  user_id       uuid,
  username      text,
  display_name  text,
  avatar_url    text,
  track_title   text,
  artist_name   text,
  updated_at    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_url,
         ls.track_title, ls.artist_name, ls.updated_at
  from listen_sessions ls
  join profiles p on p.id = ls.user_id
  where auth.uid() is not null
    and ls.user_id <> auth.uid()
    and ls.playing
    and ls.updated_at > now() - interval '150 seconds'
  order by ls.updated_at desc
  limit 50;
$$;

-- ── The audience rule, in one place ─────────────────────────────────────────
-- SECURITY DEFINER so the policy can read friendships / follows / profiles without
-- depending on those tables' own select policies (a friendship row is only visible to
-- its two parties, which is exactly the caller here, but the policy should not have to
-- reason about that). Returns a boolean about the CALLER only — it cannot be used to
-- read anyone else's relationships.
create or replace function public.can_see_listening(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.uid() is not null
    and (
      p_owner = auth.uid()
      or (
        exists (
          select 1 from profiles pr
          where pr.id = p_owner and pr.show_activity is true
        )
        and not public.is_blocked_between(auth.uid(), p_owner)
        and exists (
          select 1 from friendships f
          where f.status = 'accepted'
            and (
              (f.user_a_id = auth.uid() and f.user_b_id = p_owner)
              or (f.user_b_id = auth.uid() and f.user_a_id = p_owner)
            )
        )
      )
    );
$$;

revoke all on function public.can_see_listening(uuid) from public, anon;
grant execute on function public.can_see_listening(uuid) to authenticated;

drop policy if exists listen_sessions_select_circle on public.listen_sessions;
create policy listen_sessions_select_circle
  on public.listen_sessions
  for select
  to authenticated
  using (public.can_see_listening(user_id));

-- ── The read path ───────────────────────────────────────────────────────────
-- Returns only LIVE rows, plus `expires_in` so the client can hide the indicator on
-- time without comparing its own clock to the server's. SECURITY INVOKER: the
-- listen_sessions policy above decides who is visible, and the posts/tracks join
-- runs under the caller's own policies, so a cover the caller could not otherwise
-- read is returned as null rather than leaked.
create or replace function public.list_listening_now(p_user_ids uuid[])
returns table (
  user_id       uuid,
  track_title   text,
  artist_name   text,
  post_id       uuid,
  cover_art_url text,
  expires_in    integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    ls.user_id,
    ls.track_title,
    ls.artist_name,
    ls.post_id,
    t.cover_art_url,
    greatest(
      0,
      ceil(extract(epoch from (ls.updated_at + interval '150 seconds' - now())))
    )::integer as expires_in
  from listen_sessions ls
  left join posts p  on p.id = ls.post_id
  left join tracks t on t.id = p.track_id
  where ls.user_id = any (p_user_ids)
    and ls.user_id <> auth.uid()
    and ls.playing
    and ls.updated_at > now() - interval '150 seconds'
  limit 100;
$$;

revoke all on function public.list_listening_now(uuid[]) from public, anon;
grant execute on function public.list_listening_now(uuid[]) to authenticated;

-- ── list_my_conversations: other_user_online now means "listening now" ──────
-- Restated verbatim from 20260812000000 (production matches it) except the
-- other_user_online expression. `security definer` and the LIV-16 search_path are
-- repeated deliberately; CREATE OR REPLACE drops any attribute not restated. Because
-- this body is DEFINER, the listen_sessions policy does NOT apply inside it, so the
-- audience rule is applied explicitly via can_see_listening (whose auth.uid() is still
-- the caller's).
create or replace function public.list_my_conversations()
returns table (
  id                   uuid,
  kind                 text,
  name                 text,
  avatar_url           text,
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         bigint,
  other_user_id        uuid,
  other_user_username  text,
  other_user_name      text,
  other_user_avatar    text,
  other_user_online    boolean
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.avatar_url,
    c.last_message_at,
    c.last_message_preview,
    (
      select count(*) from messages m
      where m.conversation_id = c.id
        and m.created_at > cm_me.last_read_at
        and m.sender_id != auth.uid()
        and m.deleted_at is null
    ) as unread_count,
    case when c.kind = 'dm' then p.id          end as other_user_id,
    case when c.kind = 'dm' then p.username    end as other_user_username,
    case when c.kind = 'dm' then p.display_name end as other_user_name,
    case when c.kind = 'dm' then p.avatar_url  end as other_user_avatar,
    case when c.kind = 'dm' then
      exists (
        select 1 from listen_sessions ls
        where ls.user_id = p.id
          and ls.playing
          and ls.updated_at > now() - interval '150 seconds'
          and public.can_see_listening(p.id)
      )
    end as other_user_online
  from conversations c
  join conversation_members cm_me
    on cm_me.conversation_id = c.id and cm_me.user_id = auth.uid()
  left join conversation_members cm_other
    on cm_other.conversation_id = c.id and cm_other.user_id != auth.uid() and c.kind = 'dm'
  left join profiles p on p.id = cm_other.user_id
  order by coalesce(c.last_message_at, c.created_at) desc nulls last, c.created_at desc;
$$;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- So a pause shows up in an open chat within a second instead of on the next visit.
-- Delivery is filtered by the select policy above for every subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'listen_sessions'
  ) then
    alter publication supabase_realtime add table public.listen_sessions;
  end if;
end $$;
