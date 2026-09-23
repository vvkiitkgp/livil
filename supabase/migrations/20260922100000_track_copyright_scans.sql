-- ============================================================================
-- track_copyright_scans — what a recognition provider said, and what the
-- uploader said back
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- Livil hosts uploads from creators. The failure mode worth spending money to reduce is
-- narrow and specific: a LISTENER downloads a commercial recording and posts it as their
-- own. A cover of that same song, performed by the uploader, is a welcome first-class
-- upload and must sail through untouched.
--
-- Audio fingerprinting is well matched to exactly that shape. It matches a SPECIFIC
-- MASTER RECORDING, so a commercial rip matches and a cover does not. The blindness to
-- covers that makes fingerprinting a poor general-purpose infringement detector is the
-- property that makes it the right tool here.
--
-- ── WHAT THIS TABLE IS NOT ──────────────────────────────────────────────────
--
-- A match is NOT a finding of infringement, and this schema must never be read as one.
-- No recognition provider on the market returns whether an uploader is AUTHORISED to
-- post a recording -- that is a contract between an artist and a rights holder and it is
-- in nobody's database. Every provider returns, at most, "this audio matches registered
-- recording X". The column is therefore `match_found`, never `infringing`.
--
-- The pair of facts this table exists to hold is:
--   1. what the provider said                 (provider_*, match_found, matched_*)
--   2. what the uploader said when told       (acknowledgement, acknowledged_at)
--
-- (2) is the half with evidential value. "We detected a match, told them, and they
-- confirmed ownership on this date" is a materially different position from silence.
--
-- ── WHY SECTION 0 FREEZES A TRACK'S MEDIA, AND WHY IT SHIPS HERE ────────────
--
-- A SECURITY REVIEW OF THE FIRST DRAFT OF THIS MIGRATION KILLED ITS CENTRAL CLAIM, and
-- section 0 is the repair. The draft argued that a verdict no client may WRITE cannot be
-- forged. That is necessary and not sufficient: the client also chooses WHAT GETS
-- SCANNED, and the draft recorded nothing about what was scanned.
--
--   `tracks_update_own` (baseline, :296) is
--     `using (uploader_id = auth.uid()) with check (uploader_id = auth.uid())`
--   and VERIFIED: there is no trigger on public.tracks anywhere in this repository.
--   A policy constrains WHICH ROWS, NEVER WHICH COLUMNS -- the exact sentence
--   20260804030000_freeze_post_track_id.sql was written to answer for `posts`.
--
-- So without section 0 the attack is three ordinary PostgREST calls, needing only the
-- published anon key and the attacker's own session:
--
--   PATCH /tracks  audio_url -> some harmless file
--   POST  /functions/v1/scan-upload        -> genuine provider verdict: no match
--   PATCH /tracks  audio_url -> the commercial rip
--
-- The upload now carries a real, provider-issued clean bill of health for a file the
-- provider never heard. Section 0 makes the media immutable once it is real, and
-- `scanned_media_url` records what was actually examined. A verdict that cannot be tied
-- to a file is not evidence, which is this header's own argument turned on itself.
--
-- ── STATUS IS NOT A BOOLEAN, AND THIS IS THE LOAD-BEARING LINE ──────────────
--
-- `status` and `match_found` are separate columns on purpose. A scan that never ran,
-- timed out, or errored must NEVER be indistinguishable from a scan that ran and found
-- nothing. Collapsing them would mean every provider outage silently manufactured a
-- clean bill of health for every upload during it -- the worst property this table could
-- have, because it fails silently and in the safe-looking direction.
--
--   status='failed'   + match_found=null   -> we do not know
--   status='complete' + match_found=false  -> we asked, and nothing matched
--
-- ── WHO MAY WRITE WHAT ──────────────────────────────────────────────────────
--
-- The provider half is written ONLY by the `scan-upload` edge function. There is
-- deliberately no INSERT policy for any client role: a scan result the uploader could
-- write is not evidence of anything, since the uploader is precisely the party whose
-- interest it may cut against.
--
--   TENSION WITH ADR-0008 §4, STATED PLAINLY RATHER THAN GLOSSED. That ADR says
--   "nothing may hold a service_role key". The edge function needs privilege to write a
--   row no client may write, and supabase/functions/send-push/app.ts already reads
--   SUPABASE_SERVICE_ROLE_KEY today. The security review ruled the KIND of privilege
--   justified and the BREADTH unjustified: the narrow design is a dedicated role granted
--   insert/update on this one table. That narrowing is NOT done here and is recorded as
--   debt rather than inherited by precedent.
--
-- The acknowledgement half IS written by the uploader, because it is the uploader's own
-- statement and its value depends on being attributable to them. Section 4 constrains
-- that write so it cannot reach the provider's half: an UPDATE policy alone would let a
-- client flip `match_found`, which is the same forgery by a different door.
--
-- ── ON DELETION ─────────────────────────────────────────────────────────────
--
-- Everything here CASCADES, and `acknowledged_by` cascades too rather than nulling.
-- SET NULL would be performed as an UPDATE, the section 4 trigger would veto it, AND
-- `track_copyright_scans_ack_shape` would reject the half-null result -- so the parent
-- DELETE would abort and ACCOUNT DELETION WOULD BREAK, nondeterministically, depending
-- on which referential action Postgres ran first. The first draft of this file warned
-- about exactly that interaction for a different table and then walked into it.
--
-- Lifetimes make cascade correct anyway: `acknowledged_by` is always the track's
-- uploader (section 4 pins it), and the row already dies with the track.

