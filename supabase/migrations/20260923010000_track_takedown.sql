-- ============================================================================
-- Takedown — the actuator every queue in this project has been missing
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- `docs/terms.html` §6 and `docs/support.html` §3 both promise, in writing, that Livil
-- removes infringing content and terminates repeat infringers. Until this migration
-- NOTHING COULD DO EITHER. `posts_delete_own` and `tracks_delete_own` were the only
-- DELETE policies, so removing somebody else's upload meant opening the Supabase
-- dashboard and deleting rows by hand.
--
-- That gap is not specific to copyright. `ops_reports_overview()` lets an operator read
-- reports for spam, harassment and hate and mark them "reviewed" — and then do nothing.
-- A queue whose decisions cannot be executed is not a moderation process.
--
-- ── TAKEDOWN IS REVERSIBLE, AND THAT IS A REQUIREMENT, NOT A LUXURY ─────────
--
-- ADR-0017 §E specified a hard delete. The adversarial critic then found that this
-- CONTRADICTS ADR-0017's own context: India's Copyright Rules require an intermediary to
-- block access for 21 days on a rights-owner complaint and permit RESTORATION if no court
-- order arrives. You cannot restore what you destroyed. Five agents missed it across two
-- rounds; this migration is where it gets resolved.
--
-- The resolution is to split the irreversible part out:
--
--   TAKE DOWN  delete the posts, tombstone the track, LEAVE THE FILES.
--              Reversible: the track row survives, so a restore re-creates the post.
--   PURGE      delete the stored objects. Permanent, separate, and deliberately a second
--              decision rather than a side effect of the first.
--
-- ── WHY DELETING THE POST IS THE RIGHT HIDE ────────────────────────────────
--
-- A `posts.visible` flag would have to be hand-copied into every SECURITY DEFINER
-- function that reads posts — 18 migration files define them — including
-- `shared_post_public`, which is GRANTED TO ANON and keyed by post UUID. Miss one and a
-- "hidden" post is still served to anyone holding a share link. Deleting the row makes
-- every one of those return nothing, for free, with no omission to forget.
--
-- ── WHAT ACTUALLY MAKES THE DELETE COMPLETE ────────────────────────────────
--
-- An earlier draft of this header claimed the repost-first ORDERING was the correctness
-- argument. Review corrected it, and the correction matters because it is what the next
-- person will reason from: the load-bearing fact is that **`posts.track_id` is NOT NULL**
-- (baseline_schema.sql:110), so a repost carries the track id independently of
-- `original_post_id`. A single `delete from posts where track_id = $1` removes both.
--
-- The two-step delete is kept because the COUNTS are worth reporting separately — "one
-- upload and nine reposts" is a different outcome from "one post" — and because each
-- statement takes a fresh snapshot at READ COMMITTED, so a concurrently committed repost
-- is still caught.
--
-- The hazard the old comment described is real but handled elsewhere:
-- `original_post_id` is ON DELETE SET NULL (20260607000008), and
-- `posts_freeze_counter_identity` already carves that case out explicitly.
--
-- ── WHAT A RESTORE CANNOT BRING BACK ───────────────────────────────────────
--
-- Deleting a post cascades its likes, comments, views and impressions. Those are gone
-- permanently, and a restore does not fabricate them. Reposts are NOT restored either:
-- they were other people's posts, and re-creating content under someone else's name
-- because a third decision went a third way is not ours to do. The snapshot exists so the
-- uploader's own post returns with its caption and clip intact — not to simulate history.
--
-- ── REPEAT INFRINGERS ──────────────────────────────────────────────────────
--
-- No strikes table. `count(*) from tracks where uploader_id = $1 and taken_down_at is not
-- null` is the count, derived from the action rather than maintained alongside it, so the
-- two can never disagree. That is the same argument `ops_reports_queue` made for
-- declining a status enum, applied one layer along.

