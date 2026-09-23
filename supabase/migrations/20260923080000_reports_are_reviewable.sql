-- ============================================================================
-- A report you cannot listen to is not a moderation queue
-- ============================================================================
--
-- `ops_reports_overview` returned who reported what, and a line of text. It did not
-- return the TRACK — so the operator could read "Hate speech, on @someone" and had no way
-- to hear the song before deciding. The only available action was "Mark reviewed", which
-- records that somebody looked without recording what they concluded.
--
-- Google Play's UGC policy expects reports to be acted on. Acting on them requires, at
-- minimum, being able to play the thing that was reported and to remove it. This adds the
-- first half; the second half already exists as `ops_take_down_track` and needed only a
-- track id to point at.
--
-- ── WHY THE MEDIA URL IS SAFE TO RETURN ────────────────────────────────────
--
-- `audio_url` / `video_url` are public object URLs — the same ones every listener's
-- player already fetches. Returning them to an ops caller discloses nothing that a share
-- link does not, which is also why the operator console can play a track with no signed
-- URL machinery (see `opsTracks.ts`). The function stays `is_ops()`-gated regardless.
--
-- ── A COMMENT REPORT GETS THE TRACK TOO ────────────────────────────────────
--
-- A reported comment is a comment ON something. Judging "harassment" without hearing the
-- post it sits under means judging half the exchange, so the comment's post's track comes
-- back as well. The excerpt still shows the comment — that is what was reported.

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
    select
      'comment'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      c.author_id, auth_p.username,
      r.comment_id,
      left(c.body, 140),
      (c.id is not null),
      ct.id, ct.title, ct.media_kind,
      case when ct.media_kind = 'video' then ct.video_url else ct.audio_url end,
      coalesce(ct.cover_art_url, ct.thumbnail_url),
      ct.taken_down_at,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.post_comment_reports r
    left join public.profiles rep     on rep.id = r.reporter_id
    left join public.post_comments c  on c.id = r.comment_id
    left join public.profiles auth_p  on auth_p.id = c.author_id
    -- The post the comment sits under, and its track. A remark is not judgeable
    -- without the thing it was a remark about.
    left join public.posts cpo        on cpo.id = c.post_id
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

do $verify$
declare
  v_cols text[];
begin
  select array_agg(a.attname order by a.attnum) into v_cols
    from pg_proc p
    cross join lateral unnest(p.proallargtypes, p.proargnames)
      with ordinality as a(atttypid, attname, attnum)
   where p.proname = 'ops_reports_overview'
     and p.pronamespace = 'public'::regnamespace;

  if not (v_cols @> array['track_id', 'media_url', 'track_taken_down_at']) then
    raise exception 'VERIFY: the moderation queue still cannot play or act on a report';
  end if;
end
$verify$;
