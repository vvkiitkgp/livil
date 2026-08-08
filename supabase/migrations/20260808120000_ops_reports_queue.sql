-- ============================================================================
-- The report queue — making three write-only tables readable, and actionable
-- ============================================================================
--
-- WHY THIS EXISTS. post_reports has shipped since 20260607000007 with an INSERT
-- policy and no SELECT policy, and a comment that said the quiet part out loud:
-- "Moderation reads happen via service role / admin tooling later." Nothing ever
-- read it. Google Play's UGC policy requires a moderation PROCESS, and a report
-- queue nobody can see is not a process — it is a table.
--
-- This adds the reader (/studio/ops) and the one piece of state that makes it a
-- queue rather than a log: whether a report has been dealt with.
--
-- ── WHY reviewed_at AND reviewed_by, AND NOTHING ELSE ───────────────────────
--
-- The temptation is a status enum — open / actioned / dismissed / escalated. That
-- is a workflow, and a workflow nobody has run yet is a guess. What the policy
-- actually requires you to be able to say is "this was looked at, by a person, on
-- this date". Two columns say exactly that and cannot fall out of sync with
-- reality. Add the enum when a second moderator makes the distinction real.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- Same posture as ops_users_overview() / ops_team_messages(): SECURITY DEFINER
-- because these tables have no SELECT policy for anyone, gated on is_ops() INSIDE
-- the body because definer rights bypass RLS, and returning EMPTY rather than
-- raising for a non-ops caller so /studio/ops needs no route guard.
-- ============================================================================

-- ── State ───────────────────────────────────────────────────────────────────
alter table public.post_reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

alter table public.post_comment_reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

alter table public.story_reports
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

-- Partial indexes: the queue view is "what is still open", which is the small set.
create index if not exists post_reports_open_idx
  on public.post_reports (created_at desc) where reviewed_at is null;
create index if not exists post_comment_reports_open_idx
  on public.post_comment_reports (created_at desc) where reviewed_at is null;
create index if not exists story_reports_open_idx
  on public.story_reports (created_at desc) where reviewed_at is null;

-- ── The queue ───────────────────────────────────────────────────────────────
-- One list across all three surfaces. A moderator cares about "what is waiting",
-- not about which table it landed in, and three separate panels would let the
-- least-visited one rot — which is how post_reports got here in the first place.
--
-- `kind` doubles as the discriminator the mark-reviewed RPC routes on, so the
-- client never has to know which table a row came from.
create or replace function public.ops_reports_overview(p_include_reviewed boolean default false)
returns table (
  kind               text,
  id                 uuid,
  created_at         timestamptz,
  reason             text,
  details            text,
  reporter_id        uuid,
  reporter_username  text,
  reported_user_id   uuid,
  reported_username  text,
  -- What was reported, in whatever form still exists. Null for a story that has
  -- since expired — the report survives it, so the row must tolerate the absence.
  target_id          uuid,
  target_excerpt     text,
  target_exists      boolean,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  reviewer_username  text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;

  return query
    -- ── Posts ──
    select
      'post'::text,
      r.id,
      r.created_at,
      r.reason,
      r.details,
      r.reporter_id,
      rep.username,
      po.author_id,
      auth_p.username,
      r.post_id,
      coalesce(t.title, '(track unavailable)')::text,
      (po.id is not null),
      r.reviewed_at,
      r.reviewed_by,
      rv.username
    from public.post_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.posts po        on po.id = r.post_id
    left join public.profiles auth_p on auth_p.id = po.author_id
    left join public.tracks t        on t.id = po.track_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Comments ──
    select
      'comment'::text,
      r.id,
      r.created_at,
      r.reason,
      r.details,
      r.reporter_id,
      rep.username,
      c.author_id,
      auth_p.username,
      r.comment_id,
      left(c.body, 140),
      (c.id is not null),
      r.reviewed_at,
      r.reviewed_by,
      rv.username
    from public.post_comment_reports r
    left join public.profiles rep     on rep.id = r.reporter_id
    left join public.post_comments c  on c.id = r.comment_id
    left join public.profiles auth_p  on auth_p.id = c.author_id
    left join public.profiles rv      on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Stories ──
    -- reported_user_id comes off the REPORT, not the story: the story may be gone.
    select
      'story'::text,
      r.id,
      r.created_at,
      r.reason,
      r.details,
      r.reporter_id,
      rep.username,
      r.reported_user_id,
      auth_p.username,
      r.story_id,
      case
        when s.id is null then '(story expired)'
        else coalesce(nullif(btrim(s.comment), ''), t.title, '(no caption)')
      end::text,
      (s.id is not null),
      r.reviewed_at,
      r.reviewed_by,
      rv.username
    from public.story_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.stories s       on s.id = r.story_id
    left join public.tracks t        on t.id = s.track_id
    left join public.profiles auth_p on auth_p.id = r.reported_user_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    order by 3 desc;
end;
$$;

revoke all on function public.ops_reports_overview(boolean) from public;
grant execute on function public.ops_reports_overview(boolean) to authenticated;

comment on function public.ops_reports_overview(boolean) is
  'The moderation queue for /studio/ops: post, comment and story reports in one list, newest first. Open reports only unless p_include_reviewed. Returns empty for a non-ops caller rather than raising, so the route needs no guard.';

-- ── Mark reviewed ───────────────────────────────────────────────────────────
-- Routes on the same `kind` the queue emits, so the client passes back what it was
-- given. Idempotent: re-marking an already-reviewed report keeps the FIRST review
-- stamp, because "when was this looked at" is the fact worth preserving.
create or replace function public.ops_mark_report_reviewed(
  p_kind text,
  p_id   uuid,
  p_reviewed boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if not public.is_ops() then
    raise exception 'not_authorized';
  end if;

  if p_kind = 'post' then
    update public.post_reports
       set reviewed_at = case when p_reviewed then coalesce(reviewed_at, now()) else null end,
           reviewed_by = case when p_reviewed then coalesce(reviewed_by, me) else null end
     where id = p_id;
  elsif p_kind = 'comment' then
    update public.post_comment_reports
       set reviewed_at = case when p_reviewed then coalesce(reviewed_at, now()) else null end,
           reviewed_by = case when p_reviewed then coalesce(reviewed_by, me) else null end
     where id = p_id;
  elsif p_kind = 'story' then
    update public.story_reports
       set reviewed_at = case when p_reviewed then coalesce(reviewed_at, now()) else null end,
           reviewed_by = case when p_reviewed then coalesce(reviewed_by, me) else null end
     where id = p_id;
  else
    raise exception 'unknown_report_kind: %', p_kind;
  end if;
end;
$$;

revoke all on function public.ops_mark_report_reviewed(text, uuid, boolean) from public;
grant execute on function public.ops_mark_report_reviewed(text, uuid, boolean) to authenticated;

comment on function public.ops_mark_report_reviewed(text, uuid, boolean) is
  'Marks one report reviewed (or reopens it with p_reviewed = false). Unlike the read side this RAISES for a non-ops caller: a silent no-op on a write would leave an operator believing they had actioned something.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['post_reports', 'post_comment_reports', 'story_reports'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'reviewed_at'
    ) then
      raise exception 'reviewed_at missing on %', t;
    end if;
  end loop;

  -- The read path must fail SOFT and the write path must fail LOUD. Getting these
  -- the wrong way round is the subtle bug: a silently-failing write looks like a
  -- working moderation process while recording nothing.
  if (select provolatile from pg_proc
       where oid = 'public.ops_reports_overview(boolean)'::regprocedure) <> 's' then
    raise exception 'ops_reports_overview should be STABLE';
  end if;
end $$;
