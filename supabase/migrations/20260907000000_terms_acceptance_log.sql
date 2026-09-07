-- Terms of Service acceptance: an evidential record of who agreed to what, when.
--
-- WHY THIS EXISTS
--
-- Livil's Terms take a licence to hosted content: users grant permission to store,
-- stream and display their music. That is a bigger ask than "do not spam", and it is
-- the clause App Store Connect's Content Rights answer rests on. Until now the only
-- record of agreement was inference -- an account exists, therefore the terms shown
-- at that moment were accepted. That is not evidence.
--
-- WHAT MAKES A RECORD EVIDENCE, AND THE CHOICES THAT FOLLOW
--
--   1. The document must be immutable and versioned. Hence `terms_versions`, holding
--      a sha256 of the exact published text. The HASH IS WHY WE DO NOT STORE A COPY
--      PER USER: it proves v1.0 has not been edited since acceptance, in 64 bytes
--      instead of a document duplicated per row.
--
--   2. The link between user and version must be timestamped. Hence
--      `terms_acceptances`.
--
--   3. The link must be unalterable AFTERWARDS, including by us. Hence the deliberate
--      absence of UPDATE and DELETE policies below. A row a user (or an
--      authenticated attacker holding their token) could edit or remove is worth
--      very little in a dispute, and the strength of this table comes entirely from
--      what it does NOT permit.
--
-- `source` distinguishes agreeing once at signup from re-confirming ownership at each
-- upload. "They accepted two years ago" is a far weaker story than "they accepted at
-- signup and confirmed ownership on every upload since".
--
-- ON DELETION: user_id cascades. Deleting the account destroys the acceptance record
-- along with it, which is a real evidential cost, and it is deliberate:
-- livil-music.com/delete-account.html promises deletion is immediate and permanent,
-- and quietly retaining a row that names a deleted user would contradict a published
-- promise. If retention is ever wanted, change the PROMISE first, then this line.

-- ── 1. The published versions ───────────────────────────────────────────────
create table if not exists public.terms_versions (
  version      text primary key,
  effective_at timestamptz not null,
  url          text        not null,
  -- sha256 of the exact published text, so the document cannot be silently edited
  -- after someone has agreed to it.
  sha256       text        not null,
  created_at   timestamptz not null default now()
);

comment on table public.terms_versions is
  'Immutable catalogue of published Terms versions. Written by migration only.';

alter table public.terms_versions enable row level security;

-- Everyone signed in may read: the client needs to know the current version to decide
-- whether to re-prompt. No write policies at all -- new versions arrive by migration,
-- which is the point of an immutable catalogue.
drop policy if exists terms_versions_read on public.terms_versions;
create policy terms_versions_read
  on public.terms_versions for select
  to authenticated
  using (true);

-- ── 2. The acceptance log ───────────────────────────────────────────────────
create table if not exists public.terms_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  version     text        not null references public.terms_versions(version),
  accepted_at timestamptz not null default now(),
  -- 'signup'   -- first acceptance, gating entry to the app
  -- 'reaccept' -- accepted a NEW version after the terms changed
  -- 'upload'   -- re-confirmed ownership at the moment of uploading
  source      text        not null check (source in ('signup', 'reaccept', 'upload')),
  -- Which build the user was running. Answers "what exactly did the screen say?"
  -- when the wording has since changed.
  app_version text
);

comment on table public.terms_acceptances is
  'Append-only. Deliberately has no UPDATE or DELETE policy: a record that can be '
  'altered after the fact is not evidence.';

-- One acceptance per user per version -- but uploads repeat, so they are excluded
-- rather than being blocked by the constraint.
create unique index if not exists terms_acceptances_one_per_version
  on public.terms_acceptances (user_id, version)
  where source in ('signup', 'reaccept');

-- The gate reads "has this user accepted the current version?" on every cold start.
create index if not exists terms_acceptances_user_idx
  on public.terms_acceptances (user_id, version);

alter table public.terms_acceptances enable row level security;

-- Insert: only ever for yourself. `with check` pins user_id to the caller, so a
-- client cannot log an acceptance on somebody else's behalf.
drop policy if exists terms_acceptances_insert_own on public.terms_acceptances;
create policy terms_acceptances_insert_own
  on public.terms_acceptances for insert
  to authenticated
  with check (user_id = auth.uid());

-- Select: only your own. Nobody enumerates who has agreed to what.
drop policy if exists terms_acceptances_select_own on public.terms_acceptances;
create policy terms_acceptances_select_own
  on public.terms_acceptances for select
  to authenticated
  using (user_id = auth.uid());

-- NO UPDATE POLICY AND NO DELETE POLICY. This is not an oversight -- it is the entire
-- security property of this table. With RLS enabled and no policy for a command, that
-- command is denied to every non-superuser role. Adding either one destroys the
-- evidential value of everything above.

-- ── 3. Seed the current version ─────────────────────────────────────────────
-- sha256 comes from scripts/generate-terms.mjs, which hashes the exact published
-- HTML and generates the in-app copy from the same source. Recorded as a row rather
-- than a constant so the client can learn about a new version without shipping a
-- build. Re-run that script and update this value on any edit to docs/terms.html --
-- a stale hash is worse than none, because it asserts something untrue.
insert into public.terms_versions (version, effective_at, url, sha256)
values (
  '1.0',
  '2026-09-07T00:00:00Z',
  'https://livil-music.com/terms.html',
  'f720d9e18ffed9043760f68770f7ee8a2bf624627725952a31b09c2decce074c'
)
on conflict (version) do nothing;
