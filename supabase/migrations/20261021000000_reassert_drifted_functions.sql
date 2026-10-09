-- ============================================================================
-- Re-assert two kinds of production drift (schema-parity red on main since ~2026-10-04)
-- ============================================================================
--
-- `production matches the repo` has failed on main since the copyright/moderation work. A
-- line-by-line comparison on 2026-10-09 found exactly two kinds of difference, neither a
-- difference in behaviour:
--
-- 1. ops_copyright_scans(boolean, boolean): production's body is the 20261004010000 body
--    WITHOUT its two in-body comments ("The live track where it still exists…", "From the
--    ledger, not from `tracks`."). Logic verified identical with comments stripped. The
--    fingerprint hashes `prosrc`, comments included, so the comments must match too (the
--    recurring cause recorded in kb: comments edited into an already-applied migration).
--    Re-created below, byte-for-byte the 20261004010000 definition, `create or replace`
--    so the existing grants and comment are kept.
--
-- 2. Six internal, non-definer functions are executable by `anon` in production only:
--    Supabase's default privileges grant every new function in `public` to anon directly,
--    and those migrations revoked from PUBLIC but not from anon BY NAME. Five are trigger
--    functions (Postgres refuses to call those outside a trigger) and moderating_now() only
--    reads a transaction-local flag, so nothing was reachable — but the repo declares them
--    not anon-executable, and that is what is restored.
--
-- WHY THIS IS SAFE FOR APPS ALREADY INSTALLED: no signature, return shape, grant to
-- `authenticated`, or behaviour changes. Only text inside a function and anon's execute bit.
-- EXISTING DATA: untouched.
-- ============================================================================

revoke execute on function public.moderating_now() from anon;
revoke execute on function public.moderation_actions_append_only() from anon;
revoke execute on function public.moderation_actions_pin() from anon;
revoke execute on function public.track_copyright_scans_guard_update() from anon;
revoke execute on function public.tracks_freeze_media() from anon;
revoke execute on function public.tracks_freeze_takedown() from anon;

create or replace function public.ops_copyright_scans(
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
