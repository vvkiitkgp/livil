-- ============================================================================
-- Three corrections to the rights flow, found by review before it shipped
-- ============================================================================
--
-- Each of these is a defect in a migration already applied to production. None of them
-- has been exploited (section 1 was checked against live data: zero rows), and none is
-- user-visible today. They are fixed together because they share one cause — the rights
-- record was treated as decoration around the track rather than as the thing that has to
-- outlive it.
--
--   1. The media freeze did not freeze an EMPTY media slot.
--   2. Deleting a track destroyed its own rights declaration and the provider's match.
--   3. The moderation queue counted strikes from a column the uploader can now erase.

-- ── 1. The freeze has to cover the slot that is empty ───────────────────────
--
-- `tracks_freeze_media` exists so an uploader cannot obtain a clean copyright verdict for
-- one file and then swap in another. It tested each slot like this:
--
--     not (old.audio_url = placeholder and new.audio_url is not null and ...)
--
-- On an audio track `video_url` is NULL, and `NULL = 'pending://placeholder'` is not
-- FALSE — it is NULL. `not (NULL and TRUE)` is NULL, and `if NULL then raise` does not
-- raise. So the guard silently stood down for exactly the slot it had never seen filled,
-- and the empty slot stayed writable for the life of the track.
--
-- Two things kept this from being reachable, and neither is a defence worth relying on:
-- every renderer today picks its URL by `media_kind` first, and `tracks_media_shape_check`
-- stops `media_kind` being flipped afterwards because that would require nulling the
-- frozen `audio_url`. The first is a convention that the next screen can break without
-- noticing — `JamRealtimeContext` already reads `video_url` without consulting
-- `media_kind` — and a hole that is only closed by the callers is not closed.
--
-- The rule stated positively, which is why this version is harder to get wrong: a media
-- slot may change ONLY from the upload placeholder to a real URL, once. Everything else
-- — NULL to a URL, a URL to a different URL, a URL back to NULL — is refused.
create or replace function public.tracks_freeze_media()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  placeholder constant text := 'pending://placeholder';
begin
  -- `is not distinct from` rather than `=` throughout. That is the entire fix: it is
  -- NULL-safe, so an empty slot answers FALSE like any other non-match instead of
  -- poisoning the expression into NULL and skipping the raise.
  if not (
    new.audio_url is not distinct from old.audio_url
    or (old.audio_url is not distinct from placeholder
        and new.audio_url is not null
        and new.audio_url is distinct from placeholder)
  ) then
    raise exception 'tracks.audio_url is immutable once set'
      using errcode = '42501';
  end if;

  if not (
    new.video_url is not distinct from old.video_url
    or (old.video_url is not distinct from placeholder
        and new.video_url is not null
        and new.video_url is distinct from placeholder)
  ) then
    raise exception 'tracks.video_url is immutable once set'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.tracks_freeze_media() is
  'A track''s media URL is its identity. A slot may go from the upload placeholder to a '
  'real URL exactly once; every other transition is refused, INCLUDING the first write to '
  'a slot that was left empty — which the original version let through because NULL '
  'comparisons are not FALSE.';

-- ── 2. The scan record outlives the track it describes ─────────────────────
--
-- `track_copyright_scans.track_id` was `on delete cascade`. Since 20260923050000 the
-- uploader of a blocked track may delete it — deliberately, because the strike had moved
-- to `moderation_actions` and the old restriction only stopped somebody tidying their own
-- profile. What was missed is that the CASCADE was still there, so the delete button on
-- the blocked card also destroyed the provider's match and the uploader's own signed
-- declaration: exactly the two records that answer "what did they tell us, and what did
-- the detector say" if a rightsholder ever asks.
--
-- The fix is the pattern already used by `moderation_actions`, `post_removals` and
-- `terms_acceptances`: a plain uuid and NO foreign key. That is not laziness about
-- integrity. An `on delete set null` would be worse than the cascade — it executes as an
-- UPDATE, which this table's append-only guard vetoes, which would abort the parent
-- DELETE and take account deletion down with it.
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_track_id_fkey;

