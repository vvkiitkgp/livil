-- ============================================================================
-- last_seen is ops-only — "is the app open" is no longer readable by users
-- ============================================================================
-- THE LEAK. profiles.last_seen_at was stamped every few minutes while the app was
-- foregrounded, and `profiles` is readable row-wide by every signed-in user
-- (profiles_select_authenticated). So anyone could run
--     select last_seen_at from profiles where username = 'riya'
-- and learn whether Riya had the app open in the last few minutes — regardless of her
-- "Activity status" switch. The Play Store build also still renders it as "Online" in
-- the chat header (getFriendActivity, 3-minute window). Product rule (see
-- 20260925000000_listening_now.sql): whether someone has the app open must not be
-- indicated in any way. The only legitimate reader is the ops roster ("last active").
--
-- THE FIX.
--   1. `user_last_seen` — one row per user, RLS enabled with ZERO policies and no
--      grants, so no client role can read or write it (same shape as `ops_users`).
--   2. `touch_last_seen()` — the new client's heartbeat. DEFINER, stamps the CALLER
--      only, with the server clock.
--   3. A BEFORE UPDATE OF last_seen_at trigger on `profiles` REDIRECTS the Play Store
--      build's direct `update profiles set last_seen_at = …` into `user_last_seen` and
--      stores NULL on the profile. Old builds keep feeding the ops roster; their
--      chat header reads NULL and never says "Online" again.
--   4. Existing values are MOVED (copied, then nulled on the profile) — the ops
--      "last active" history is kept.
--   5. ops_users_overview() reads the new table. Same signature; replaced in place.
--
-- WHY NOT A COLUMN-LEVEL REVOKE. `revoke select (last_seen_at)` breaks every
-- `select('*')` on profiles for the authenticated role, and there are several.
--
-- profiles.last_seen_at is KEPT (always NULL from here on) because the Play Store
-- build selects it; dropping it would turn that into a request error. Drop it once
-- that build is gone.
--
-- Forward-only and idempotent.
-- ============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
create table if not exists public.user_last_seen (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null
);

alter table public.user_last_seen enable row level security;
-- No policies, on purpose. Belt and braces against default privileges:
revoke all on table public.user_last_seen from anon, authenticated;

-- ── 4. Move the existing values (before the trigger exists) ─────────────────
insert into public.user_last_seen (user_id, last_seen_at)
select id, last_seen_at from public.profiles where last_seen_at is not null
on conflict (user_id) do update
  set last_seen_at = greatest(public.user_last_seen.last_seen_at, excluded.last_seen_at);

update public.profiles set last_seen_at = null where last_seen_at is not null;

-- ── 2. The new heartbeat ────────────────────────────────────────────────────
create or replace function public.touch_last_seen()
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into user_last_seen (user_id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
$$;

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- ── 3. Redirect the Play Store build's direct write ─────────────────────────
-- Only the profile's owner can UPDATE their profile (profiles RLS), so NEW.id is the
-- caller. The stamp is the server clock, not the client's value.
create or replace function public.profiles_redirect_last_seen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.last_seen_at is not null then
    insert into user_last_seen (user_id, last_seen_at)
    values (new.id, now())
    on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
    new.last_seen_at := null;
  end if;
  return new;
end;
$$;

-- A trigger function is not an API. Same sweep as 20260923100000.
revoke all on function public.profiles_redirect_last_seen() from public, anon, authenticated;

drop trigger if exists trg_profiles_redirect_last_seen on public.profiles;
create trigger trg_profiles_redirect_last_seen
  before insert or update of last_seen_at on public.profiles
  for each row execute function public.profiles_redirect_last_seen();

-- ── 5. The ops roster reads the new table ───────────────────────────────────
-- Restated from production verbatim except the last_seen_at source. The function's
-- COMMENT survives CREATE OR REPLACE, so schema parity is unaffected.
create or replace function public.ops_users_overview()
returns table (
  id            uuid,
  display_name  text,
  username      text,
  email         text,
  created_at    timestamptz,
  last_seen_at  timestamptz,
  tracks_count  bigint,
  posts_count   bigint,
  stars_count   bigint,
  friends_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
BEGIN
  IF NOT public.is_ops() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.display_name,
      p.username,
      u.email::text,
      p.created_at,
      ls.last_seen_at,
      -- Songs uploaded: tracks, not posts. A repost creates a post but no track, so counting
      -- posts would credit an artist for someone else's work.
      (SELECT count(*) FROM public.tracks t  WHERE t.uploader_id = p.id),
      (SELECT count(*) FROM public.posts  po WHERE po.author_id  = p.id),
      -- Stars received. `follows_kind_check` permits only kind='star', so a star IS a follow.
      (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id),
      -- Friendship is symmetric and stored once, so both sides must be checked. Pending
      -- requests are excluded: a request nobody accepted is not a friend.
      (SELECT count(*) FROM public.friendships fr
        WHERE fr.status = 'accepted' AND (fr.user_a_id = p.id OR fr.user_b_id = p.id))
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.user_last_seen ls ON ls.user_id = p.id
    ORDER BY p.created_at DESC;
END;
$$;
