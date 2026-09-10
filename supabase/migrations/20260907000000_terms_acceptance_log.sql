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
--   3. The link must be unalterable AFTERWARDS -- including by us, which is the hard
--      part. Absent UPDATE/DELETE policies stop every CLIENT, but RLS is not
--      consulted for the table owner and is bypassed outright by service_role, both
--      reachable from the dashboard and the service key. The operator is precisely
--      the party whose interest the record cuts against, so "no policy" alone would
--      leave a counterparty's first argument -- "Livil could have written that row"
--      -- unanswered. TRIGGERS fire for the owner too, which is why section 4 exists.
--
--      Deliberately NOT `force row level security`, which looks like the obvious fix
--      and would break account deletion: delete_my_account() runs SECURITY DEFINER
--      and its `delete from auth.users` cascades into this table, so forcing RLS on
--      the owner with no DELETE policy would abort that cascade and take the whole
--      deletion transaction down. Block UPDATE with a trigger; leave DELETE to the
--      cascade, which is ratified below.
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
  -- Format-checked so a placeholder can never be stored: the hash is the whole
  -- mechanism by which an acceptance means anything, and a row attached to a version
  -- with no real attestation is worse than none.
  sha256       text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now()
);

comment on table public.terms_versions is
  'Immutable catalogue of published Terms versions. Written by migration only.';

alter table public.terms_versions enable row level security;

-- Readable by anyone signed in. Note the client does NOT currently read this table --
-- TERMS_VERSION is compiled into the build from docs/terms.html -- so this policy
-- serves auditing and any future server-driven re-prompt, not today's gate. Said
-- plainly because an earlier draft of this comment claimed the client learns about new
-- versions here, which was simply untrue.
-- No write policies at all: new versions arrive by migration.
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
  --
  -- An 'upload' source is deliberately ABSENT until the upload confirmation is built.
  -- Admitting it now would allow rows that (a) no unique index bounds, so a client
  -- could insert them without limit, and (b) name no upload, since there is no
  -- track_id column -- which would make "confirmed ownership on every upload" a claim
  -- the schema cannot actually demonstrate. Add the value, a track_id, and a
  -- (user_id, version, track_id) index together, and rule explicitly then on whether
  -- deleting a track should destroy its ownership confirmation.
  source      text        not null check (source in ('signup', 'reaccept')),
  -- Which build the user was running. Answers "what exactly did the screen say?"
  -- when the wording has since changed.
  app_version text
);

comment on table public.terms_acceptances is
  'Append-only. Deliberately has no UPDATE or DELETE policy: a record that can be '
  'altered after the fact is not evidence.';

-- One acceptance per user per version. Every currently-permitted source is covered,
-- so there is no unbounded row type; revisit the WHERE clause when 'upload' lands.
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

-- NO UPDATE POLICY AND NO DELETE POLICY. Not an oversight -- with RLS enabled and no
-- policy for a command, that command is denied to every client role. Adding either one
-- destroys the evidential value of everything above. But policies stop clients only;
-- section 4 is what stops the owner.

-- ── 4. Immutability that binds the OPERATOR, not just clients ───────────────
-- RLS is not consulted for the table owner and is bypassed by service_role. Triggers
-- are, which is the entire reason these exist rather than more policies. Same pattern
-- as enforce_username_immutable in 20260628000000.

create or replace function public.terms_acceptances_no_update()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'terms_acceptances is append-only: acceptance records cannot be edited';
end;
$function$;

drop trigger if exists trg_terms_acceptances_no_update on public.terms_acceptances;
create trigger trg_terms_acceptances_no_update
  BEFORE UPDATE ON public.terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.terms_acceptances_no_update();

-- DELETE is deliberately NOT blocked: delete_my_account() cascades through this table,
-- and the published deletion promise outranks retention. See the header.

-- Server-authoritative fields. `default now()` only applies when a column is OMITTED,
-- and PostgREST will happily insert a client-supplied value -- so without this, the
-- "when" in a when-did-they-agree record was asserted by the device and verified by
-- nothing. Overwriting in a BEFORE INSERT trigger is used rather than column-level
-- REVOKE because CI re-grants every table privilege after migrations, which would
-- silently undo a revoke.
create or replace function public.terms_acceptances_pin_server_fields()
returns trigger
language plpgsql
as $function$
begin
  new.accepted_at := now();
  new.user_id     := auth.uid();
  return new;
end;
$function$;

drop trigger if exists trg_terms_acceptances_pin on public.terms_acceptances;
create trigger trg_terms_acceptances_pin
  BEFORE INSERT ON public.terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.terms_acceptances_pin_server_fields();

-- The catalogue is only "immutable" if a published version cannot be rewritten. A
-- hash that can be retro-fitted to changed text proves nothing, and the generator
-- script previously printed an UPDATE for a human to paste -- exactly the operation
-- this refuses. A new version is a NEW ROW.
create or replace function public.terms_versions_immutable()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'terms_versions is immutable: publish a new version as a new row';
end;
$function$;

drop trigger if exists trg_terms_versions_immutable on public.terms_versions;
create trigger trg_terms_versions_immutable
  BEFORE UPDATE OR DELETE ON public.terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.terms_versions_immutable();

-- ── 3. Seed the current version ─────────────────────────────────────────────
-- sha256 comes from scripts/generate-terms.mjs, which hashes the exact published
-- HTML and generates the in-app copy from the same source. Recorded as a row rather
-- than a constant so the client can learn about a new version without shipping a
-- build. On any edit to docs/terms.html, re-run that script and add a NEW ROW for the
-- new version -- section 4 refuses an UPDATE, deliberately: a hash that can be
-- retro-fitted to changed text attests to nothing.
insert into public.terms_versions (version, effective_at, url, sha256)
values (
  '1.0',
  '2026-09-07T00:00:00Z',
  'https://livil-music.com/terms.html',
  'f720d9e18ffed9043760f68770f7ee8a2bf624627725952a31b09c2decce074c'
)
on conflict (version) do nothing;
