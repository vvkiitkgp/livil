-- ============================================================================
-- Copyright matches can be marked reviewed, like reports
-- ============================================================================
--
-- The copyright queue had no way to say "I have looked at this". A match on an upload
-- that was never published — nothing live, nothing for a takedown to remove — stayed in
-- the list forever, and an operator re-read the same inert rows on every visit. Reports
-- solved the same problem with reviewed_at + "Show reviewed"; this gives the copyright
-- queue the same two controls.
--
-- ── WHY A SEPARATE TABLE AND NOT A COLUMN ON track_copyright_scans ──────────
--
-- `track_copyright_scans` is the evidence record — the provider verdict and what the
-- uploader declared — and it is guarded accordingly: an append-only trigger refuses
-- updates outside the uploader's allowlist, and three NOT VALID checks refuse ANY write to
-- the early rows that predate the current declaration shape (20260923070000 §2). A
-- `reviewed_at` column there would mean suspending those guards on every click, or a
-- button that fails on exactly the old test rows an operator most wants to clear.
--
-- Reviewing is the operator's bookkeeping, not part of the evidence, so it lives beside
-- it. Plain uuids and no foreign keys, for the reason that table gives: a scan row must
-- outlive its track and its author, and a cascade from here must never be able to touch
-- it. A review row whose scan is gone is harmless and never joined.
--
-- ── ACCESS ──────────────────────────────────────────────────────────────────
--
-- RLS on, ZERO policies: no client reads or writes this table directly. The only paths
-- are the two SECURITY DEFINER functions below, both is_ops()-gated. Read fails soft
-- (empty), write fails loud (raises) — the same split as ops_mark_report_reviewed, and for
-- its reason: a silently-failing write looks like a working process while recording
-- nothing.
--
-- ── BACKWARD COMPATIBLE ON PURPOSE ──────────────────────────────────────────
--
-- `p_include_reviewed` defaults to TRUE, so the web build already deployed — which calls
-- ops_copyright_scans(p_include_answered => true) — keeps seeing every row exactly as
-- before. Only the new build passes false to hide reviewed rows.
-- ============================================================================

create table if not exists public.ops_copyright_reviews (
  scan_id     uuid primary key,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid
);

comment on table public.ops_copyright_reviews is
  'Operator bookkeeping: which copyright matches have been looked at. Kept apart from '
  'track_copyright_scans, which is an append-only evidence record. No policies — read and '
  'written only through ops_copyright_scans / ops_mark_copyright_reviewed.';

alter table public.ops_copyright_reviews enable row level security;
revoke all on public.ops_copyright_reviews from anon, authenticated;

drop function if exists public.ops_copyright_scans(boolean);

