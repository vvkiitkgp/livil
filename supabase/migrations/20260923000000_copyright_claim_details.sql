-- ============================================================================
-- The rights declaration — turning a click into a claim somebody can assess
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- 20260922100000 shipped a single `acknowledgement` with three values, and the first
-- real test found the flaw immediately: clicking "I have permission" published the track
-- and recorded nothing a reviewer could act on. A claim with no substance is not a
-- record, it is a checkbox.
--
-- ── THE FOUR ANSWERS, AND WHY THE FOURTH IS THE IMPORTANT ONE ───────────────
--
--   self_recorded -- I made this recording myself. A cover counts: the RECORDING is mine
--                    even though the composition is not.
--   owner         -- I hold the rights but did not make it (assigned, or my company owns it)
--   permission    -- Somebody else owns it and licensed or authorised me
--   disputed      -- I think this match is wrong
--
-- SPLIT BY HOW THE RIGHTS WERE OBTAINED, not by wording. A first draft offered "I own
-- this recording" AND "this is my own recording", which overlap completely — if you made
-- it, both are true — and its ownership follow-up then offered "I created and recorded
-- it", which simply WAS the other option. Two paths, one answer, and a reviewer unable to
-- tell which fact was being asserted.
--
-- Recast this way the four are genuinely exclusive: made it / own it without making it /
-- licensed / wrong. It also puts the most common legitimate case — a local creator
-- posting their own song or cover — on the shortest path, which is where friction hurts
-- most and helps least.
--
-- `disputed` was missing and its absence was a real defect. Fingerprinting produces
-- false positives on covers, remixes, live takes, sampled material and thin regional
-- catalogue coverage. Without this option a creator whose OWN work was wrongly matched
-- had two choices: abandon a legitimate upload, or click a claim that was not quite
-- true. Both are bad, and the second silently poisons the evidential value of every
-- other row in this table.
--
-- It is also free signal about the PROVIDER. A rising count here means the catalogue is
-- mismatching, and we learn it from our own data rather than from a public complaint.
--
-- ── IDENTIFICATION IS NOT EVIDENCE OF RIGHTS ────────────────────────────────
--
-- `claim_reference` (ISRC, UPC, catalogue number) is deliberately separate from every
-- other column here and is NEVER to be read as proof. An ISRC names a RECORDING; it says
-- nothing about who may distribute it, and for any charting track it is public — findable
-- on Spotify or MusicBrainz in seconds.
--
-- It earns its place for two narrow reasons: a genuine licensee has it on their
-- paperwork while somebody who downloaded an mp3 has never heard of it, and it can be
-- compared against `matched_isrc` to see whether the claimant is even talking about the
-- same recording we matched. It is friction and a cross-check, not a credential.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
--
-- IT DOES NOT GATE PUBLICATION. A declaration is recorded and the track publishes.
-- ADR-0017 §D settles why: both clients write straight to PostgREST, an insert-time
-- check runs once and cannot retroactively unpublish, and hiding a row instead would
-- mean hand-copying the condition into every SECURITY DEFINER function that reads posts
-- — including the one granted to `anon` for public share links. The reachable design is
-- publish, flag, and remove; the removal half does not exist yet and this migration does
-- not pretend otherwise.
--
-- IT ALSO ACCEPTS NO DOCUMENTS. Text only, by design: Livil has never issued a signed
-- URL, CI cannot verify a bucket is private, no scheduler exists to enforce retention,
-- and storage objects do not cascade on account deletion — so an uploaded contract or ID
-- would outlive the account that supplied it. Document categories are designed and
-- deferred; see the follow-up note at the end of this file.
--
-- ── VALIDATION LIVES HERE, NOT IN THE FORM ──────────────────────────────────
--
-- Two clients write this table through PostgREST, so a required field enforced only in a
-- form is a required field on one of them at best. The check constraints below are what
-- actually make "you said permission, so name who granted it" true.

