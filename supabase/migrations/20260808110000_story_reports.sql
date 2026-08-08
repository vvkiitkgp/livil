-- ============================================================================
-- Story reports — the missing third reportable surface
-- ============================================================================
--
-- Posts and comments have been reportable since 20260607000004 / 20260607000007.
-- Stories were not, and stories are the surface that most needs it: full-screen,
-- autoplaying, and gone in 24 hours whether or not anyone acted.
--
-- ── WHY THIS TABLE IS NOT AN EXACT MIRROR OF post_reports ───────────────────
--
-- post_reports.post_id is `on delete cascade`. For a post that is a defensible
-- trade: a post is durable, so the report generally outlives the review.
--
-- A story is not durable. It expires by design, and when its row goes the cascade
-- would take every report of it with it — so the queue would reliably empty itself
-- of exactly the reports a moderator had not yet reached. The evidence would be
-- gone before the moderation process ran, every time, by construction.
--
-- Two consequences, both deliberate:
--
--   * story_id is `on delete set null`. The report row survives the story.
--   * reported_user_id is DENORMALIZED onto the report. Once the story is gone,
--     the author is otherwise unknowable, and "someone reported something, we
--     cannot say who" is not a moderation record. It is derived server-side in
--     report_story() below, never accepted from the client.
--
-- KNOWN GAP, recorded rather than fixed here: post_reports and post_comment_reports
-- still cascade, so an author who deletes a reported post also erases the report.
-- Closing that is the same change applied to two more tables and belongs in its own
-- migration with its own backfill of reported_user_id.
-- ============================================================================

create table if not exists public.story_reports (
  id uuid primary key default gen_random_uuid(),
  -- Nullable BY DESIGN — see above. A null story_id means "reported, then expired".
  story_id uuid references public.stories(id) on delete set null,
  -- Survives the story. Server-derived; never client-supplied.
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','hate','misinformation','other')),
  details text,
  created_at timestamptz not null default now()
);

create index if not exists story_reports_reporter_idx
  on public.story_reports (reporter_id);
create index if not exists story_reports_reported_idx
  on public.story_reports (reported_user_id);

alter table public.story_reports enable row level security;

-- Write-only from the client, exactly like its two siblings: no SELECT policy for
-- anyone, because a user must not be able to read other users' reports. Ops reads
-- go through the is_ops()-gated RPC in the next migration, which is SECURITY
-- DEFINER and so is unaffected by the absence of a select policy here.
--
-- There is no INSERT policy either: reported_user_id must be derived, not asserted,
-- so report_story() is the only way in.

-- ── report_story ────────────────────────────────────────────────────────────
-- The story author is looked up from the story, never taken as a parameter — the
-- ADR-0008 principle. A client that could name the reported user could file
-- reports against anyone, which is a harassment vector of its own.
create or replace function public.report_story(
  p_story_id uuid,
  p_reason   text,
  p_details  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_author uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select author_id into v_author from public.stories where id = p_story_id;
  if v_author is null then raise exception 'story_not_found'; end if;
  if v_author = me then raise exception 'cannot_report_own_story'; end if;

  -- Mirrors the client-side rule in the report modals so the constraint is
  -- enforced on both sides rather than trusted from one.
  if p_reason = 'other' and coalesce(btrim(p_details), '') = '' then
    raise exception 'details_required_for_other';
  end if;

  insert into public.story_reports
    (story_id, reported_user_id, reporter_id, reason, details)
  values
    (p_story_id, v_author, me, p_reason, nullif(btrim(p_details), ''));
end;
$$;

revoke all on function public.report_story(uuid, text, text) from public;
grant execute on function public.report_story(uuid, text, text) to authenticated;

comment on function public.report_story(uuid, text, text) is
  'Files a report against a story. Derives the reported user from the story rather than accepting it, so a caller cannot file reports against arbitrary users. Reason is checked against the same enum as post_reports.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
declare
  v_delete_rule text;
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'story_reports' and rowsecurity
  ) then
    raise exception 'story_reports is missing or has RLS disabled';
  end if;

  -- The whole point of the table: the story FK must NOT cascade, or the queue
  -- silently empties as stories expire.
  select rc.delete_rule into v_delete_rule
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc
      on tc.constraint_name = rc.constraint_name
     and tc.constraint_schema = rc.constraint_schema
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.constraint_schema = tc.constraint_schema
   where tc.table_schema = 'public'
     and tc.table_name = 'story_reports'
     and kcu.column_name = 'story_id';

  if v_delete_rule is distinct from 'SET NULL' then
    raise exception
      'story_reports.story_id delete rule is % — must be SET NULL so reports outlive expiring stories',
      coalesce(v_delete_rule, 'missing');
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'story_reports' and cmd = 'SELECT'
  ) then
    raise exception 'story_reports must have no SELECT policy — ops reads go through the definer RPC';
  end if;
end $$;