-- ── 1. The tombstone ────────────────────────────────────────────────────────
--
-- On `tracks`, not on `posts`: the posts are deleted, so a record attached to them would
-- be deleted with them. The track is what survives a takedown, so it is what carries the
-- mark — and it is also what the repeat-infringer count reads.
-- NO FOREIGN KEY on taken_down_by, deliberately. `on delete set null` is executed as a
-- real UPDATE, which fires the freeze trigger below — and when an OPERATOR deletes their
-- own account, `ops_users` cascades first, so `is_ops()` on the very user being deleted is
-- already false by the time the null-out runs and the bypass does not fire. An operator
-- who had ever taken anything down could never delete their account. A plain uuid in a
-- moderation record is the right shape anyway: the record must outlive what it names.
alter table public.tracks
  add column if not exists taken_down_at     timestamptz,
  add column if not exists taken_down_by     uuid,
  add column if not exists taken_down_reason text
    check (taken_down_reason is null or char_length(taken_down_reason) <= 1000);

comment on column public.tracks.taken_down_at is
  'Set by ops_take_down_track. The track and its files survive — only the posts are '
  'deleted — so a takedown can be reversed by ops_restore_track.';

-- Partial: "what is currently down" is the small set and the only one anyone lists.
create index if not exists tracks_taken_down_idx
  on public.tracks (taken_down_at desc) where taken_down_at is not null;

-- ── 2. The ledger ───────────────────────────────────────────────────────────
--
-- VERIFIED ABSENT BEFORE WRITING THIS: there is no append-only moderation record anywhere
-- in this project. `ops_mark_report_reviewed` stamps `reviewed_by`/`reviewed_at` in place
-- on the report row, which is overwritable and keeps only the most recent answer.
--
-- Every action lands here, including reversals. A restore is a SECOND ROW, never an
-- update of the first: the point of the ledger is that the sequence of decisions survives,
-- and an edit erases exactly the thing worth keeping.
-- PLAIN UUIDs, NO FOREIGN KEYS. This was the review's second blocking finding and it is
-- worth stating fully, because the instinct to add them back will be strong.
--
-- `on delete set null` is performed as an UPDATE against this table, which fires the
-- append-only trigger below, which raises — so the referential action fails and the parent
-- DELETE aborts. Deleting a profile or a track that appears anywhere in this ledger becomes
-- impossible, permanently, for service_role and the dashboard alike. `delete_my_account`
-- ends in `delete from auth.users`, so that is an erasure obligation broken by an audit
-- table.
--
-- The previous migration's header reasons through this exact trap for `acknowledged_by`
-- and picks CASCADE. CASCADE is wrong HERE for the opposite reason: a ledger that deletes
-- itself when its subject leaves is not a ledger. So: no constraint at all. An audit
-- record should point at ids that may no longer resolve — that is what makes it a record
-- rather than a view.
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  -- Pinned server-side in section 3. Never trusted from the client.
  actor_id uuid,
  action text not null check (action in ('takedown', 'restore', 'purge_media')),
  track_id uuid,
  -- Denormalised so the ledger still names who was acted upon after the track is gone.
  target_owner_id uuid,
  reason text check (reason is null or char_length(reason) <= 1000),
  -- Enough to re-create the uploader's own post: caption and clip window. NOT an attempt
  -- to snapshot engagement, which cascades away and is not recoverable.
  snapshot jsonb,
  created_at timestamptz not null default now()
);

comment on table public.moderation_actions is
  'Append-only record of every moderation action, reversals included. A restore is a new '
  'row, never an edit of the takedown it reverses.';

create index if not exists moderation_actions_track_idx
  on public.moderation_actions (track_id, created_at desc);
create index if not exists moderation_actions_owner_idx
  on public.moderation_actions (target_owner_id, created_at desc);

alter table public.moderation_actions enable row level security;