-- ── 1. The columns ──────────────────────────────────────────────────────────
alter table public.track_copyright_scans
  -- OWNER path: how the rights reached someone who did not make the recording. There is
  -- deliberately no 'created' value — "I made it" is its own top-level answer
  -- (`self_recorded`), and offering it here too was the overlap described above.
  add column if not exists claim_basis text
    check (claim_basis is null or claim_basis in ('assigned', 'company', 'other')),

  -- PERMISSION path. Who granted it, and what the grant actually covers.
  add column if not exists claim_grantor text
    check (claim_grantor is null or char_length(claim_grantor) between 1 and 200),
  -- A licence that does not cover streaming on a user-generated-content platform is
  -- worthless to Livil, and asking directly surfaces that without anyone reading a
  -- contract. Array rather than booleans so a new scope is data, not a migration.
  add column if not exists claim_scope text[],
  add column if not exists claim_territory text
    check (claim_territory is null or char_length(claim_territory) <= 200),
  add column if not exists claim_term text
    check (claim_term is null or char_length(claim_term) <= 200),

  -- IDENTIFICATION. See the header: not evidence.
  add column if not exists claim_reference text
    check (claim_reference is null or char_length(claim_reference) <= 120),

  -- Anything the fields above could not hold. Also the only field a `disputed` claim
  -- usually carries — "this is my own song, I think the match is wrong".
  add column if not exists claim_note text
    check (claim_note is null or char_length(claim_note) <= 2000);

comment on column public.track_copyright_scans.claim_reference is
  'ISRC/UPC/catalogue number as supplied by the claimant. IDENTIFICATION ONLY — it names '
  'a recording and says nothing about who may distribute it. Never treat as proof.';

comment on column public.track_copyright_scans.claim_scope is
  'What the claimed licence covers. A grant that excludes streaming or UGC does not '
  'authorise the upload, which is the point of asking.';

-- ── 2. The four answers ─────────────────────────────────────────────────────
-- The old constraint permitted three values. Dropped and replaced rather than added to,
-- because a CHECK cannot be widened in place.
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_acknowledgement_check;

alter table public.track_copyright_scans
  add constraint track_copyright_scans_acknowledgement_check
  check (acknowledgement is null or acknowledgement in
    ('owner', 'permission', 'self_recorded', 'disputed', 'cancelled'));

-- ── 3. The shape of each claim ──────────────────────────────────────────────
--
-- Required fields, enforced where both clients must obey them. Note what is NOT
-- required: `self_recorded` and `disputed` ask for nothing at all. A bedroom artist with
-- no label, no registration, no distributor and no ISRC can still legitimately own their
-- recording, and demanding paperwork from them would block exactly the people Livil
-- exists for while stopping nobody who is determined.
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_claim_shape;

-- NOT VALID, and this is a deliberate choice rather than a shortcut.
--
-- VERIFIED IN PRODUCTION BEFORE WRITING THIS: three rows already carry a bare
-- acknowledgement recorded under the previous three-value schema -- one `owner` with no
-- basis, two `permission` with neither grantor nor scope. A plain ADD CONSTRAINT scans
-- the table and THIS MIGRATION WOULD SIMPLY FAIL TO APPLY.
--
-- NOT VALID enforces the rule on every INSERT and UPDATE from this moment while leaving
-- those rows untouched, which is the honest outcome: they record what was actually asked
-- at the time, and rewriting them to satisfy a rule invented afterwards would be
-- fabricating claims nobody made. Do NOT run `VALIDATE CONSTRAINT` later without first
-- deciding what to do with them.
alter table public.track_copyright_scans
  add constraint track_copyright_scans_claim_shape check (
    acknowledgement is null
    or (acknowledgement = 'owner' and claim_basis is not null)
    or (acknowledgement = 'permission'
        and claim_grantor is not null
        and claim_scope is not null
        and array_length(claim_scope, 1) >= 1)
    or acknowledgement in ('self_recorded', 'disputed', 'cancelled')
  ) not valid;

-- Fields belong to their own path. Without this a row could carry a grantor on an
-- ownership claim and a basis on a licence claim, and the record would describe a
-- combination nobody ever chose (Constitution P15).
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_claim_fields_match_path;

