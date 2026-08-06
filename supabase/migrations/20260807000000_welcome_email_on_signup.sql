-- ============================================================================
-- Welcome email — the ledger and the two RPCs the sender needs
-- ============================================================================
--
-- Until now the only mail a new account produced was Supabase Auth's "Confirm your
-- signup". Nothing greeted the person once the account actually existed. This adds
-- that email, sent exactly once per account, by the `welcome-email` edge function.
--
-- ── WHEN IT SENDS, AND WHY NOT AT SIGNUP ────────────────────────────────────
--
-- On the account's FIRST CONFIRMED, AUTHENTICATED SESSION — not when `auth.signUp`
-- returns. Two reasons, both load-bearing:
--
--   1. At signUp the address is UNVERIFIED. Mailing it means anyone can make
--      `mail.livil-music.com` send to a stranger by typing their address into the
--      signup form. That domain also carries password resets and confirmations, so
--      spam complaints against it can cost us auth email — the abuse model written at
--      the top of `waitlist-join/app.ts` applies here verbatim.
--   2. It would arrive in the same second as the confirmation email, competing with
--      the one message the person actually has to act on.
--
-- Waiting for a session means the address is confirmed (the person followed the link,
-- or Google vouched for it) AND we hold their JWT, so the recipient is DERIVED from
-- the token and is never a parameter. That is ADR-0008 decision 1 applied to mail:
-- this sender has no recipient argument to forge, and no body argument either — the
-- copy is fixed in the function.
--
-- ── WHY A CLAIM TABLE AND NOT A TRIGGER ─────────────────────────────────────
--
-- A trigger on `auth.users` is the obvious answer and is not available: emitting HTTP
-- from Postgres needs pg_net, which does NOT exist on this project (verified in
-- 20260806000000_waitlist_self_serve_invite.sql — no `net` schema), and ADR-0008
-- rejects dashboard-configured Database Webhooks as unversioned production state. So
-- the send happens in an edge function, and these two DEFINER functions are the things
-- that function cannot do as the calling user: claim the right to send, and record the
-- outcome.
--
-- ── WHY NO service_role ─────────────────────────────────────────────────────
--
-- ADR-0008 §4. The edge function holds the Resend key and nothing else; it talks to
-- Postgres with the anon key plus the caller's own Authorization header. Both
-- functions below act on `auth.uid()` and take no user id, so neither can be aimed at
-- another account no matter who calls them.
--
-- ── EXISTING ACCOUNTS ARE SUPPRESSED, NOT SENT ──────────────────────────────
--
-- Every account that exists when this migration applies gets a row with
-- `suppressed_at` set. Without it, shipping the client change would mail a "welcome to
-- Livil" to every established user the next time they opened the app.
--
-- `suppressed_at` is a separate column from `sent_at` deliberately. Backfilling
-- `sent_at` would have been one column fewer and would have made it lie: nothing was
-- sent to these people. A status column that lies is how you end up unable to answer
-- "did the automation fire?" — the same reasoning that put `email_source` on
-- `waitlist` rather than inferring it.
-- ============================================================================

-- ── the ledger ──────────────────────────────────────────────────────────────
--
-- One row per account, created at the moment of the first claim. Not created by
-- `handle_new_user()`: a row's existence is what stops a second send, so it must be
-- written by the sender, not by signup.

create table if not exists public.welcome_emails (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  claimed_at    timestamptz not null default now(),
  attempts      integer     not null default 0,
  sent_at       timestamptz,
  suppressed_at timestamptz,
  error         text
);

comment on table public.welcome_emails is
  'One row per account, written by the welcome-email edge function. The row IS the '
  'idempotency guarantee: no row means never attempted, sent_at means Resend accepted '
  'it, suppressed_at means we deliberately will not send (accounts predating the '
  'feature). Client-unreadable by design — no policies, no grants.';

comment on column public.welcome_emails.attempts is
  'Claims, not sends. Bounded at 3 by welcome_email_claim so a permanently failing '
  'address cannot be retried on every app launch forever.';

