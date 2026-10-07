---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-10-07
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0004, 0017]
---

# ADR-0025 — Hide never-confirmed accounts at read time; purge them on a schedule that must exist

| | |
|---|---|
| **Status** | **Accepted** (board) — ratified by the owner 2026-10-07; change 1 (hide) built in `20261010000000`, change 2 (purge) pending |
| **Date** | 2026-10-07 |
| **Domain** | data + security (with client) |
| **Decided by** | board debate — principal-data, principal-security, principal-client, adversarial-critic; Chief Architect moderating. Product direction (hide + purge) approved in principle by the owner beforehand. |

---

## Context

Email sign-up creates a `profiles` row immediately: `handle_new_user()` runs AFTER INSERT on
`auth.users` (trigger `on_auth_user_created`, dashboard-made, not in migrations), **before** the
user confirms their email. Email confirmation is ON, so an unconfirmed user can never sign in —
but their profile is visible to everyone, and `search_discover_people` (SECURITY DEFINER,
bypasses RLS) orders its `people` fallback by `p.created_at desc`, so a brand-new unconfirmed
sign-up surfaces near the top of every user's "People you may know".

Production on 2026-10-07 (`fqzrmqnlgjeuxzinbqvs`): 59 accounts, **4 unconfirmed** (`dmvg`
2026-05-30, `itiswhatitis` 2026-07-05, `ima` 2026-09-03, `reddy1995` 2026-10-03), none ever
signed in, all `provider=email`, 0 unconfirmed OAuth. **3 pending friend requests** from real
users target them (latest 2026-10-06). No posts, tracks, messages, follows or stars reference
them. Every FK to `auth.users`/`profiles` from `public` is CASCADE or SET NULL.

The owner approved, in principle: **(A)** hide unconfirmed accounts from other users until
confirmed; **(B)** delete abandoned unconfirmed sign-ups after 7 days, freeing the username.
The board was asked *how*.

Constraints that made this hard:

- **No staging; shipped apps query `profiles` directly.** 2.1.2 (`1aa88a7`) reads `profiles`
  under RLS in `searchProfiles` (`src/services/tracks.ts`), the mention lookup
  (`src/services/comments.ts:277`), `AddUserSheet.tsx:51`, `share.ts:300` and many embeds.
  Only a server-side change reaches old apps; only RLS (not an RPC filter) hides from them.
- **`auth.users` is Supabase-owned.** No migration in this repo creates a trigger on it; whether
  a migration may on hosted Supabase today is unverified. Anything inside GoTrue's sign-up or
  confirm transaction that raises would break sign-up or confirmation **for everyone**.
- **The CI replay shim's `auth.users` has only `id, email` (+ `raw_user_meta_data` in one copy)**
  — no `email_confirmed_at`, `last_sign_in_at`, `created_at` (`.github/workflows/ci.yml:164-165`,
  `:713`). CI applies each migration with `psql -f` and no `--single-transaction` (`ci.yml:219`).
- **pg_cron is not installed.** The existing guarded `cron.schedule` precedent
  (`20260816030000_home_feed_candidates.sql:176-191`) only `RAISE NOTICE`s when pg_cron is
  absent — so `refresh-post-hot-scores` has very probably **never been scheduled in production**
  (inferred; check `cron.job`). The `cron` schema is invisible to the schema fingerprint
  (ADR-0017).

## Decision

**Hide (A) — read-time, no triggers on any Supabase-owned table, `handle_new_user` unchanged.**

1. `profiles.email_confirmed boolean not null default true`; in the same migration (which wraps
   itself in `BEGIN/COMMIT`) backfill `false` where `auth.users.email_confirmed_at is null`, then
   `alter column email_confirmed set default false`. After this, the column is a **cache that
   only ever goes false → true**; a stale `false` is harmless because the helper decides.
2. `public.auth_email_confirmed(uuid) returns boolean` — `STABLE`, `SECURITY DEFINER`,
   `search_path = ''`, a single primary-key read of `auth.users.email_confirmed_at`, boolean
   only. `EXECUTE` granted to `authenticated` (required — RLS evaluates as the caller), revoked
   from `public` and `anon` (the profiles policy is `to authenticated` only).