-- ── 0. A track's media is frozen once it is real ────────────────────────────
--
-- Same shape as posts_freeze_counter_identity (20260804030000). The ONE permitted
-- transition is the placeholder written by `createTrack`/`publishTrack` becoming the
-- final URL; after that the media is the track's identity and cannot change.
--
-- VERIFIED SAFE FOR EVERY EXISTING FLOW: `editTrack.ts` updates only title,
-- description, tags, cover_art_url, thumbnail_url, lyrics and lyrics_format. Nothing in
-- either client rewrites audio_url or video_url after publish. Cover art stays freely
-- editable -- it is not what gets scanned.
create or replace function public.tracks_freeze_media()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  placeholder constant text := 'pending://placeholder';
begin
  -- Unchanged is always fine, and is the common case (a title edit rewrites the row).
  if new.audio_url is not distinct from old.audio_url
     and new.video_url is not distinct from old.video_url then
    return new;
  end if;

  -- The one legal transition: placeholder -> a real URL, once.
  if old.audio_url is distinct from new.audio_url
     and not (old.audio_url = placeholder and new.audio_url is not null
              and new.audio_url <> placeholder) then
    raise exception 'tracks.audio_url is immutable once set'
      using errcode = '42501';
  end if;

  if old.video_url is distinct from new.video_url
     and not (old.video_url = placeholder and new.video_url is not null
              and new.video_url <> placeholder) then
    raise exception 'tracks.video_url is immutable once set'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.tracks_freeze_media() is
  'A track''s media URL is its identity. Without this the uploader can obtain a clean '
  'copyright verdict for one file and then swap in another.';

drop trigger if exists trg_tracks_freeze_media on public.tracks;
create trigger trg_tracks_freeze_media
  BEFORE UPDATE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_freeze_media();

-- ── 1. The table ────────────────────────────────────────────────────────────
create table if not exists public.track_copyright_scans (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,

  -- Which vendor answered. Free text rather than an enum: the whole point of the
  -- adapter is that the vendor is replaceable, and a check constraint would turn "try a
  -- second provider" into a migration.
  provider text not null,
  -- The vendor's own id for this scan, where it issues one.
  provider_scan_id text,

  -- WHAT WAS ACTUALLY EXAMINED. Not decoration: without it the row means "the
  -- provider's answer about whatever audio_url pointed at, at an unrecorded moment".
  -- Section 0 keeps this equal to the track's media; this column is what lets anyone
  -- check that later.
  scanned_media_url text not null,

  status text not null check (status in ('complete', 'failed', 'skipped')),

  -- NULL unless status='complete'. See the header: "we do not know" and "nothing
  -- matched" are different answers and must stay different.
  match_found boolean,

  -- Vendor-reported, vendor-scaled, and NOT comparable across vendors. Stored for a
  -- human reading one row, never for a threshold in a query.
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- The three fields every vendor returns, promoted to columns because the warning copy
  -- interpolates them and a jsonb path in a UI string is how that breaks quietly.
  matched_title  text,
  matched_artist text,
  matched_isrc   text,
  -- Everything else the vendor said, verbatim. Deliberately opaque: the moment a
  -- vendor-specific field becomes a column, swapping vendors becomes a migration.
  matched_metadata jsonb,

  -- ── the uploader's half ──
  -- 'owner'      -- "this is my own recording"
  -- 'permission' -- "I have permission or a licence to post this"
  -- 'cancelled'  -- reserved; a cancelled upload deletes its track, so the row cascades
  acknowledgement text check (acknowledgement in ('owner', 'permission', 'cancelled')),
  acknowledged_at timestamptz,
  -- CASCADE, not SET NULL. See the header -- SET NULL breaks account deletion.
  acknowledged_by uuid references public.profiles(id) on delete cascade,

  created_at   timestamptz not null default now(),
  completed_at timestamptz,

  -- The three acknowledgement columns move together or not at all.
  constraint track_copyright_scans_ack_shape check (
    (acknowledgement is null and acknowledged_at is null and acknowledged_by is null)
    or (acknowledgement is not null and acknowledged_at is not null and acknowledged_by is not null)
  ),
  -- See the header. This pair is what keeps an outage from looking clean.
  constraint track_copyright_scans_match_requires_complete check (
    match_found is null or status = 'complete'
  ),
  constraint track_copyright_scans_complete_has_verdict check (
    status <> 'complete' or match_found is not null
  )
);

