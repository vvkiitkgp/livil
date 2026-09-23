-- ============================================================================
-- What is actually live on each row — because two rows looked identical
-- ============================================================================
--
-- WHY THIS EXISTS. A real misclick, first time the actuator was used in anger.
--
-- Two test uploads carried the same title, the same artist and the same match. The queue
-- ranks by concern, so the one with NO live posts sorted above the one with an upload and
-- a repost — and there was nothing on either row to tell them apart. The operator took
-- down the empty one, nothing changed in the app, and the reasonable conclusion was that
-- the feature was broken. It was not: the takedown was recorded correctly, against a
-- track nobody could see anyway.
--
-- The fix is not a warning. It is putting the fact on the row that would have made the
-- choice obvious: how much is actually serving right now.
--
-- Counted live rather than stored. `posts.track_id` is NOT NULL and both deletes and
-- inserts move it constantly, so a maintained counter and the posts it counts would drift
-- — the same argument `ops_takedown_counts` makes for deriving the strike count.

drop function if exists public.ops_copyright_scans(boolean);

create or replace function public.ops_copyright_scans(p_include_answered boolean default false)
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
  accepted_responsibility   boolean,
  granted_streaming_licence boolean,
  -- What a takedown would actually remove. Separate counts, not a total: "one upload and
  -- nine reposts" is a different decision from "one post", and the reposts belong to other
  -- people whose posts also disappear.
  live_uploads      bigint,
  live_reposts      bigint,
  taken_down_at     timestamptz,
  uploader_takedowns bigint,
  acknowledged_at   timestamptz,
  created_at        timestamptz
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
    select
      s.id, s.track_id,
      coalesce(t.title, '(track unavailable)')::text,
      t.uploader_id, p.username, t.media_kind,
      s.provider, s.status, s.match_found, s.confidence,
      s.matched_title, s.matched_artist, s.matched_isrc, s.scanned_media_url,
      s.acknowledgement, s.claim_basis, s.claim_grantor, s.claim_scope,
      s.claim_territory, s.claim_term, s.claim_reference, s.claim_note,
      case
        when s.claim_reference is null or s.matched_isrc is null then null
        else upper(regexp_replace(s.claim_reference, '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(s.matched_isrc,   '[^A-Za-z0-9]', '', 'g'))
      end,
      s.accepted_responsibility,
      s.granted_streaming_licence,
      coalesce((select count(*) from public.posts po
                 where po.track_id = s.track_id and po.kind = 'upload'), 0),
      coalesce((select count(*) from public.posts po
                 where po.track_id = s.track_id and po.kind = 'repost'), 0),
      t.taken_down_at,
      coalesce((
        select count(*) from public.tracks ot
         where ot.uploader_id = t.uploader_id and ot.taken_down_at is not null
      ), 0),
      s.acknowledged_at, s.created_at
    from public.track_copyright_scans s
    left join public.tracks t   on t.id = s.track_id
    left join public.profiles p on p.id = t.uploader_id
    where s.match_found is true
      and (p_include_answered or s.acknowledgement is null)
    order by s.created_at desc
    limit 500;
end;
$$;

-- `drop function` discards the comment, and this repo fingerprints them.
comment on function public.ops_copyright_scans(boolean) is
  'Operator view of uploads that matched a known recording, with the uploader''s rights '
  'declaration and how much is currently serving. Returns empty for a non-ops caller '
  'rather than raising.';

revoke all on function public.ops_copyright_scans(boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean) from anon;
grant execute on function public.ops_copyright_scans(boolean) to authenticated;

do $verify$
begin
  if has_function_privilege('anon', 'public.ops_copyright_scans(boolean)', 'execute') then
    raise exception 'VERIFY: anon can execute ops_copyright_scans';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ops_copyright_scans'
      and p.prosecdef and pg_get_functiondef(p.oid) like '%is_ops()%'
  ) then
    raise exception 'VERIFY: ops_copyright_scans is not definer, or no longer calls is_ops()';
  end if;
end
$verify$;
