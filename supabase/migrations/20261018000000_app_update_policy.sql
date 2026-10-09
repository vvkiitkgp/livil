-- ============================================================================
-- App update prompt — which builds are told to update, per platform
-- ============================================================================
--
-- One row per platform. The app compares its own build number (APP_VERSION_CODE,
-- src/constants/appVersion.ts — the same number on iOS and Android, bumped together by
-- every `release:` commit) against the row for its platform:
--
--   build <  minimum_build  → BLOCKING screen: "Please update Livil" — Update only.
--   build <  latest_build   → GENTLE prompt: Update / Later (Later snoozes 3 days per build).
--   otherwise               → nothing.
--
-- Two numbers, not one, because they answer different questions. `latest_build` is "what
-- is in the store now" and is raised on every release once it is live; `minimum_build` is
-- "what still works" and is raised only when an old build is genuinely broken against the
-- backend — which the add-don't-change rule (CLAUDE.md "Production compatibility") is
-- meant to make rare.
--
-- Per platform because the stores do not move together: App Review can hold an iOS build
-- for a week after the same build is live on Google Play. Prompting an iPhone user to
-- install a build Apple has not released yet sends them to a store page with no update.
--
-- `message` optionally replaces the default body text — "Spotify reposts are here" —
-- shown in both the gentle and the blocking prompt. NULL = the app's default copy. NOTE
-- App Review guideline 2.3.10: the iOS row's message must never name another platform's
-- store; the rows are per platform precisely so they can say different things.
--
-- ── Who can read / write ────────────────────────────────────────────────────
-- READ: anon AND authenticated. A blocking update must also reach the sign-in screen —
-- the build it blocks may be the one whose sign-in is broken. Nothing in a row is private.
-- WRITE: nobody through the API (no write policies, privileges revoked). Rows are edited
-- in the Supabase dashboard (Table Editor), which bypasses RLS:
--
--   update public.app_update_policy set latest_build = 77 where platform = 'android';
--
-- ── How the app treats failures ─────────────────────────────────────────────
-- Fail-open: no row, no table, no network → no prompt. A missing prompt costs a nudge; a
-- spurious blocking screen would lock people out of a working app.
--
-- ADDITIVE ONLY: one new table. No shipped app (≤ 2.1.2 / 76) reads it; the prompt
-- exists only in builds that carry this feature, so the seed rows below (0, 0) are inert.
-- ============================================================================

create table if not exists public.app_update_policy (
  platform      text primary key,
  latest_build  integer not null default 0,
  minimum_build integer not null default 0,
  message       text,
  updated_at    timestamptz not null default now(),
  constraint app_update_policy_platform_check check (platform in ('ios', 'android')),
  constraint app_update_policy_builds_check
    check (minimum_build >= 0 and latest_build >= 0 and minimum_build <= latest_build),
  constraint app_update_policy_message_check
    check (message is null or char_length(message) between 1 and 280)
);

comment on table public.app_update_policy is
  'Per-platform app update prompt: build < minimum_build blocks, build < latest_build nudges. '
  'Readable by everyone (incl. signed out); edited only from the dashboard. Fail-open in the app.';

alter table public.app_update_policy enable row level security;

revoke all on public.app_update_policy from anon, authenticated;
grant select on public.app_update_policy to anon, authenticated;

drop policy if exists app_update_policy_read on public.app_update_policy;
create policy app_update_policy_read on public.app_update_policy
  for select to anon, authenticated
  using (true);

-- Server clock on every edit, so the dashboard shows when a prompt was last changed.
create or replace function public.app_update_policy_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_update_policy_touch on public.app_update_policy;
create trigger app_update_policy_touch
  before update on public.app_update_policy
  for each row execute function public.app_update_policy_touch();

-- Inert until raised: every build is >= 0.
insert into public.app_update_policy (platform, latest_build, minimum_build)
values ('ios', 0, 0), ('android', 0, 0)
on conflict (platform) do nothing;