comment on column public.track_copyright_scans.track_id is
  'Plain uuid, deliberately NOT a foreign key. The declaration and the provider verdict '
  'have to survive the track being deleted — that is the whole point of recording them.';

-- `acknowledged_by` was the SAME defect and a worse one, found only when the first
-- attempt at this migration failed and the table was looked at properly. It cascaded to
-- `profiles`, so deleting an ACCOUNT destroyed every rights declaration that person had
-- ever signed — the complete opposite of what a record of who-claimed-what is for, and
-- reachable from the ordinary "delete my account" button rather than from moderation.
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_acknowledged_by_fkey;

comment on column public.track_copyright_scans.acknowledged_by is
  'Plain uuid, deliberately NOT a foreign key — same reason as track_id. Who signed the '
  'declaration must outlive the account, or deleting it erases the claim.';

-- A surviving row that cannot be attributed is not evidence, it is a fragment. Everything
-- the operator console showed came from joining `tracks`, so a deleted track left a row
-- reading "(track unavailable)" against nobody. These two columns are the snapshot, taken
-- at insert and never updated, exactly as `post_removals.track_title` already does.
alter table public.track_copyright_scans
  add column if not exists track_title       text,
  add column if not exists track_uploader_id uuid;

comment on column public.track_copyright_scans.track_title is
  'Copied at scan time so the record still names something after the track is deleted.';
comment on column public.track_copyright_scans.track_uploader_id is
  'Copied at scan time so the record still names WHO declared it after the track is gone.';

create or replace function public.track_copyright_scans_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- Filled here rather than by the caller so it cannot be forgotten, and so the edge
  -- function needs no redeploy to start recording it. SECURITY DEFINER because the
  -- lookup must succeed whoever is inserting.
  select t.title, t.uploader_id
    into new.track_title, new.track_uploader_id
    from public.tracks t
   where t.id = new.track_id;
  return new;
end;
$function$;

revoke all on function public.track_copyright_scans_snapshot() from public;

drop trigger if exists trg_track_copyright_scans_snapshot on public.track_copyright_scans;
create trigger trg_track_copyright_scans_snapshot
  BEFORE INSERT ON public.track_copyright_scans
  FOR EACH ROW EXECUTE FUNCTION public.track_copyright_scans_snapshot();

-- Backfill the rows written before the snapshot existed.
--
-- TWO separate guards refuse this update, and the first attempt at this migration died on
-- the second of them:
--
--   1. The append-only trigger rejects any update touching a column outside the
--      uploader's allowlist. It is right to, so it is suspended for this statement only,
--      by the owner, inside this transaction.
--
--   2. Three CHECK constraints are `NOT VALID`, which means existing rows were never
--      checked — but they ARE enforced on UPDATE. Several scan rows predate the
--      four-option relabel and the consent checkboxes and cannot satisfy them, so ANY
--      write to those rows is refused, including this one.
--
-- The constraints are dropped and re-added byte-identical around the backfill rather than
-- the rows being "repaired". Inventing a `claim_grantor` for a row whose uploader never
-- gave one would fabricate exactly the evidence this table exists to hold. The end state
-- is identical to the start state, and it is all one transaction, so there is no window
-- in which a concurrent writer sees the table unguarded.
alter table public.track_copyright_scans
  drop constraint if exists track_copyright_scans_claim_shape,
  drop constraint if exists track_copyright_scans_consent_required,
  drop constraint if exists track_copyright_scans_claim_fields_match_path;

alter table public.track_copyright_scans disable trigger trg_track_copyright_scans_guard;

update public.track_copyright_scans s
   set track_title       = t.title,
       track_uploader_id = t.uploader_id
  from public.tracks t
 where t.id = s.track_id
   and (s.track_title is null or s.track_uploader_id is null);

alter table public.track_copyright_scans enable trigger trg_track_copyright_scans_guard;