comment on table public.track_copyright_scans is
  'What a recognition provider said about an upload, and what the uploader said back. '
  'A match is a prompt to ask a question, never a finding of infringement.';

comment on column public.track_copyright_scans.match_found is
  'NULL unless status=complete. NULL means we do not know; false means we asked and '
  'nothing matched. Never collapse these.';

comment on column public.track_copyright_scans.scanned_media_url is
  'The URL actually handed to the provider. A verdict that cannot be tied to a file is '
  'not evidence.';

-- ── 2. Indexes ──────────────────────────────────────────────────────────────

-- Idempotency. A retried call or a duplicate provider callback must update the existing
-- row, not add a second verdict for the same track from the same vendor.
create unique index if not exists track_copyright_scans_track_provider_uq
  on public.track_copyright_scans (track_id, provider);

create index if not exists track_copyright_scans_track_idx
  on public.track_copyright_scans (track_id);

-- The operator's queue: matches nobody has answered yet. Partial, because that set is
-- small and is the only one anyone lists.
create index if not exists track_copyright_scans_open_matches_idx
  on public.track_copyright_scans (created_at desc)
  where match_found is true and acknowledgement is null;

-- ── 3. Row level security ───────────────────────────────────────────────────
alter table public.track_copyright_scans enable row level security;

-- Read: the uploader of the scanned track, and nobody else. Scoped through `tracks`
-- rather than duplicating an uploader_id column, so there is one answer to "who owns
-- this" and it cannot drift.
--
-- Operators read through the SECURITY DEFINER function in section 5, not through this
-- policy, on the same reasoning as ops_reports_overview: definer rights bypass RLS, so
-- the gate belongs in the body.
drop policy if exists track_copyright_scans_select_own on public.track_copyright_scans;
create policy track_copyright_scans_select_own
  on public.track_copyright_scans for select
  to authenticated
  using (
    exists (
      select 1 from public.tracks t
      where t.id = track_copyright_scans.track_id
        and t.uploader_id = (select auth.uid())
    )
  );

-- NO INSERT POLICY, AND NO DELETE POLICY, FOR ANY CLIENT ROLE. Not an oversight: with
-- RLS enabled and no policy for a command, that command is denied to every client. The
-- provider's verdict is written by the edge function or it is written by nobody.

drop policy if exists track_copyright_scans_acknowledge_own on public.track_copyright_scans;
create policy track_copyright_scans_acknowledge_own
  on public.track_copyright_scans for update
  to authenticated
  using (
    exists (
      select 1 from public.tracks t
      where t.id = track_copyright_scans.track_id
        and t.uploader_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.tracks t
      where t.id = track_copyright_scans.track_id
        and t.uploader_id = (select auth.uid())
    )
  );

