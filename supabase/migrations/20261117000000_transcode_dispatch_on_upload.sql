-- ============================================================================
-- An upload rings the transcoder's doorbell
-- ============================================================================
--
-- WHY
--
-- The transcoder (ADR-0033, `.github/workflows/transcode-media.yml`) is scheduled every
-- 5 minutes, but GitHub treats a `schedule` as best-effort: on this repository it has
-- been running every 4–7 hours (eight consecutive runs, 2026-10-28/29, were 3.5–7.2 h
-- apart). Two things pay for that:
--
--   * a heavy upload (4K video, WAV) plays as the raw original for hours instead of
--     ~5 minutes — the exact problem ADR-0033 set out to fix;
--   * the "new song from a friend" push (20261116000000) waits for the transcoder to
--     have looked at the track, falling back to a 30-minute timer — so, in practice,
--     every drop push goes out 30 minutes late (soul_aj's "Mast Magan", 2026-10-29:
--     uploaded 23:24 IST, announced 23:55 IST).
--
-- ADR-0033 named the fix and left it as a follow-up: have the upload itself start the
-- workflow. This is that follow-up.
--
-- WHAT
--
-- 1. `transcode_dispatch_state` — one row: when GitHub was last asked, and whether an
--    ask is being held back.
-- 2. `transcode_dispatch_try()` — asks GitHub to run the workflow (`workflow_dispatch`,
--    `ref: main`) through pg_net, which sends the request after the transaction commits.
--    AT MOST ONCE A MINUTE: the row is claimed atomically, so a burst of uploads — or a
--    bulk insert, or a user inserting and deleting posts in a loop — collapses to one
--    call, and the next ask is merely held (`pending`), never lost. A run lists EVERY
--    pending track, so one call covers every upload that landed before it started.
-- 3. `trg_posts_transcode_dispatch` — AFTER INSERT on `posts`, kind = 'upload' only
--    (a repost has no new media) → `transcode_dispatch_try()`.
-- 4. `transcode_dispatch_flush()` on pg_cron every minute — sends a held ask once the
--    minute is up. Worst case an upload's dispatch is ~60 s late; typical case it is
--    immediate.
-- 5. pg_cron keeps a row per job run and nothing here pruned them (5,977 rows since
--    2026-10-07, before this job). A daily `cron-history-prune` keeps 30 days.
--
-- Why `posts` and not `tracks`: the app inserts the track row first as a placeholder
-- (`pending://placeholder`), uploads the file, then inserts the post — so the post is the
-- first moment the media is really there (see `createTrack` / the web's `publishTrack`,
-- and `abandoned uploads` in src/services/tracks.ts).
--
-- Why `workflow_dispatch` and not the `repository_dispatch` ADR-0033 mentioned: the
-- REST call for repository_dispatch needs a token with `contents: write` — on a PUBLIC
-- repository that token could push commits. workflow_dispatch needs only `actions:
-- write`, which can start, re-run and cancel workflow runs and nothing else. The
-- workflow already declares both triggers; the script runs the DEFAULT branch's copy
-- either way (`ref: main`), and its `concurrency` group keeps one run going and at most
-- one waiting.
--
-- THE TOKEN
--
-- A fine-grained GitHub personal access token, repository `vvkiitkgp/livil` only,
-- permission "Actions: Read and write" only, stored in Supabase Vault under the name
-- `github_transcode_dispatch_token` (Dashboard → Project Settings → Vault). It is read
-- at fire time and never logged: the exception handler reports SQLERRM, which is the
-- primary message only (no row data, no headers). No secret is in this file.
--
-- Residual: between commit and pg_net's worker sending it (seconds), the request — token
-- in its Authorization header — sits in `net.http_request_queue`. In this project the
-- `net` schema is not exposed through the API (PostgREST: "Only the following schemas
-- are exposed: public, graphql_public", checked 2026-10-30), so no client can read it;
-- section 6 below additionally revokes client SELECT on pg_net's tables, best-effort
-- (`postgres` may not own them — then a NOTICE, and the API boundary still holds).
--
-- FAIL-SAFE
--
-- The trigger can never fail an upload. No Vault, no secret, pg_net missing, the state
-- row gone — each is a WARNING in the Postgres log and the insert goes through. GitHub
-- itself answering 401/404/422 is NOT visible here (pg_net is asynchronous): it lands in
-- `net._http_response`, and the upload is simply picked up by the 5-minute schedule as
-- today. After applying, confirm a 204:
--     select status_code, created from net._http_response order by created desc limit 5;
-- A fine-grained token EXPIRES (GitHub caps them at one year); put the date in the
-- ops calendar — an expired token falls back to the schedule silently.
--
-- SECURITY
--
-- `transcode_dispatch_on_upload()` is SECURITY DEFINER because the inserting role
-- (`authenticated`) may neither read Vault nor should it call `net.http_post` — and must
-- keep being unable to. The body reads one named secret and posts to one hard-coded URL
-- with a constant body (`{"ref":"main"}`); nothing from the inserted row reaches the
-- request. EXECUTE is revoked from anon/authenticated: Postgres checks EXECUTE on a
-- trigger function when the trigger is created, not when it fires, so the trigger keeps
-- working (20260923100000 proves this with real writes). `transcode_dispatch_try()` and
-- `_flush()` are SECURITY INVOKER (callers: the definer trigger, pg_cron as postgres)
-- and revoked from client roles too. The state table has RLS on and no policy, and no
-- client grant: server-only, on purpose (nothing in the app reads it).
--
-- PRODUCTION SAFETY — additive, server-only. No app reads or calls anything here; the
-- shipped apps' upload insert is unchanged (the trigger adds ~1 ms and cannot raise).
-- Until the Vault secret exists the trigger is a no-op. Safe to apply any time.
-- ============================================================================

-- ── 1. State: one row ───────────────────────────────────────────────────────
create table if not exists public.transcode_dispatch_state (
  id                 integer primary key default 1 check (id = 1),
  last_dispatched_at timestamptz,
  pending            boolean not null default false,
  pending_since      timestamptz,
  dispatches         bigint not null default 0
);
comment on table public.transcode_dispatch_state is
  'One row. When GitHub was last asked to run transcode-media.yml (at most once a '
  'minute) and whether an ask is being held for the next minute. Server-only: no '
  'client grant on purpose (20261117000000).';
alter table public.transcode_dispatch_state enable row level security;
-- Server-only table: deliberately NO grant to authenticated/anon (and none needed by
-- service_role — the transcode script does not read it). RLS on with no policy, so even
-- a stray grant would show nothing.
revoke all on public.transcode_dispatch_state from public, anon, authenticated;
insert into public.transcode_dispatch_state (id) values (1) on conflict (id) do nothing;

-- ── 2. The ask, rate-limited ────────────────────────────────────────────────
-- Returns what happened: 'sent' | 'deferred' (held for the flush) | 'no_token' |
-- 'no_vault' | 'no_state'. Raises only when pg_net itself fails — the trigger swallows
-- that, the flush reports it to the cron log.
create or replace function public.transcode_dispatch_try()
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_token   text;
  v_claimed boolean;
begin
  -- No Vault (CI's bare Postgres, or a project without the extension) → nothing to do.
  if to_regclass('vault.decrypted_secrets') is null then
    return 'no_vault';
  end if;
  -- Dynamic, so this function compiles and installs where the view does not exist.
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
     into v_token
    using 'github_transcode_dispatch_token';
  if v_token is null or btrim(v_token) = '' then
    return 'no_token';  -- doorbell not wired yet; the schedule still runs
  end if;

  -- Claim the minute. The single-row UPDATE is atomic under concurrent inserts: the
  -- second transaction waits on the row lock, re-reads it, and finds the minute taken.
  update public.transcode_dispatch_state
     set last_dispatched_at = now(),
         pending            = false,
         pending_since      = null,
         dispatches         = dispatches + 1
   where id = 1
     and (last_dispatched_at is null or last_dispatched_at <= now() - interval '60 seconds')
  returning true into v_claimed;

  if v_claimed is null then
    update public.transcode_dispatch_state
       set pending = true, pending_since = coalesce(pending_since, now())
     where id = 1;
    if not found then
      return 'no_state';
    end if;
    return 'deferred';
  end if;

  perform net.http_post(
    url := 'https://api.github.com/repos/vvkiitkgp/livil/actions/workflows/transcode-media.yml/dispatches',
    body := jsonb_build_object('ref', 'main'),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || btrim(v_token),
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'livil-transcode-dispatch',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
  return 'sent';
end;
$$;

comment on function public.transcode_dispatch_try() is
  'Asks GitHub to run transcode-media.yml now (workflow_dispatch, ref main) — at most '
  'once a minute; a second ask inside the minute is held (transcode_dispatch_state.'
  'pending) for transcode_dispatch_flush(). Token = Vault secret '
  'github_transcode_dispatch_token (Actions: write only). No secret → no-op.';

revoke execute on function public.transcode_dispatch_try() from public;
revoke execute on function public.transcode_dispatch_try() from anon;
revoke execute on function public.transcode_dispatch_try() from authenticated;

-- ── 3. The trigger ──────────────────────────────────────────────────────────
create or replace function public.transcode_dispatch_on_upload()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.transcode_dispatch_try();
  exception when others then
    -- An upload is never held hostage by GitHub plumbing.
    raise warning 'transcode_dispatch_on_upload: % (post %)', sqlerrm, new.id;
  end;
  return new;
end;
$$;

comment on function public.transcode_dispatch_on_upload() is
  'AFTER INSERT on posts (kind = upload): transcode_dispatch_try(), fail-safe — any '
  'error is a WARNING and the insert proceeds (20261117000000).';

-- Definer function: client roles must not be able to call it directly (the trigger
-- still fires — EXECUTE is checked at CREATE TRIGGER time, not per row).
revoke execute on function public.transcode_dispatch_on_upload() from public;
revoke execute on function public.transcode_dispatch_on_upload() from anon;
revoke execute on function public.transcode_dispatch_on_upload() from authenticated;

drop trigger if exists trg_posts_transcode_dispatch on public.posts;
create trigger trg_posts_transcode_dispatch
  after insert on public.posts
  for each row
  when (new.kind = 'upload')
  execute function public.transcode_dispatch_on_upload();

-- ── 4. The flush ────────────────────────────────────────────────────────────
create or replace function public.transcode_dispatch_flush()
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.transcode_dispatch_state where id = 1 and pending) then
    return 'idle';
  end if;
  return public.transcode_dispatch_try();
end;
$$;

comment on function public.transcode_dispatch_flush() is
  'pg_cron, every minute: sends an ask that transcode_dispatch_try() held back because '
  'the minute was taken. Idle otherwise (20261117000000).';

revoke execute on function public.transcode_dispatch_flush() from public;
revoke execute on function public.transcode_dispatch_flush() from anon;
revoke execute on function public.transcode_dispatch_flush() from authenticated;

-- ── 5. Schedules ────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not installed — transcode-dispatch-flush and cron-history-prune were NOT scheduled';
    return;
  end if;
  perform cron.schedule('transcode-dispatch-flush', '* * * * *',
                        'select public.transcode_dispatch_flush()');
  -- pg_cron never prunes its own run log; with a per-minute job that is ~1,440 rows a
  -- day. Keep 30 days (diagnostics only — nothing reads older rows).
  perform cron.schedule('cron-history-prune', '15 21 * * *',
                        'delete from cron.job_run_details where end_time < now() - interval ''30 days''');
end $$;

-- ── 6. Clients should not read pg_net's tables (best-effort) ───────────────
-- Not required for safety (the `net` schema is not API-exposed), but a queued request
-- carries the token for a few seconds, and `authenticated`/`anon` had SELECT on these
-- in production (checked 2026-10-30). pg_net's objects may be owned by supabase_admin,
-- in which case `postgres` cannot revoke and this is a NOTICE, not a failure.
do $$
begin
  if to_regclass('net.http_request_queue') is not null then
    begin
      execute 'revoke all on table net.http_request_queue from anon, authenticated';
    exception when others then
      raise notice 'could not revoke client access to net.http_request_queue: % (the net schema is not API-exposed; nothing to do unless that changes)', sqlerrm;
    end;
  end if;
  if to_regclass('net._http_response') is not null then
    begin
      execute 'revoke all on table net._http_response from anon, authenticated';
    exception when others then
      raise notice 'could not revoke client access to net._http_response: %', sqlerrm;
    end;
  end if;
end $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
do $$
declare
  v_secdef boolean;
  v_config text[];
begin
  if not exists (select 1 from public.transcode_dispatch_state where id = 1) then
    raise exception 'transcode_dispatch_state has no row';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.posts'::regclass
                    and tgname = 'trg_posts_transcode_dispatch' and not tgisinternal) then
    raise exception 'trg_posts_transcode_dispatch was not created';
  end if;
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'transcode_dispatch_on_upload';
  if not v_secdef then
    raise exception 'transcode_dispatch_on_upload must be SECURITY DEFINER (it reaches Vault and pg_net on behalf of the uploader)';
  end if;
  if v_config is null or not exists (select 1 from unnest(v_config) c where c like 'search_path=%') then
    raise exception 'transcode_dispatch_on_upload must pin search_path';
  end if;
  raise notice 'transcode dispatch installed; it does nothing until Vault secret github_transcode_dispatch_token exists';
end $$;