-- NO POLICIES AT ALL. Deny-all for every client role, in every direction: the rows are
-- written by the SECURITY DEFINER functions below and read through the ops function in
-- section 6. A subject who could read this table learns which of their uploads an
-- operator is looking at before any decision is made.

-- ── 3. Append-only, and it binds the OPERATOR too ───────────────────────────
--
-- Policies stop clients. They are not consulted for the table owner and are bypassed by
-- service_role — both reachable from the dashboard — and the operator is precisely the
-- party whose interest this record may cut against. Triggers fire for the owner, which is
-- why these exist rather than more policies. Same reasoning as terms_acceptances
-- (20260907000000).
create or replace function public.moderation_actions_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception 'moderation_actions is append-only: a reversal is a new row'
    using errcode = '42501';
end;
$function$;

-- NOTE FOR WHOEVER ADDS A FOREIGN KEY TO THIS TABLE LATER: do not. An `on delete set
-- null` would be executed as an UPDATE, this trigger would raise, and the parent DELETE
-- would abort — making account deletion impossible for anyone who appears here, with no
-- way to clear it short of a new migration. The columns are plain uuids for that reason;
-- see the table header.

drop trigger if exists trg_moderation_actions_append_only on public.moderation_actions;
create trigger trg_moderation_actions_append_only
  BEFORE UPDATE OR DELETE ON public.moderation_actions
  FOR EACH ROW EXECUTE FUNCTION public.moderation_actions_append_only();

-- `default now()` applies only when a column is OMITTED, and the definer functions below
-- could be edited later to pass one. Pinning both here means the "who" and the "when" of
-- a moderation action are asserted by the database and by nothing else.
create or replace function public.moderation_actions_pin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.created_at := now();
  -- UNCONDITIONAL. A coalesce onto a caller-supplied value would adopt whatever the
  -- writer passed whenever auth.uid() is null — which is precisely the dashboard and
  -- service_role case the header above claims this trigger binds.
  new.actor_id   := (select auth.uid());
  return new;
end;
$function$;

drop trigger if exists trg_moderation_actions_pin on public.moderation_actions;
create trigger trg_moderation_actions_pin
  BEFORE INSERT ON public.moderation_actions
  FOR EACH ROW EXECUTE FUNCTION public.moderation_actions_pin();

-- ── 4. The uploader may not erase their own strike ──────────────────────────
--
-- Two holes, both obvious once stated and both fatal to the repeat-infringer count:
--
--   UPDATE — `tracks_update_own` constrains WHICH ROWS, never WHICH COLUMNS, so without
--            this the uploader simply clears their own tombstone.
--   DELETE — `tracks_delete_own` lets them delete the track, taking the tombstone with
--            it. The strike ledger erased by the person it counts.
--
-- Note the asymmetry: a track with NO tombstone stays freely deletable. Nobody loses the
-- ability to remove their own work; they lose the ability to remove the record of a
-- decision made about it.
-- THE BYPASS IS THE CODE PATH, NOT THE PERSON.
--
-- An earlier draft bypassed on `public.is_ops()`. That was granted to the human, not to
-- the function — so an operator who is also an artist could clear their own tombstone
-- with a plain `PATCH /tracks`, erasing their strike with NO ledger entry, and the header's
-- claim that this "binds the OPERATOR too" was false for that path. Verified by execution
-- during review.
--
-- `livil.moderating` is set transaction-locally by the two definer functions below and by
-- nothing else, so the tombstone can only move through code that also writes the ledger.
-- Transaction-local means it cannot leak into a later PostgREST request on the same
-- connection.
create or replace function public.moderating_now()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select coalesce(current_setting('livil.moderating', true), '') = '1';
$function$;

create or replace function public.tracks_freeze_takedown()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if public.moderating_now() then
    return new;
  end if;

  if new.taken_down_at     is distinct from old.taken_down_at
     or new.taken_down_by     is distinct from old.taken_down_by
     or new.taken_down_reason is distinct from old.taken_down_reason
  then
    raise exception 'a takedown can only be changed by an operator'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_tracks_freeze_takedown on public.tracks;