-- ── 4. The uploader may answer, not rewrite ─────────────────────────────────
--
-- An UPDATE policy scoped to the owner still permits `set match_found = false`. A policy
-- cannot express "these columns only", so a trigger must.
--
-- SECURITY INVOKER, deliberately. The body reads no tables; it calls auth.uid(),
-- auth.role(), now() and raise. Definer rights would buy nothing and cost the usual
-- (Constitution P17). Contrast posts_freeze_counter_identity, which IS correctly definer
-- because its carve-out queries `posts` and must see rows RLS would hide.
--
-- The allowed set is expressed as an ALLOWLIST over jsonb rather than a column-by-column
-- denylist. The first draft used a denylist and had already drifted before shipping: it
-- omitted `id`, and every future ALTER TABLE ... ADD COLUMN would have been silently
-- writable by the uploader. Inverted, a new column is denied by default.
create or replace function public.track_copyright_scans_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  -- The privileged writer, named rather than inferred. The first draft tested
  -- `auth.uid() is null` and reasoned "therefore the edge function" -- an inference made
  -- by a policy in another section, which any future policy could silently falsify.
  if auth.role() = 'service_role' then
    -- Even the writer may not quietly downgrade a match. Media is frozen by section 0,
    -- so a re-scan examines the same bytes; a later "no match" over an earlier match is
    -- a provider disagreeing with itself, not new information, and must not erase the
    -- stronger answer.
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

  if to_jsonb(new) - 'acknowledgement' - 'acknowledged_at' - 'acknowledged_by'
     is distinct from
     to_jsonb(old) - 'acknowledgement' - 'acknowledged_at' - 'acknowledged_by'
  then
    raise exception 'only the acknowledgement may be set by the uploader'
      using errcode = '42501';
  end if;

  -- Server-authoritative. `default now()` applies only when a column is OMITTED, and
  -- PostgREST will happily write a client-supplied value -- so without this the "when"
  -- and the "who" of an acknowledgement would be asserted by the device and verified by
  -- nothing.
  new.acknowledged_at := now();
  new.acknowledged_by := (select auth.uid());
  return new;
end;
$function$;

drop trigger if exists trg_track_copyright_scans_guard on public.track_copyright_scans;
create trigger trg_track_copyright_scans_guard
  BEFORE UPDATE ON public.track_copyright_scans
  FOR EACH ROW EXECUTE FUNCTION public.track_copyright_scans_guard_update();

-- ── 5. The operator's read ──────────────────────────────────────────────────
--
-- Same posture as ops_reports_overview() / ops_tracks_for_user(): SECURITY DEFINER
-- because the table has no operator SELECT policy, gated on is_ops() INSIDE the body
-- because definer rights bypass RLS, and returning EMPTY rather than raising for a
-- non-ops caller so /studio/ops needs no route guard.
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
      s.id,
      s.track_id,
      coalesce(t.title, '(track unavailable)')::text,
      t.uploader_id,
      p.username,
      t.media_kind,
      s.provider,
      s.status,
      s.match_found,
      s.confidence,
      s.matched_title,
      s.matched_artist,
      s.matched_isrc,
      s.scanned_media_url,
      s.acknowledgement,
      s.acknowledged_at,
      s.created_at
    from public.track_copyright_scans s
    left join public.tracks t   on t.id = s.track_id
    left join public.profiles p on p.id = t.uploader_id
    where s.match_found is true
      and (p_include_answered or s.acknowledgement is null)
    order by s.created_at desc
    limit 500;
end;
$$;

comment on function public.ops_copyright_scans(boolean) is
  'Operator view of uploads that matched a known recording. Returns empty for a '
  'non-ops caller rather than raising, so the route needs no guard.';

revoke all on function public.ops_copyright_scans(boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean) from anon;
grant execute on function public.ops_copyright_scans(boolean) to authenticated;

revoke all on function public.track_copyright_scans_guard_update() from public;
revoke all on function public.tracks_freeze_media() from public;

-- ── 6. Verify what this migration claims ────────────────────────────────────
--
-- Both precedents this file follows ship one (20260808120000 asserts provolatile;
-- 20260919010000 asserts anon cannot execute, prosecdef, and that is_ops() is still in
-- the body). Without it a typo is caught in production, by nobody -- and this file has
-- never been executed anywhere.
do $verify$
begin
  if not exists (
    select 1 from pg_class where relname = 'track_copyright_scans' and relrowsecurity
  ) then
    raise exception 'VERIFY: row level security is not enabled on track_copyright_scans';
  end if;

  -- The central claim. If either of these ever exists, a client can author a verdict.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'track_copyright_scans'
      and cmd in ('INSERT', 'DELETE')
  ) then
    raise exception 'VERIFY: track_copyright_scans must have no INSERT or DELETE policy';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_track_copyright_scans_guard' and not tgisinternal
  ) then
    raise exception 'VERIFY: the acknowledgement guard trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_tracks_freeze_media' and not tgisinternal
  ) then
    raise exception 'VERIFY: the tracks media freeze trigger is missing';
  end if;

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

  -- The guard must NOT be definer. See section 4.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'track_copyright_scans_guard_update'
      and p.prosecdef
  ) then
    raise exception 'VERIFY: the acknowledgement guard must be SECURITY INVOKER';
  end if;
end
$verify$;
