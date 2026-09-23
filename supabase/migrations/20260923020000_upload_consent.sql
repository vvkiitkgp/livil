-- ============================================================================
-- Two things the uploader has to actually tick
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- The declaration form carried the sentence "You are responsible for what you upload to
-- Livil" as DISPLAY TEXT. Nobody agrees to a sentence they merely walked past, and
-- nothing recorded that they had seen it. A statement the reader cannot decline is not a
-- statement they accepted.
--
-- So it becomes a box they tick, and a second box joins it:
--
--   accepted_responsibility     -- I am responsible for what I upload
--   granted_streaming_licence   -- I grant Livil permission to stream this recording
--
-- ── WHY THE STREAMING GRANT IS WORTH ASKING TWICE ──────────────────────────
--
-- `docs/terms.html` §2 already takes a worldwide, non-exclusive, royalty-free licence to
-- host, store, reproduce and stream anything uploaded, and every account accepted it at
-- signup. So this is not a new right — it is a per-upload reaffirmation of an existing
-- one, on the subset of uploads where it is most likely to be disputed.
--
-- That distinction matters when someone eventually reads this table. "They agreed to the
-- terms two years ago" and "they confirmed, on this track, on this date, that they were
-- granting us the right to stream it" are different strengths of evidence, and the second
-- is the one worth having on a track that matched a commercial master.
--
-- ── SCOPE, STATED HONESTLY ─────────────────────────────────────────────────
--
-- THIS ONLY COVERS UPLOADS THAT MATCHED. An upload that matches nothing never sees the
-- form, so it never records either box. Extending a per-upload confirmation to EVERY
-- upload is a different piece of work: it belongs in `terms_acceptances` with
-- `source='upload'` and a `track_id`, which ADR-0017 §I already designed and which is
-- still waiting on counsel. Do not read this migration as having delivered that.
--
-- ── NOT VALID, AGAIN ───────────────────────────────────────────────────────
--
-- Every answered row that exists today predates both boxes, so a validating constraint
-- would refuse to apply. The rule binds everything from here; the older rows keep what
-- was actually asked of them, which is nothing.

alter table public.track_copyright_scans
  add column if not exists accepted_responsibility   boolean,
  add column if not exists granted_streaming_licence boolean;

comment on column public.track_copyright_scans.granted_streaming_licence is
  'Per-upload reaffirmation of the licence Terms §2 already takes at signup. Asked again '
  'here because this track matched a commercial recording.';

comment on column public.track_copyright_scans.accepted_responsibility is
  'Ticked, not merely displayed. A sentence the reader cannot decline is not one they '
  'accepted.';

-- Both boxes, or no answer. `cancelled` is exempt: somebody backing out of an upload is
-- not being asked to grant anything.
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_consent_required;

alter table public.track_copyright_scans
  add constraint track_copyright_scans_consent_required check (
    acknowledgement is null
    or acknowledgement = 'cancelled'
    or (accepted_responsibility is true and granted_streaming_licence is true)
  ) not valid;

-- The guard's allowlist is deny-by-default, so two new columns are two columns the
-- uploader cannot write until they are named here. That is the design working — and it
-- is also why adding a column to this table is never just an ALTER.
create or replace function public.track_copyright_scans_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if auth.role() = 'service_role' then
    if old.match_found is true and new.match_found is not true then
      raise exception 'a recorded match cannot be downgraded by a later scan'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.acknowledgement is not null then
    raise exception 'this scan has already been answered'
      using errcode = '42501';
  end if;

  if to_jsonb(new)
       - 'acknowledgement' - 'acknowledged_at' - 'acknowledged_by'
       - 'claim_basis' - 'claim_grantor' - 'claim_scope' - 'claim_territory'
       - 'claim_term' - 'claim_reference' - 'claim_note'
       - 'accepted_responsibility' - 'granted_streaming_licence'
     is distinct from
     to_jsonb(old)
       - 'acknowledgement' - 'acknowledged_at' - 'acknowledged_by'
       - 'claim_basis' - 'claim_grantor' - 'claim_scope' - 'claim_territory'
       - 'claim_term' - 'claim_reference' - 'claim_note'
       - 'accepted_responsibility' - 'granted_streaming_licence'
  then
    raise exception 'only the rights declaration may be set by the uploader'
      using errcode = '42501';
  end if;

  new.acknowledged_at := now();
  new.acknowledged_by := (select auth.uid());
  return new;
end;
$function$;

revoke all on function public.track_copyright_scans_guard_update() from public;

-- The operator sees both boxes. A claim made without them would be a row the constraint
-- refuses, so in practice this reads "yes/yes" — which is exactly why its ABSENCE on an
-- older row should be visible rather than silently rendered as a tick.
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

revoke all on function public.ops_copyright_scans(boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean) from anon;
grant execute on function public.ops_copyright_scans(boolean) to authenticated;

do $verify$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'track_copyright_scans_consent_required'
  ) then
    raise exception 'VERIFY: the consent constraint is missing — a claim could be made without ticking either box';
  end if;

  -- The allowlist must name the new columns, or the uploader cannot write what the
  -- constraint now requires and every submission fails with an opaque permission error.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'track_copyright_scans_guard_update'
      and pg_get_functiondef(p.oid) like '%granted_streaming_licence%'
  ) then
    raise exception 'VERIFY: the guard allowlist does not admit the consent columns';
  end if;
end
$verify$;