create function public.ops_copyright_scans(
  p_include_answered boolean default false,
  p_include_reviewed boolean default true
)
returns table (
  id                uuid,
  track_id          uuid,
  track_title       text,
  uploader_id       uuid,
  uploader_username text,
  media_kind        text,
  provider          text,
  status            text,
  match_found       boolean,
  confidence        numeric,
  matched_title     text,
  matched_artist    text,
  matched_isrc      text,
  scanned_media_url text,
  acknowledgement   text,
  claim_basis       text,
  claim_grantor     text,
  claim_scope       text[],
  claim_territory   text,
  claim_term        text,
  claim_reference   text,
  claim_note        text,
  reference_matches_isrc boolean,
  accepted_responsibility  boolean,
  granted_streaming_licence boolean,
  live_uploads      bigint,
  live_reposts      bigint,
  taken_down_at     timestamptz,
  uploader_takedowns bigint,
  acknowledged_at   timestamptz,
  created_at        timestamptz,
  reviewed_at       timestamptz,
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
    with scan_rows as (
      select
        s.*,
        -- The live track where it still exists, the snapshot where it does not. A row
        -- whose track was deleted is the one most worth reading, so it must still say
        -- what it was and whose it was.
        coalesce(t.title, s.track_title, '(track deleted)')::text as shown_title,
        coalesce(t.uploader_id, s.track_uploader_id)              as owner_id,
        t.media_kind                                              as track_media_kind,
        t.taken_down_at                                           as track_taken_down_at,
        rv.reviewed_at                                            as ops_reviewed_at,
        rv.reviewed_by                                            as ops_reviewed_by
      from public.track_copyright_scans s
      left join public.tracks t on t.id = s.track_id
      left join public.ops_copyright_reviews rv on rv.scan_id = s.id
      where s.match_found is true
        and (p_include_answered or s.acknowledgement is null)
        and (p_include_reviewed or rv.scan_id is null)
    )
    select
      r.id, r.track_id, r.shown_title,
      r.owner_id, p.username, r.track_media_kind,
      r.provider, r.status, r.match_found, r.confidence,
      r.matched_title, r.matched_artist, r.matched_isrc, r.scanned_media_url,
      r.acknowledgement, r.claim_basis, r.claim_grantor, r.claim_scope,
      r.claim_territory, r.claim_term, r.claim_reference, r.claim_note,
      case
        when r.claim_reference is null or r.matched_isrc is null then null
        else upper(regexp_replace(r.claim_reference, '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(r.matched_isrc,   '[^A-Za-z0-9]', '', 'g'))
      end,
      r.accepted_responsibility,
      r.granted_streaming_licence,
      coalesce((select count(*) from public.posts po
                 where po.track_id = r.track_id and po.kind = 'upload'), 0),
      coalesce((select count(*) from public.posts po
                 where po.track_id = r.track_id and po.kind = 'repost'), 0),
      r.track_taken_down_at,
      -- From the ledger, not from `tracks`.
      coalesce((
        select count(*) filter (where m.action = 'takedown')
             - count(*) filter (where m.action = 'restore')
          from public.moderation_actions m
         where m.target_owner_id = r.owner_id
           and m.action in ('takedown', 'restore')
      ), 0),
      r.acknowledged_at, r.created_at,
      r.ops_reviewed_at, rvp.username
    from scan_rows r
    left join public.profiles p on p.id = r.owner_id
    left join public.profiles rvp on rvp.id = r.ops_reviewed_by
    order by r.created_at desc
    limit 500;
end;
$function$;

comment on function public.ops_copyright_scans(boolean, boolean) is
  'Operator view of uploads that matched a known recording, with the uploader''s rights '
  'declaration, how much is currently serving, and whether an operator has marked it '
  'reviewed. Returns empty for a non-ops caller rather than raising.';

revoke all     on function public.ops_copyright_scans(boolean, boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean, boolean) from anon;
grant  execute on function public.ops_copyright_scans(boolean, boolean) to authenticated;

-- Idempotent like ops_mark_report_reviewed: re-marking keeps the FIRST stamp, because
-- "when was this first looked at" is the fact worth keeping. p_reviewed = false reopens.
create or replace function public.ops_mark_copyright_reviewed(
  p_scan_id  uuid,
  p_reviewed boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_ops() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_reviewed then
    insert into public.ops_copyright_reviews (scan_id, reviewed_by)
    values (p_scan_id, auth.uid())
    on conflict (scan_id) do nothing;
  else
    delete from public.ops_copyright_reviews where scan_id = p_scan_id;
  end if;
end;
$function$;

revoke all     on function public.ops_mark_copyright_reviewed(uuid, boolean) from public;
revoke execute on function public.ops_mark_copyright_reviewed(uuid, boolean) from anon;
grant  execute on function public.ops_mark_copyright_reviewed(uuid, boolean) to authenticated;

comment on function public.ops_mark_copyright_reviewed(uuid, boolean) is
  'Marks one copyright match reviewed (or reopens it with p_reviewed = false). RAISES for '
  'a non-ops caller: a silent no-op on a write would leave an operator believing they had '
  'cleared something.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $verify$
begin
  if exists (select 1 from pg_policy where polrelid = 'public.ops_copyright_reviews'::regclass) then
    raise exception 'VERIFY: ops_copyright_reviews must have no policies — definer functions are the only door';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ops_copyright_reviews'::regclass) then
    raise exception 'VERIFY: RLS is off on ops_copyright_reviews';
  end if;
  if has_function_privilege('anon', 'public.ops_copyright_scans(boolean, boolean)', 'execute')
     or has_function_privilege('anon', 'public.ops_mark_copyright_reviewed(uuid, boolean)', 'execute') then
    raise exception 'VERIFY: anon can execute a copyright ops function';
  end if;
  if not has_function_privilege('authenticated', 'public.ops_copyright_scans(boolean, boolean)', 'execute') then
    raise exception 'VERIFY: authenticated lost execute on ops_copyright_scans — the drop discarded the grant';
  end if;
  if pg_get_functiondef('public.ops_copyright_scans(boolean, boolean)'::regprocedure) not like '%is_ops()%'
     or pg_get_functiondef('public.ops_mark_copyright_reviewed(uuid, boolean)'::regprocedure) not like '%is_ops()%' then
    raise exception 'VERIFY: a copyright ops function lost its is_ops() gate';
  end if;
end
$verify$;