3. Replace `profiles_select_authenticated` with:
   `(id = auth.uid()) OR ((CASE WHEN email_confirmed THEN true ELSE public.auth_email_confirmed(id) END) AND (NOT is_blocked_between(auth.uid(), id) OR shares_conversation_with(auth.uid(), id)))`.
   `CASE`, not `OR`, so confirmed (cached) rows never pay the `auth.users` probe. No `is_ops()`
   clause — ops reads through `is_ops`-gated definer functions (`web/src/screens/OpsUser.tsx:36-44`).
4. `search_discover_people`: every section additionally requires confirmation **evaluated from
   `auth.users`** (directly or via the helper — never the cache alone). Signature and return
   shape unchanged.
5. `send_friend_request`: refuse a target that does not exist or is unconfirmed, with one
   snake_case error (e.g. `user_not_found`) — the same for both, so it is not an oracle. 2.1.2
   shows the raw message inline in `AddUserSheet` and rolls back its optimistic state (verified
   at `1aa88a7`: `relationships.ts:154-155`, `RelationshipContext.tsx:155-168`,
   `AddUserSheet.tsx:85,160`); existing errors (`blocked`, `already_friends`) already look like this.

**Purge (B) — a separate, later migration that refuses to apply without pg_cron.**

6. `public.purge_unconfirmed_accounts(p_limit int)` — plpgsql, **`SECURITY INVOKER`** (pg_cron
   runs as the owner, `postgres`, which can already delete from `auth.users`; an authenticated
   caller fails on missing grants, i.e. fails closed). `EXECUTE` revoked from `public, anon,
   authenticated`. Body is **one statement**:
   `DELETE FROM auth.users WHERE id IN (SELECT … LIMIT p_limit) AND <full predicate repeated>`
   — the repeated outer predicate is what READ COMMITTED re-checks against a row confirmed
   mid-run. Predicate, read from `auth.users`, **never from the cache**: `email_confirmed_at is
   null`, `last_sign_in_at is null`, `created_at < now() - interval '7 days'`, no non-`email`
   identity, and no posts / tracks / messages / accepted friendships. Returns the count.
   **Writes no `deleted_accounts` row** (that would reserve the username forever — the opposite
   of B). The same job also heals the cache (`set email_confirmed = true` where confirmed).
7. The migration **`RAISE EXCEPTION`s if pg_cron is absent** (not `NOTICE`), then
   `cron.schedule`s the nightly job. Installing pg_cron is an explicit owner step before applying.
8. **Detectors:** (i) a parity/ops check that the job row exists in `cron.job`; (ii) a drift
   assertion that no profile has `email_confirmed = true` while its `auth.users.email_confirmed_at
   is null` (the only cache error that leaks visibility).

**Left unchanged, deliberately:** `handle_new_user`; `is_username_available` (an unconfirmed
account must keep holding its name until purged, or confirmation collides on the unique index);
`get_email_for_username` (see Alternatives).

**Nobody is notified** — not the 3 requesters, not the purged addresses. Their pending requests
disappear by cascade; a notice would itself reveal the account existed.

**Tests (CI replay):** add `email_confirmed_at timestamptz default now()`, `last_sign_in_at
timestamptz`, `created_at timestamptz default now()` to **both** `auth.users` shim copies
(existing fixtures stay confirmed); new RLS tests in `supabase/tests/rls/` covering stranger /
blocker / conversation-peer / self visibility of an unconfirmed profile, a confirmed user whose
cache is `false` still visible, `search_discover_people` excluding unconfirmed,
`send_friend_request` refusal, `ops_users_overview` still listing unconfirmed, purge predicate
(deletes the 8-day-old unconfirmed, keeps the 6-day-old, the confirmed, the one with an OAuth
identity), and a grants assertion that `anon`/`authenticated` cannot execute the purge.

### Rollout (each step is separately applicable)

