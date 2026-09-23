-- ============================================================================
-- The streaming grant, on EVERY upload — not just the ones that matched
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- 20260923020000 put two tick-boxes on the copyright form. That form only appears when a
-- scan MATCHES, so the grant was recorded on a handful of tracks and missed on every
-- other upload — which is nearly all of them. A consent captured on the exception and not
-- on the rule is not a consent policy.
--
-- This is the `source='upload'` row that `20260907000000_terms_acceptance_log.sql`
-- reserved. Its header named the exact preconditions:
--
--   "Add the value, a track_id, and a (user_id, version, track_id) index together, and
--    rule explicitly then on whether deleting a track should destroy its ownership
--    confirmation."
--
-- All three are here, and the ruling is below.
--
-- ── RULING: DELETING A TRACK MUST NOT DESTROY ITS ATTESTATION ──────────────
--
-- ADR-0017 §I.2 ruled the same way and chose `ON DELETE SET NULL` as the mechanism.
-- ADR-0019 then proved by execution that the mechanism cannot work: SET NULL is performed
-- as an UPDATE, this table's append-only trigger vetoes every UPDATE, and the parent
-- DELETE aborts — so artists could never delete their own tracks. Intent upheld,
-- mechanism struck.
--
-- CASCADE is the other obvious candidate and is worse: it destroys the attestation at the
-- exact moment somebody is most motivated to destroy it — upload, complaint arrives,
-- delete track.
--
-- So: **no foreign key at all.** A plain uuid. The same conclusion the moderation ledger
-- reached one migration earlier, for the same reason — an evidential record should point
-- at ids that may no longer resolve. That is what makes it a record rather than a view.
-- The row still dies with the ACCOUNT (user_id cascades), which is the published deletion
-- promise; it simply outlives the track.
--
-- ── THE HOLE THE BOARD NAMED, CLOSED HERE ──────────────────────────────────
--
-- `terms_acceptances_pin_server_fields` pins `accepted_at` and `user_id` but cannot pin a
-- `track_id` — the server has no way to know which track was meant. Left unguarded, a
-- client could log a confirmation naming a track it does not own, which would make the
-- record worse than absent. Section 3 requires the track to belong to the caller.

-- ── 1. Admit the value and the column ───────────────────────────────────────
alter table public.terms_acceptances
  -- NO FOREIGN KEY. See the header. Do not add one later: SET NULL aborts the parent
  -- delete against the append-only trigger, and CASCADE erases the evidence.
  add column if not exists track_id uuid;

comment on column public.terms_acceptances.track_id is
  'Which upload this confirmation was given for. Plain uuid, deliberately: the record '
  'must outlive the track it describes.';

alter table public.terms_acceptances
  drop constraint if exists terms_acceptances_source_check;

alter table public.terms_acceptances
  add constraint terms_acceptances_source_check
  check (source in ('signup', 'reaccept', 'upload'));

-- Shape: an upload row names a track, the other two do not. Without this, 'upload' rows
-- with a null track_id would be unbounded — exactly the objection the original header
-- raised against admitting the value early.
alter table public.terms_acceptances
  drop constraint if exists terms_acceptances_upload_shape;

alter table public.terms_acceptances
  add constraint terms_acceptances_upload_shape check (
    (source = 'upload' and track_id is not null)
    or (source in ('signup', 'reaccept') and track_id is null)
  ) not valid;

-- ── 2. One confirmation per track ───────────────────────────────────────────
-- The existing index is scoped `where source in ('signup','reaccept')`, so it excludes
-- these rows untouched — no applied migration is edited. This is its counterpart: a retry
-- or a double tap writes one row, not two.
create unique index if not exists terms_acceptances_one_per_upload
  on public.terms_acceptances (user_id, version, track_id)
  where source = 'upload';

-- ── 3. You may only confirm your OWN upload ─────────────────────────────────
--
-- SECURITY DEFINER because it must see the track regardless of the caller's own
-- visibility: `tracks_select_authenticated` hides rows across a block, and a hidden track
-- would read as "not yours" — failing closed here, but for a reason that has nothing to
-- do with ownership. Reads one table, no dynamic SQL, search_path pinned.
create or replace function public.terms_acceptances_verify_track()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.source <> 'upload' then
    return new;
  end if;

  if not exists (
    select 1 from public.tracks
     where id = new.track_id and uploader_id = new.user_id
  ) then
    raise exception 'an upload confirmation must name your own track'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- AFTER the pin trigger, so `new.user_id` is already the real caller rather than whatever
-- the client sent. BEFORE-row triggers fire in alphabetical order by trigger name:
-- `trg_terms_acceptances_pin` < `trg_terms_acceptances_verify`, so the ordering holds by
-- name rather than by luck. Renaming either one breaks this — do not.
drop trigger if exists trg_terms_acceptances_verify on public.terms_acceptances;
create trigger trg_terms_acceptances_verify
  BEFORE INSERT ON public.terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.terms_acceptances_verify_track();

revoke all on function public.terms_acceptances_verify_track() from public;

-- ── 4. What an operator can see ─────────────────────────────────────────────
-- Not a new read of the table — `terms_acceptances_select_own` still scopes clients to
-- their own rows, and nobody enumerates who agreed to what. This answers one question
-- about one track, for an operator deciding whether to take it down.
create or replace function public.ops_upload_consent(p_track_id uuid)
returns table (
  version     text,
  accepted_at timestamptz,
  app_version text
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
    select a.version, a.accepted_at, a.app_version
      from public.terms_acceptances a
     where a.track_id = p_track_id and a.source = 'upload'
     order by a.accepted_at desc;
end;
$$;

revoke all on function public.ops_upload_consent(uuid) from public;
revoke execute on function public.ops_upload_consent(uuid) from anon;
grant execute on function public.ops_upload_consent(uuid) to authenticated;

-- ── 5. Verify ───────────────────────────────────────────────────────────────
do $verify$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.terms_acceptances'::regclass and c.contype = 'f'
      and a.attname = 'track_id'
  ) then
    raise exception 'VERIFY: terms_acceptances.track_id must carry no foreign key — see the header';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_terms_acceptances_verify' and not tgisinternal
  ) then
    raise exception 'VERIFY: a client could confirm a track it does not own';
  end if;

  -- The append-only guarantee is what makes any of this evidence. If a later migration
  -- ever drops it, this record becomes a claim rather than a record.
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_terms_acceptances_no_update' and not tgisinternal
  ) then
    raise exception 'VERIFY: terms_acceptances is no longer append-only';
  end if;

  if has_function_privilege('anon', 'public.ops_upload_consent(uuid)', 'execute') then
    raise exception 'VERIFY: anon can execute ops_upload_consent';
  end if;
end
$verify$;
