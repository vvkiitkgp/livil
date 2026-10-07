-- ============================================================================
-- Purge abandoned never-confirmed sign-ups nightly (ADR-0025, change 2 of 2)
-- ============================================================================
--
-- Change 1 (20261010000000) hid never-confirmed accounts from everyone else. This deletes
-- the abandoned ones, so their usernames are freed and the friend requests stranded on
-- them disappear.
--
-- IRREVERSIBLE. The first nightly run deletes every account matching the predicate below.
-- On 2026-10-08 a read-only dry run of that predicate returned dmvg, itiswhatitis and ima
-- (and the 3 pending requests to them); reddy1995 follows on 2026-10-10 unless confirmed.
--
-- Decisions (ADR-0025 items 6–8):
--   * SECURITY INVOKER, not DEFINER. pg_cron runs as the owner (postgres), who can already
--     delete from auth.users; an authenticated caller fails on grants, i.e. fails CLOSED.
--   * ONE statement. The outer predicate repeats the inner one, so READ COMMITTED re-checks
--     each row at delete time — a user who confirms mid-run is kept.
--   * The predicate reads auth.users and the content tables, NEVER the
--     profiles.email_confirmed cache, which may be stale.
--   * NO deleted_accounts row: that ledger reserves the username forever, the opposite of
--     what this is for.
--   * Also heals the cache (false -> true for confirmed users) so the profiles policy
--     stops paying the auth.users probe for them.
--   * Refuses to install without pg_cron (RAISE EXCEPTION, not NOTICE). The hot-score
--     job's NOTICE-only guard is how that job went unscheduled in production unnoticed.
--
-- PRODUCTION COMPATIBILITY: no app version calls anything here. Deleting an account
-- cascades its profile and any pending friendship rows (every FK to auth.users/profiles
-- is CASCADE or SET NULL); a requester simply stops seeing the pending request.

begin;

-- 0. The scheduler must exist ------------------------------------------------------------
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not installed — enable it (Database → Extensions → pg_cron) before applying ADR-0025 change 2';
  end if;
end $$;

-- 1. The purge ---------------------------------------------------------------------------
create or replace function public.purge_unconfirmed_accounts(p_limit int default 500)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted int;
begin
  delete from auth.users u
   where u.id in (
           select c.id
             from auth.users c
            where c.email_confirmed_at is null
              and c.last_sign_in_at is null
              and c.created_at < now() - interval '7 days'
              and not exists (select 1 from auth.identities i
                               where i.user_id = c.id and i.provider <> 'email')
              and not exists (select 1 from public.posts x where x.author_id = c.id)
              and not exists (select 1 from public.tracks x where x.uploader_id = c.id)
              and not exists (select 1 from public.messages x where x.sender_id = c.id)
              and not exists (select 1 from public.friendships f
                               where f.status = 'accepted'
                                 and c.id in (f.user_a_id, f.user_b_id))
            order by c.created_at
            limit greatest(coalesce(p_limit, 500), 1)
         )
     -- Repeated on purpose: re-evaluated against the row as it is at delete time.
     and u.email_confirmed_at is null
     and u.last_sign_in_at is null
     and u.created_at < now() - interval '7 days'
     and not exists (select 1 from auth.identities i
                      where i.user_id = u.id and i.provider <> 'email')
     and not exists (select 1 from public.posts x where x.author_id = u.id)
     and not exists (select 1 from public.tracks x where x.uploader_id = u.id)
     and not exists (select 1 from public.messages x where x.sender_id = u.id)
     and not exists (select 1 from public.friendships f
                      where f.status = 'accepted'
                        and u.id in (f.user_a_id, f.user_b_id));
  get diagnostics v_deleted = row_count;

  -- Heal the cache: confirmed since sign-up. Only ever false -> true.
  update public.profiles p
     set email_confirmed = true
    from auth.users u
   where u.id = p.id
     and not p.email_confirmed
     and u.email_confirmed_at is not null;

  return v_deleted;
end;
$$;

revoke execute on function public.purge_unconfirmed_accounts(int) from public, anon, authenticated;

-- 2. The schedule ------------------------------------------------------------------------
-- 21:30 UTC = 03:00 IST, the quietest hour. Re-running this migration updates the job
-- in place (pg_cron upserts by name).
select cron.schedule(
  'purge-unconfirmed-accounts',
  '30 21 * * *',
  'select public.purge_unconfirmed_accounts(500);'
);

-- 3. Self-checks -------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purge-unconfirmed-accounts') then
    raise exception 'purge-unconfirmed-accounts is not in cron.job — the 7-day purge would not run';
  end if;
  if has_function_privilege('anon', 'public.purge_unconfirmed_accounts(int)', 'execute')
     or has_function_privilege('authenticated', 'public.purge_unconfirmed_accounts(int)', 'execute') then
    raise exception 'purge_unconfirmed_accounts is executable by a client role';
  end if;
  if exists (select 1 from pg_proc where oid = 'public.purge_unconfirmed_accounts(int)'::regprocedure
              and prosecdef) then
    raise exception 'purge_unconfirmed_accounts must be SECURITY INVOKER (ADR-0025)';
  end if;
end $$;

commit;