create trigger trg_tracks_freeze_takedown
  BEFORE UPDATE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_freeze_takedown();

-- SECURITY DEFINER for the same reason, and the same direction of failure: the
-- account-deletion carve-out asks whether the uploader's profile still exists. Under the
-- caller's RLS a hidden profile reads as absent, the carve-out fires, and the uploader
-- deletes a taken-down track — erasing their own strike.
create or replace function public.tracks_block_taken_down_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- The account-deletion carve-out. When the uploader's profile is already gone this
  -- DELETE is the cascade tidying up, not somebody erasing their own strike — and
  -- refusing it would make account deletion impossible for anyone ever taken down.
  -- Same idiom as posts_freeze_counter_identity's ON DELETE SET NULL carve-out.
  if old.taken_down_at is not null
     and not public.moderating_now()
     and exists (select 1 from public.profiles where id = old.uploader_id)
  then
    raise exception 'a track that has been taken down cannot be deleted'
      using errcode = '42501';
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_tracks_block_taken_down_delete on public.tracks;
create trigger trg_tracks_block_taken_down_delete
  BEFORE DELETE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.tracks_block_taken_down_delete();

-- ── 4b. THE HOLE THAT MADE THE TOMBSTONE DECORATIVE ────────────────────────
--
-- Deleting the posts makes every READER return nothing. It says nothing about WRITERS.
-- `posts_insert_own` is `with check (author_id = auth.uid())` — it constrains WHO THE
-- AUTHOR IS, never WHICH TRACK IS SERVED — and `tracks_select_authenticated` is
-- effectively open, so every track UUID is enumerable by any signed-in account
-- (20260804030000 records this).
--
-- So before this trigger, a takedown was undone by anyone at all, uploader or stranger:
--
--   insert into posts (author_id, kind, track_id) values (auth.uid(), 'upload', '<uuid>');
--
-- The audio streams again in feeds, on profiles and through `shared_post_public` (granted
-- to anon), while `tracks.taken_down_at` stays set so the operator screen still reads
-- "Taken down". Silent, and in the safe-looking direction. Reproduced under real RLS
-- during review as a third party who had never touched the track.
-- SECURITY DEFINER, deliberately, and this one is load-bearing. As INVOKER the `exists`
-- below runs under the caller's RLS — and `tracks_select_authenticated` hides a row from
-- anyone on the other side of a block. A blocked user would then see no tombstone, the
-- check would pass, and they could re-post the taken-down track. Failing OPEN is the one
-- direction this must never fail. It reads one table, takes no dynamic SQL, and pins
-- search_path.
create or replace function public.posts_block_taken_down()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- `ops_restore_track` re-creates the post while the tombstone is still set, so the
  -- restore path bypasses on the same transaction-local flag the freeze triggers use.
  if public.moderating_now() then
    return new;
  end if;

  if exists (
    select 1 from public.tracks
     where id = new.track_id and taken_down_at is not null
  ) then
    raise exception 'this track has been taken down and cannot be posted'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_posts_block_taken_down on public.posts;
create trigger trg_posts_block_taken_down
  BEFORE INSERT ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_block_taken_down();

revoke all on function public.posts_block_taken_down() from public;

-- GRANTED, and the revoke that preceded it was a production-breaking bug caught only by
-- executing this file: `tracks_freeze_takedown` is SECURITY INVOKER, so it calls this as
-- `authenticated` — and with EXECUTE revoked, EVERY title edit by EVERY user failed with
-- "permission denied for function moderating_now".
--
-- Safe to expose: it reads a transaction-local GUC and returns a boolean. A client cannot
-- SET that GUC — `set_config` lives in `pg_catalog`, which PostgREST does not expose, and
-- no RPC in this schema calls it with user input. Knowing the flag is false tells a caller
-- nothing they did not already know.
revoke all on function public.moderating_now() from public;
grant execute on function public.moderating_now() to authenticated, service_role;