-- NOT VALID for symmetry with the constraint above. The three legacy rows satisfy this
-- one already (every claim_* column is null on them), but the pair should behave
-- identically so that neither can be the reason a future migration refuses to apply.
alter table public.track_copyright_scans
  add constraint track_copyright_scans_claim_fields_match_path check (
    (claim_basis is null or acknowledgement = 'owner')
    and (
      (claim_grantor is null and claim_scope is null
       and claim_territory is null and claim_term is null)
      or acknowledgement = 'permission'
    )
  ) not valid;

-- ── 4. The guard must let the new fields through ────────────────────────────
--
-- The allowlist in 20260922100000 permitted exactly three columns. Adding columns
-- without extending it would leave them unwritable by the uploader — the deny-by-default
-- behaviour working as designed, which is why it has to be updated deliberately here
-- rather than discovered as a silent failure in the form.
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
     is distinct from
     to_jsonb(old)
       - 'acknowledgement' - 'acknowledged_at' - 'acknowledged_by'
       - 'claim_basis' - 'claim_grantor' - 'claim_scope' - 'claim_territory'
       - 'claim_term' - 'claim_reference' - 'claim_note'
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

-- ── 5. The operator sees the claim, not just the click ──────────────────────
--
-- `claim_reference` is returned next to `matched_isrc` on purpose: the useful question a
-- reviewer asks first is whether the claimant is even talking about the same recording.
--
-- `disputed` rows are included. They are not claims to assess so much as reports about
-- the DETECTOR, and burying them would hide the signal that the catalogue is mismatching.
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
  -- Answers "is the claimant even discussing the recording we matched?" NULL when either
  -- side is absent, which is a different answer from "no" and must stay distinguishable.
  reference_matches_isrc boolean,
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
      s.claim_basis,
      s.claim_grantor,
      s.claim_scope,
      s.claim_territory,
      s.claim_term,
      s.claim_reference,
      s.claim_note,
      case
        when s.claim_reference is null or s.matched_isrc is null then null
        else upper(regexp_replace(s.claim_reference, '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(s.matched_isrc,   '[^A-Za-z0-9]', '', 'g'))
      end,
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
  'Operator view of uploads that matched a known recording, with the uploader''s rights '
  'declaration. Returns empty for a non-ops caller rather than raising.';

revoke all on function public.ops_copyright_scans(boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean) from anon;
grant execute on function public.ops_copyright_scans(boolean) to authenticated;

-- ── 6. Verify ───────────────────────────────────────────────────────────────
do $verify$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'track_copyright_scans_claim_shape'
  ) then
    raise exception 'VERIFY: the claim shape constraint is missing — a permission claim could name nobody';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'track_copyright_scans'
      and cmd in ('INSERT', 'DELETE')
  ) then
    raise exception 'VERIFY: track_copyright_scans must still have no INSERT or DELETE policy';
  end if;

  if has_function_privilege('anon', 'public.ops_copyright_scans(boolean)', 'execute') then
    raise exception 'VERIFY: anon can execute ops_copyright_scans';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'track_copyright_scans_guard_update'
      and p.prosecdef
  ) then
    raise exception 'VERIFY: the declaration guard must be SECURITY INVOKER';
  end if;
end
$verify$;

-- ── FOLLOW-UP, recorded so it is not rediscovered ───────────────────────────
--
-- DOCUMENTS. The categories are designed and deliberately absent:
--   OWNERSHIP   copyright registration · assignment or transfer · work-for-hire ·
--               label or recording agreement · other ownership document
--   PERMISSION  licence agreement · distribution agreement · written permission from the
--               rights holder · label or distributor authorisation · other authorisation
-- Prerequisites, all currently unmet: a bucket proven private by a LIVE probe (CI's
-- storage shim declares only id/name/public and cannot assert it), a working signed-URL
-- path (Livil has zero `createSignedUrl` callers, ever), retention that is enforced
-- rather than written down, and a deletion actuator that reaches storage objects — which
-- account deletion does NOT today.
--
-- REMOVAL. Nothing here can be acted upon until an operator can take a track down.
-- `posts_delete_own` and `tracks_delete_own` are still the only DELETE policies, so a
-- reviewer can read a claim, judge it worthless, and do nothing about it.