| # | Step | Production-safety verdict |
|---|---|---|
| 1 | CI shim columns + RLS tests (no prod effect) | Safe — CI only. |
| 2 | **Migration 1 — hide** (items 1–5) | **Safe to apply before any app update.** Only SELECT visibility tightens; no client inserts `profiles`; 2.1.2 surfaces verified tolerant (`.single()` on profiles is own-row only, `profileService.ts:73-212`; others use `.maybeSingle()`; `listFriends` is accepted-only; pending requests are ids only). Fail-safe: a wrong cache `false` heals at read time. Reversible by restoring the old policy. |
| 3 | Owner enables pg_cron (dashboard → Database → Extensions) | Safe — adds an extension; no app calls it. Does **not** retroactively schedule the hot-score job. |
| 4 | **Dry run** the purge predicate as a `SELECT` and read the list | Safe — read-only. Expected today: `dmvg`, `itiswhatitis`, `ima`. |
| 5 | **Migration 2 — purge + schedule** (items 6–8) | Safe for every app version. **Irreversible: the first nightly run permanently deletes `dmvg`, `itiswhatitis`, `ima` and the 3 pending requests to them; `reddy1995` follows on 2026-10-10 unless confirmed.** Usernames become free. |
| 6 | Verify `select * from cron.job` shows the job, and the next morning `cron.job_run_details` shows a success | Read-only. **Until this is verified, B is not live and this ADR's "7-day" claim is not true.** |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Implementer's draft:** column + BEFORE INSERT/UPDATE recompute trigger on `profiles` + AFTER UPDATE trigger on `auth.users` | The `profiles` recompute runs inside GoTrue's **sign-up** transaction (via `handle_new_user`) and the `auth.users` trigger inside its **confirm** transaction — a raise in either breaks sign-up or confirmation for everyone; swallowing instead leaves every newly confirmed user silently hidden, undetected, with no cron to heal it. Migration-created triggers on `auth.users` are unprecedented and unverified on hosted Supabase. The anti-spoof arm defends nothing: only a session holder can update their row, and unconfirmed users cannot get a session; an INVOKER trigger fired by `authenticated` likely cannot read `auth.users` at all. |
| `default true` permanently, with no writer (security's final bullet) | After the backfill, a **new** unconfirmed sign-up would get `true`, the `CASE` short-circuits to visible, and A fails for exactly the accounts it targets. Settled by reading the predicate, not by vote. |
| Purge alone, plus a filter in `search_discover_people` (no RLS change) | 2.1.2 reads `profiles` directly in search, mentions, AddUserSheet and share; an RPC filter misses all of them. Unconfirmed accounts would stay visible for up to 7 days. |
| A shorter grace period (24–48h) instead of hiding | Still visible during the window, and the 1h link plus no mobile resend means a genuine user needs slack. The owner chose 7 days. |
| Drop the column; policy = helper only | **Viable** and simpler. Rejected for now only because a non-inlinable definer probe runs per profile row on every RLS evaluation, including unbounded scans. Revisit after `EXPLAIN ANALYZE` (see Revisit). |
| Purge as `SECURITY DEFINER` | Extra privileged surface for no benefit when pg_cron runs as `postgres`; grants are not a reliable control here (Supabase grants `anon` directly; drop-and-recreate re-grants — `20260806040000`). |
| Select-ids-then-delete loop | Loses READ COMMITTED's re-check — can delete a user who confirmed mid-run. |
| Write a `deleted_accounts` ledger row on purge | Reserves the username permanently — turns a 7-day squat into a permanent one. |
| Guarded schedule that `RAISE NOTICE`s when pg_cron is absent (existing precedent) | Turns "never scheduled" into a green migration. The hot-score precedent is the evidence. |
| Schedule the job by hand in the dashboard only | Second piece of production-only state, like `on_auth_user_created`; invisible to CI and the fingerprint. |
| Filter `get_email_for_username` to confirmed emails | Turns "Email not confirmed" into a false "Invalid login credentials." for a username sign-in on mobile (`SignInScreen.tsx:48-71`, identical at `1aa88a7`; only the null-lookup branch hard-codes that text); hides nothing, since email sign-in and `is_username_available` still reveal the account. The function's anon username→email leak is real but applies to every user — separate ticket. |
| `is_ops()` clause in the profiles policy | Widens the perimeter for nothing; ops already reads via gated definer functions. |
| Mobile "Resend confirmation" button (now) | Parked: with the pre-account-takeover issue below, it would steer a victim into confirming an attacker's account. Route "account already exists" to Forgot Password instead, after that ticket. |

## Consequences

- Easy: unconfirmed accounts disappear from search, mentions, "People you may know" and
  friend-request targets for **every** app version at once; usernames held by abandoned sign-ups
  are freed.
- Cost: one new `SECURITY DEFINER` helper that answers "is user X confirmed?" to any signed-in
  caller (weaker than what `anon` already learns from `is_username_available` /
  `get_email_for_username`); one permanent pg_cron job; an irreversible nightly delete.
- Cost: every user who signs up after migration 1 pays one `auth.users` PK probe per RLS
  evaluation of their profile row until the nightly heal flips the cache. Bounded, unmeasured.
- Cost: a hidden account's profile screen, if reached from a stale screen, renders blank — the
  same as a blocked user today. A star/collaborator credit pointing at a purged user becomes a
  SET NULL row (render unverified; no such row is known to exist).
- A mobile user whose 1h link expired remains stuck until purge (pre-existing; not worsened).
- Forecloses: storing confirmation state anywhere a trigger must keep in sync with GoTrue.

**Not fixed by this ADR, raised by the debate (each needs its own ticket):**
1. **Pre-account takeover** (principal-security): an attacker can sign up with a victim's email,
   chosen username and avatar; a second `signUp` on that address returns 200 and does nothing
   (`web/src/auth/signIn.ts:193-196`); resend would confirm the attacker's account. Hiding removes
   the attacker's name/avatar from discovery and the purge frees the address after 7 days;
   neither fixes it. That ticket must re-check the purge's "no non-email identity" guard (if
   GoTrue links a victim's later Google sign-in to the attacker's row, the guard keeps it alive).
