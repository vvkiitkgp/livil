-- ============================================================================
-- A comment report survives the comment being deleted
-- ============================================================================
--
-- post_comment_reports.comment_id was ON DELETE CASCADE, so deleting a reported comment
-- erased every report of it — the gap 20260808110000 recorded and left open. It mattered
-- little while only a comment's own author could delete it. Since 20261101000000 a post's
-- owner can delete any comment under their post, and the natural sequence — report the
-- abusive comment, then delete it — erased the report every time (security review,
-- 2026-10-17). The same fix story_reports got:
--
--   * comment_id becomes nullable, ON DELETE SET NULL — the report row stays;
--   * reported_user_id, comment_excerpt and comment_post_id are SNAPSHOTTED onto the report
--     at insert time by a trigger, from the stored comment — never from the client, which
--     could otherwise file a report against anyone (ADR-0008) — so "who wrote what, under
--     which post" is still known once the comment is gone;
--   * ops_reports_overview shows the snapshot — the words as reported — so neither
--     deleting nor changing the comment afterwards hides them;
--   * a report always starts unreviewed and dated now, whatever the client sent.
--
-- ADDITIVE for shipped apps: their insert is still {comment_id, reporter_id, reason,
-- details}; the trigger fills the rest. Existing reports are backfilled (production had
-- none when this was written).
-- ============================================================================

-- ── 1. The snapshot columns, and the trigger that fills them ───────────────
-- The trigger exists BEFORE reported_user_id becomes NOT NULL, so a report filed by a
-- shipped app while this runs is filled in rather than refused.
alter table public.post_comment_reports
  add column if not exists reported_user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists comment_excerpt text,
  add column if not exists comment_post_id uuid references public.posts(id) on delete set null;

create or replace function public.post_comment_reports_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Overwrites anything the client sent: the report is about the stored comment's author.
  select c.author_id, left(c.body, 500), c.post_id
    into new.reported_user_id, new.comment_excerpt, new.comment_post_id
    from post_comments c
   where c.id = new.comment_id;
  -- A report starts unreviewed and is dated now — a reporter cannot file one pre-marked
  -- "reviewed by" an operator, or backdated out of the open queue.
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.created_at  := now();
  return new;
end;
$$;

revoke execute on function public.post_comment_reports_snapshot() from public, anon, authenticated;

drop trigger if exists trg_post_comment_reports_snapshot on public.post_comment_reports;
create trigger trg_post_comment_reports_snapshot
  before insert on public.post_comment_reports
  for each row execute function public.post_comment_reports_snapshot();

-- ── 2. Existing reports, and the rule that every report names someone ──────
update public.post_comment_reports r
   set reported_user_id = c.author_id,
       comment_excerpt  = left(c.body, 500),
       comment_post_id  = c.post_id
  from public.post_comments c
 where c.id = r.comment_id
   and r.reported_user_id is null;

-- Every report names who it is about. With comment_id now nullable this is also what
-- refuses a report of nothing: the trigger cannot fill it without a real comment.
alter table public.post_comment_reports
  alter column reported_user_id set not null;

create index if not exists post_comment_reports_reported_idx
  on public.post_comment_reports (reported_user_id);

-- ── 3. The report outlives the comment ──────────────────────────────────────
alter table public.post_comment_reports
  drop constraint if exists post_comment_reports_comment_id_fkey;
alter table public.post_comment_reports
  alter column comment_id drop not null;
alter table public.post_comment_reports
  add constraint post_comment_reports_comment_id_fkey
  foreign key (comment_id) references public.post_comments(id) on delete set null;

-- ── 4. The moderation queue reads the snapshot when the comment is gone ─────
-- Body as in 20260923080000 except the Comments branch: reported user, excerpt and the
-- post (for its track) fall back to the report's own snapshot.
drop function if exists public.ops_reports_overview(boolean);

create or replace function public.ops_reports_overview(p_include_reviewed boolean default false)
returns table (
  kind              text,
  id                uuid,
  created_at        timestamptz,
  reason            text,
  details           text,
  reporter_id       uuid,
  reporter_username text,
  reported_user_id  uuid,
  reported_username text,
  target_id         uuid,
  target_excerpt    text,
  target_exists     boolean,
  -- ── new: enough to review the thing rather than just the accusation ──
  track_id            uuid,
  track_title         text,
  media_kind          text,
  media_url           text,
  cover_url           text,
  track_taken_down_at timestamptz,
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  reviewer_username text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_ops() then
    return;
  end if;

  return query
    -- ── Posts ──
    select
      'post'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      po.author_id, auth_p.username,
      r.post_id,
      coalesce(t.title, '(track unavailable)')::text,
      (po.id is not null),
      t.id, t.title, t.media_kind,
      case when t.media_kind = 'video' then t.video_url else t.audio_url end,
      coalesce(t.cover_art_url, t.thumbnail_url),
      t.taken_down_at,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.post_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.posts po        on po.id = r.post_id
    left join public.profiles auth_p on auth_p.id = po.author_id
    left join public.tracks t        on t.id = po.track_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Comments ──
    -- What was REPORTED: the words as they were at report time (the snapshot), so neither
    -- deleting nor changing the comment afterwards hides them. The live body only for a
    -- report filed before snapshots existed.
    select
      'comment'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      coalesce(c.author_id, r.reported_user_id), auth_p.username,
      r.comment_id,
      coalesce(left(r.comment_excerpt, 140), left(c.body, 140), '(comment deleted)')::text,
      (c.id is not null),
      ct.id, ct.title, ct.media_kind,
      case when ct.media_kind = 'video' then ct.video_url else ct.audio_url end,
      coalesce(ct.cover_art_url, ct.thumbnail_url),
      ct.taken_down_at,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.post_comment_reports r
    left join public.profiles rep     on rep.id = r.reporter_id
    left join public.post_comments c  on c.id = r.comment_id
    left join public.profiles auth_p  on auth_p.id = coalesce(c.author_id, r.reported_user_id)
    -- The post the comment sits (or sat) under, and its track. A remark is not judgeable
    -- without the thing it was a remark about.
    left join public.posts cpo        on cpo.id = coalesce(c.post_id, r.comment_post_id)
    left join public.tracks ct        on ct.id = cpo.track_id
    left join public.profiles rv      on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Stories ──
    -- reported_user_id comes off the REPORT, not the story: the story may be gone.
    select
      'story'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      r.reported_user_id, auth_p.username,
      r.story_id,
      case
        when s.id is null then '(story expired)'
        else coalesce(nullif(btrim(s.comment), ''), t.title, '(no caption)')
      end::text,
      (s.id is not null),
      t.id, t.title, t.media_kind,
      case when t.media_kind = 'video' then t.video_url else t.audio_url end,
      coalesce(t.cover_art_url, t.thumbnail_url),
      t.taken_down_at,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.story_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.stories s       on s.id = r.story_id
    left join public.tracks t        on t.id = s.track_id
    left join public.profiles auth_p on auth_p.id = r.reported_user_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    order by 3 desc;
end;
$function$;

comment on function public.ops_reports_overview(boolean) is
  'The moderation queue. Returns the reported TRACK as well as the report so an operator '
  'can play it before deciding — a queue you cannot listen to is a list of accusations.';

revoke all on function public.ops_reports_overview(boolean) from public;
revoke execute on function public.ops_reports_overview(boolean) from anon;
grant execute on function public.ops_reports_overview(boolean) to authenticated;