-- ── 5. The actuator ─────────────────────────────────────────────────────────
--
-- RAISES for a non-operator rather than returning empty. Every ops READ in this project
-- returns nothing to a non-ops caller so the route needs no guard — but a silent no-op
-- WRITE is indistinguishable from success, and would let an operator believe they had
-- removed something that is still playing. Reads stay quiet; writes must shout.
create or replace function public.ops_take_down_track(
  p_track_id uuid,
  p_reason   text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner    uuid;
  v_down     timestamptz;
  v_reposts  integer := 0;
  v_posts    integer := 0;
  v_snapshot jsonb;
begin
  -- FIRST, before the parameters are even read. Three shipped functions in this project
  -- made the opposite mistake (Constitution P17).
  if not public.is_ops() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select uploader_id, taken_down_at into v_owner, v_down
    from public.tracks where id = p_track_id;
  if v_owner is null then
    raise exception 'no such track' using errcode = 'P0002';
  end if;

  -- A SECOND takedown finds no posts, so `jsonb_agg` returns NULL and writes a ledger row
  -- with an empty snapshot — which `ops_restore_track` then picks as the most recent,
  -- losing the uploader's caption and clip for good. Reachable with a stale tab or a
  -- retry after a network blip, so the database refuses rather than relying on the screen.
  if v_down is not null then
    raise exception 'this track is already taken down' using errcode = '42501';
  end if;

  -- Opens the window in which the tombstone may move. Transaction-local; see
  -- `moderating_now()`.
  perform set_config('livil.moderating', '1', true);

  -- Keep the uploader's own post before deleting it, so a restore can return the caption
  -- and clip window rather than a bare row.
  select jsonb_agg(jsonb_build_object(
           'caption', p.caption,
           'clip_start_sec', p.clip_start_sec,
           'clip_end_sec', p.clip_end_sec))
    into v_snapshot
    from public.posts p
   where p.track_id = p_track_id and p.kind = 'upload';

  -- REPOSTS FIRST. `original_post_id` is ON DELETE SET NULL, so deleting the upload post
  -- alone would leave every repost alive and still serving this track.
  with gone as (
    delete from public.posts
     where track_id = p_track_id and kind = 'repost'
     returning 1
  )
  select count(*) into v_reposts from gone;

  -- Then whatever is left, which is the uploader's own post.
  with gone as (
    delete from public.posts
     where track_id = p_track_id
     returning 1
  )
  select count(*) into v_posts from gone;

  update public.tracks
     set taken_down_at     = now(),
         taken_down_by     = (select auth.uid()),
         taken_down_reason = p_reason
   where id = p_track_id;

  insert into public.moderation_actions (action, track_id, target_owner_id, reason, snapshot)
  values ('takedown', p_track_id, v_owner, p_reason, v_snapshot);

  -- CLOSE THE WINDOW. `set_config(..., true)` lasts the whole TRANSACTION, not the
  -- function call — so without this, everything after this function in the same
  -- transaction bypasses the freeze triggers. PostgREST happens to give each request its
  -- own transaction, which would have hidden this in production and left it waiting for
  -- the first caller that did two things at once.
  perform set_config('livil.moderating', '', true);

  -- How many posts stopped serving. The operator's screen should say this rather than
  -- "done": one upload and nine reposts is a materially different outcome from one post.
  return v_reposts + v_posts;
end;
$$;

comment on function public.ops_take_down_track(uuid, text) is
  'Deletes every post for a track (reposts first), tombstones the track, and records the '
  'action. Files are NOT deleted — see ops_purge_track_media. Returns posts removed.';

-- Restore. The other half of "reversible", and the reason takedown does not purge.
create or replace function public.ops_restore_track(
  p_track_id uuid,
  p_reason   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner    uuid;
  v_down     timestamptz;
  v_snapshot jsonb;
  v_post     uuid;
begin
  if not public.is_ops() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select uploader_id, taken_down_at into v_owner, v_down
    from public.tracks where id = p_track_id;
  if v_owner is null then
    raise exception 'no such track' using errcode = 'P0002';
  end if;

  -- Nothing stops two `kind='upload'` posts for one track, so restoring a LIVE track
  -- silently duplicates it — the same track twice on the uploader's profile, each with
  -- its own counters. Refused here rather than relying on the button being hidden.
  if v_down is null then
    raise exception 'this track is not taken down' using errcode = '42501';
  end if;

  perform set_config('livil.moderating', '1', true);

  -- The most recent takedown for this track is what is being reversed.
  select snapshot into v_snapshot
    from public.moderation_actions
   where track_id = p_track_id and action = 'takedown'
   order by created_at desc
   limit 1;

  -- Re-create the uploader's own post only. Reposts belonged to other people, and
  -- re-publishing content under someone else's name because a later decision went the
  -- other way is not ours to do.
  insert into public.posts (author_id, kind, track_id, caption, clip_start_sec, clip_end_sec)
  values (
    v_owner,
    'upload',
    p_track_id,
    nullif(v_snapshot -> 0 ->> 'caption', ''),
    (v_snapshot -> 0 ->> 'clip_start_sec')::numeric,
    (v_snapshot -> 0 ->> 'clip_end_sec')::numeric
  )
  returning id into v_post;

  update public.tracks
     set taken_down_at = null, taken_down_by = null, taken_down_reason = null
   where id = p_track_id;

  insert into public.moderation_actions (action, track_id, target_owner_id, reason)
  values ('restore', p_track_id, v_owner, p_reason);

  -- See the note in ops_take_down_track: the flag outlives the call, not the transaction.
  perform set_config('livil.moderating', '', true);

  return v_post;
end;
$$;

comment on function public.ops_restore_track(uuid, text) is
  'Reverses a takedown by re-creating the uploader''s own post from the snapshot. Likes, '
  'comments and reposts are NOT restored — they cascaded away and are not recoverable.';

revoke all on function public.ops_take_down_track(uuid, text) from public;
revoke all on function public.ops_restore_track(uuid, text) from public;
revoke execute on function public.ops_take_down_track(uuid, text) from anon;
revoke execute on function public.ops_restore_track(uuid, text) from anon;
grant execute on function public.ops_take_down_track(uuid, text) to authenticated;
grant execute on function public.ops_restore_track(uuid, text) to authenticated;

-- ── 6. What an operator can see ─────────────────────────────────────────────
create or replace function public.ops_moderation_history(p_track_id uuid)
returns table (
  action           text,
  actor_username   text,
  reason           text,
  created_at       timestamptz
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
    select m.action, p.username, m.reason, m.created_at
      from public.moderation_actions m
      left join public.profiles p on p.id = m.actor_id
     where m.track_id = p_track_id
     order by m.created_at desc;
end;
$$;

-- Repeat infringers, derived rather than maintained. A stored counter and the tracks it
-- counts can disagree; this cannot.
create or replace function public.ops_takedown_counts()
returns table (
  uploader_id uuid,
  username    text,
  takedowns   bigint,
  latest      timestamptz
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
    select t.uploader_id, p.username, count(*), max(t.taken_down_at)
      from public.tracks t
      left join public.profiles p on p.id = t.uploader_id
     where t.taken_down_at is not null
     group by t.uploader_id, p.username
     order by count(*) desc, max(t.taken_down_at) desc
     limit 200;
end;
$$;

revoke all on function public.ops_moderation_history(uuid) from public;
revoke all on function public.ops_takedown_counts() from public;
revoke execute on function public.ops_moderation_history(uuid) from anon;
revoke execute on function public.ops_takedown_counts() from anon;
grant execute on function public.ops_moderation_history(uuid) to authenticated;
grant execute on function public.ops_takedown_counts() to authenticated;

revoke all on function public.moderation_actions_append_only() from public;
revoke all on function public.moderation_actions_pin() from public;
revoke all on function public.tracks_freeze_takedown() from public;
revoke all on function public.tracks_block_taken_down_delete() from public;

-- ── 6b. The copyright queue learns what is already down ────────────────────
--
-- Redefined rather than left alone: without `taken_down_at` the operator screen cannot
-- tell an untouched match from one already actioned, and would offer "Take down" on a
-- track that is already down. `drop` first because the return type changes.
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
  taken_down_at     timestamptz,
  -- How many of this uploader's tracks are currently down. The repeat-infringer signal,
  -- on the row where the decision is made rather than a screen away.
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

-- `drop function` discards the comment, and this repo fingerprints function comments —
-- 20260807020000 exists solely because that drift went unnoticed once already.
comment on function public.ops_copyright_scans(boolean) is
  'Operator view of uploads that matched a known recording, with the uploader''s rights '
  'declaration. Returns empty for a non-ops caller rather than raising.';

revoke all on function public.ops_copyright_scans(boolean) from public;
revoke execute on function public.ops_copyright_scans(boolean) from anon;
grant execute on function public.ops_copyright_scans(boolean) to authenticated;

-- ── 7. Verify ───────────────────────────────────────────────────────────────
do $verify$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'moderation_actions'
  ) then
    raise exception 'VERIFY: moderation_actions must have NO policies — it is deny-all';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_moderation_actions_append_only' and not tgisinternal
  ) then
    raise exception 'VERIFY: the append-only trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_tracks_block_taken_down_delete' and not tgisinternal
  ) then
    raise exception 'VERIFY: an uploader could delete a track carrying a takedown';
  end if;

  if has_function_privilege('anon', 'public.ops_take_down_track(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.ops_restore_track(uuid, text)', 'execute')
  then
    raise exception 'VERIFY: anon can execute a moderation function';
  end if;

  -- Without this the tombstone is decorative: anyone can re-post a taken-down track.
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_posts_block_taken_down' and not tgisinternal
  ) then
    raise exception 'VERIFY: a taken-down track can still be posted';
  end if;

  -- Foreign keys here reintroduce the account-deletion break. See the table header.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.moderation_actions'::regclass and contype = 'f'
  ) then
    raise exception 'VERIFY: moderation_actions must carry no foreign keys';
  end if;

  if exists (
    select 1 from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.tracks'::regclass and c.contype = 'f'
      and a.attname = 'taken_down_by'
  ) then
    raise exception 'VERIFY: tracks.taken_down_by must carry no foreign key';
  end if;

  -- The actuator must RAISE for a non-operator, not return quietly. Checked by reading the
  -- body rather than by calling it, because calling it as ops would prove nothing.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ops_take_down_track'
      and pg_get_functiondef(p.oid) like '%not authorised%'
  ) then
    raise exception 'VERIFY: ops_take_down_track no longer raises for a non-operator';
  end if;
end
$verify$;

-- ── FOLLOW-UP: purging the files is NOT in this migration ───────────────────
--
-- `ops_purge_track_media` is deliberately absent. Deleting a stored object needs
-- `tracks_media_delete_own` widened with `or (select public.is_ops())`, and NOBODY HAS
-- VERIFIED that Supabase Storage's DELETE path consults that policy for a non-owner —
-- ADR-0017 §K names this as an unrun probe and marks the inference at ~90%.
--
-- Shipping a purge function on an unverified assumption would produce the worst available
-- outcome: an operator told the files are gone while they remain fetchable at a public
-- URL. Run the probe, then add it.
--
-- Until then a takedown removes the content from every surface Livil renders — feeds,
-- profiles, search and the anon share page — while the raw object URL stays live for
-- anyone who already has it. That is a real limitation and the operator screen says so
-- rather than implying otherwise.