2. **`get_email_for_username` is anon-callable and returns any user's email** from a username
   (`20260607000003_auth_username_login_and_availability.sql:30-51`) — standing PII leak.
3. **`refresh-post-hot-scores` has very probably never run in production** (pg_cron absent;
   guard only `NOTICE`s). Enabling pg_cron in step 3 does not schedule it.

## Dissent

- **principal-data (Round 2), on the original trigger design:** argued the `auth.users` trigger
  should catch and `RAISE WARNING` rather than raise, because a raise blocks every confirmation.
  **principal-security** argued no swallowing ("a stale flag is worse than a loud failure"). The
  adopted design removes the trigger, so neither was chosen — recorded because if a trigger is
  ever reintroduced, this disagreement returns unresolved.
- **principal-data:** the column may be unnecessary — helper-only policy is simpler and may cost
  nothing measurable at this scale. Adopted as a revisit trigger, not as the decision.
- **principal-client (Round 1):** argued `default true` to fail open on a mid-migration gap;
  withdrawn in Round 2 (a single transaction has no gap). The surviving point — hiding is a
  visibility control and should fail open, deletion is irreversible and should fail closed —
  shaped the final design (stale cache ⇒ still visible; purge never trusts the cache).
- **principal-security (Round 1):** wanted `get_email_for_username` filtered; conceded in
  Round 2 on the verified sign-in wording.

**Process note (P6):** after Round 3 the critic's refutation replaced the core mechanism, so
data and security were given one bounded, written response to it before synthesis rather than
the moderator choosing between designs. That was not in the five-round protocol.

## Revisit when

- `EXPLAIN ANALYZE` of the feed `!inner` profile join (`src/services/posts.ts:561`) shows no
  measurable cost for the helper → drop the column, policy = helper only.
- Supabase offers a supported hook for confirmation events (e.g. an Auth hook on confirm) → a
  write-time cache could replace the read-time probe without a trigger on `auth.users`.
- A non-email sign-in method is added (phone/SSO) → re-check the purge's identity predicate.
- The pre-account-takeover ticket lands → re-check the identity guard and the parked resend button.
- Unconfirmed sign-ups become a meaningful fraction of accounts (abuse) → revisit the 7-day window.