alter table public.track_copyright_scans
  add constraint track_copyright_scans_claim_shape check (
    acknowledgement is null
    or (acknowledgement = 'owner' and claim_basis is not null)
    or (acknowledgement = 'permission' and claim_grantor is not null
        and claim_scope is not null and array_length(claim_scope, 1) >= 1)
    or acknowledgement = any (array['self_recorded', 'disputed', 'cancelled'])
  ) not valid,
  add constraint track_copyright_scans_consent_required check (
    acknowledgement is null
    or acknowledgement = 'cancelled'
    or (accepted_responsibility is true and granted_streaming_licence is true)
  ) not valid,
  add constraint track_copyright_scans_claim_fields_match_path check (
    (claim_basis is null or acknowledgement = 'owner')
    and ((claim_grantor is null and claim_scope is null
          and claim_territory is null and claim_term is null)
         or acknowledgement = 'permission')
  ) not valid;

-- Say out loud how many rows are in that state. It is pre-existing drift from the early
-- test uploads, this migration does not change it, and a silent workaround would be how
-- it stays unknown.
do $drift$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.track_copyright_scans s
   where not (
     s.acknowledgement is null
     or (s.acknowledgement = 'owner' and s.claim_basis is not null)
     or (s.acknowledgement = 'permission' and s.claim_grantor is not null
         and s.claim_scope is not null and array_length(s.claim_scope, 1) >= 1)
     or s.acknowledgement = any (array['self_recorded', 'disputed', 'cancelled'])
   );
  if v_bad > 0 then
    raise warning
      'DRIFT: % scan row(s) predate the current declaration shape. This migration '
      'backfilled them, but any LATER write to them will be refused by '
      'track_copyright_scans_claim_shape. They are early test uploads; deleting those '
      'test tracks clears it.', v_bad;
  end if;
end
$drift$;

-- ── 3. Strikes come from the ledger here too ───────────────────────────────
--
-- 20260923050000 §5 moved `ops_takedown_counts` off `tracks.taken_down_at` and onto
-- `moderation_actions`, because once the uploader may delete a blocked track the column
-- can be erased by the person it counts against. `ops_copyright_scans` was not moved with
-- it and still reads the column, so the moderation queue's own strike badge — the number
-- an operator actually decides on — drops to zero the moment somebody tidies up.
--
-- Same arithmetic as `ops_takedown_counts`: takedowns minus restores, because a takedown
-- an operator reversed is not a strike and counting it would punish somebody for a
-- correction that was not theirs.
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
  accepted_responsibility  boolean,
  granted_streaming_licence boolean,
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
        t.taken_down_at                                           as track_taken_down_at
      from public.track_copyright_scans s
      left join public.tracks t on t.id = s.track_id
      where s.match_found is true
        and (p_include_answered or s.acknowledgement is null)
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
      r.acknowledged_at, r.created_at
    from scan_rows r
    left join public.profiles p on p.id = r.owner_id
    order by r.created_at desc
    limit 500;
end;
$function$;

revoke all on function public.ops_copyright_scans(boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean) from anon;
grant execute on function public.ops_copyright_scans(boolean) to authenticated;

-- ── 4. Verify ───────────────────────────────────────────────────────────────
--
-- The freeze is exercised rather than inspected. The original defect passed every
-- reading of the code and only showed itself when somebody wrote to the empty slot, so
-- asserting on the function's text would reproduce exactly the mistake that was made.
do $verify$
declare
  v_track uuid;
  v_allowed boolean;
begin
  -- BOTH foreign keys, not just the one the review named. `acknowledged_by` cascaded to
  -- `profiles`, so account deletion erased the declaration just as thoroughly.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.track_copyright_scans'::regclass
       and contype = 'f'
  ) then
    raise exception
      'VERIFY: a rights declaration is still destroyed when its track or its author goes';
  end if;

  select id into v_track
    from public.tracks
   where media_kind = 'audio' and video_url is null
   limit 1;

  if v_track is not null then
    begin
      update public.tracks set video_url = 'https://verify.invalid/x.mp4' where id = v_track;
      v_allowed := true;
    exception when others then
      v_allowed := false;
    end;

    if v_allowed then
      raise exception
        'VERIFY: the empty media slot is still writable after a clean scan';
    end if;
  end if;

  if (select count(*) from public.tracks
       where audio_url is not null and video_url is not null) > 0 then
    raise warning
      'VERIFY: some track carries BOTH media URLs — check it was not injected before this fix';
  end if;
end
$verify$;