-- Deny-all: RLS on with no policies at all, plus the grants revoked. Nothing outside
-- the two DEFINER functions below has any business reading or writing this — not even
-- the owner of the row, who learns nothing useful from it and would only give a forged
-- client something to poke at.
alter table public.welcome_emails enable row level security;
revoke all on table public.welcome_emails from anon, authenticated;

-- ── suppress every account that already exists ──────────────────────────────
--
-- Runs before the RPCs are created, so there is no window in which a claim could race
-- the backfill. `on conflict do nothing` keeps a re-run harmless.
insert into public.welcome_emails (user_id, claimed_at, attempts, suppressed_at)
select u.id, now(), 0, now()
from auth.users u
on conflict (user_id) do nothing;

-- ── claim ───────────────────────────────────────────────────────────────────
--
-- Returns true to EXACTLY ONE caller, and only that caller may send.
--
-- The whole decision is one statement, which is what makes it safe under concurrency:
-- two clients signing in at once (phone and dashboard) both reach the INSERT, the
-- second blocks on the first's row lock, and by the time it proceeds `claimed_at` has
-- just moved — so its ON CONFLICT ... WHERE fails, it updates nothing, and RETURNING
-- yields no row. Reading and then writing would have let both win.
--
-- The conditions on the conflict path are the retry policy:
--   sent_at is null       — never send twice
--   suppressed_at is null — never send to an account that predates the feature
--   attempts < 3          — stop retrying an address that keeps failing
--   claimed_at older than 15 min — a claim that never reported an outcome (the edge
--                           function died mid-send) becomes retryable, but not
--                           immediately, so a crash-loop cannot fan out mail.
--
-- DEFINER + `search_path = public, pg_temp` per LIV-16: pg_temp is searched first for
-- unqualified relation names, so a caller could otherwise shadow `public.welcome_emails`
-- with a temp table inside this body. Keep pg_temp last.

create or replace function public.welcome_email_claim()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_won boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.welcome_emails as w (user_id, claimed_at, attempts)
  values (v_uid, now(), 1)
  on conflict (user_id) do update
     set claimed_at = now(),
         attempts   = w.attempts + 1
   where w.sent_at is null
     and w.suppressed_at is null
     and w.attempts < 3
     and w.claimed_at < now() - interval '15 minutes'
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

comment on function public.welcome_email_claim() is
  'Atomically claims the right to send this caller''s welcome email. True means send; '
  'false means someone already did, or it is suppressed, or it has failed too often.';

-- ── record the outcome ──────────────────────────────────────────────────────
--
-- Success sets `sent_at` and the row is final. Failure records the reason and leaves
-- `sent_at` null, so the next launch (after the 15-minute cooldown) may retry until the
-- attempt cap is reached.
--
-- No user id parameter: it acts on `auth.uid()`, so a caller cannot mark another
-- account's welcome as sent and thereby silently cancel it.

create or replace function public.welcome_email_mark(p_error text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.welcome_emails
     set sent_at = case when p_error is null then now() else null end,
         error   = case when p_error is null then null else left(p_error, 500) end
   where user_id = auth.uid()
     and sent_at is null
     and suppressed_at is null;
$$;

comment on function public.welcome_email_mark(text) is
  'Records the outcome of the caller''s own welcome-email send. NULL error = sent.';

-- ── grants ──────────────────────────────────────────────────────────────────
--
-- `authenticated` only. Neither function is reachable without a session: the edge
-- function always calls them with the caller's JWT, and an anon caller has no
-- auth.uid() to act on.
--
-- NOTE THE `anon` IN THE REVOKE, and do not drop it. Per
-- 20260806040000_revoke_stale_anon_function_grants.sql, Supabase's default privileges
-- issue a DIRECT grant to `anon` and `authenticated` on every new function created in
-- `public`, and `revoke ... from public` does not touch a direct grant. Four earlier
-- migrations wrote the revoke-from-public line believing it was a guard; it was not.
revoke all on function public.welcome_email_claim()       from public, anon;
revoke all on function public.welcome_email_mark(text)    from public, anon;
grant execute on function public.welcome_email_claim()    to authenticated;
grant execute on function public.welcome_email_mark(text) to authenticated;
