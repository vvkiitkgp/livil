-- ============================================================================
-- Telling people what happened to their post
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- A takedown deleted the posts and said nothing. The uploader's track vanished from their
-- own profile with no explanation, and the person who had reposted it lost their post
-- without ever learning why. Both discover it by noticing a gap, which is the worst way
-- to find out and is not how any comparable platform behaves.
--
-- ── WHY THIS IS NOT A `visible` FLAG ───────────────────────────────────────
--
-- The obvious implementation is to stop deleting posts and hide them instead. ADR-0017 §C
-- rejected that, and the reason still stands: the predicate would have to be hand-copied
-- into every SECURITY DEFINER function that reads posts — 18 migration files define them —
-- including `shared_post_public`, which is GRANTED TO ANON and keyed by post UUID. Miss
-- one and a "hidden" post is still served to anybody holding a share link.
--
-- So the posts are still DELETED, and the leak-proofness of that is kept for free. What
-- is added is a record of the removal, in a table with ONE reader: the person whose post
-- it was. One new read surface we fully control, instead of eighteen existing ones edited
-- correctly.
--
-- ── THE SNAPSHOT IS NOT DECORATION ─────────────────────────────────────────
--
-- `track_title` and `caption` are copied in rather than joined out. The uploader may
-- delete the track afterwards — which section 4 now permits — and the reposter's card
-- must still say WHAT it was about. A record that goes blank when somebody else acts is
-- not a record.
--
-- ── STRIKES MOVE TO THE LEDGER ─────────────────────────────────────────────
--
-- `ops_takedown_counts` read `tracks.taken_down_at`, which made "let the uploader delete
-- the blocked track" and "the uploader cannot erase their own strike" contradictory
-- requirements. They are not: the strike belongs in `moderation_actions`, which has
-- `target_owner_id`, no foreign keys, and outlives everything it names. Counting there
-- lets the track be deleted while the record stays — which is what both requirements
-- actually wanted.

-- ── 1. What was removed, readable only by whoever lost it ───────────────────
create table if not exists public.post_removals (
  id uuid primary key default gen_random_uuid(),
  -- The post is gone; this is its id for correlation only. Plain uuid, no FK — the row it
  -- points at is deleted by definition.
  post_id  uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  -- Plain uuid: the uploader may delete the track afterwards, and this record must not
  -- take the parent delete down with it or vanish alongside it.
  track_id uuid not null,
  kind text not null check (kind in ('upload', 'repost')),

  -- Copied, not joined. See the header.
  track_title text,
  caption text,
  clip_start_sec numeric(10,3),
  clip_end_sec   numeric(10,3),

  -- The operator's words, shown verbatim to the person affected. The whole point is that
  -- they learn WHY, so an empty reason would defeat it — `ops_take_down_track` already
  -- refuses to run without one at the UI level, and the ledger records it either way.
  reason text,
  removed_at timestamptz not null default now()
);

comment on table public.post_removals is
  'What a takedown removed, readable only by the person whose post it was. The posts are '
  'still deleted — this is the record, not a hidden copy.';

create index if not exists post_removals_author_idx
  on public.post_removals (author_id, removed_at desc);
create index if not exists post_removals_track_idx
  on public.post_removals (track_id);

alter table public.post_removals enable row level security;

-- Read: yours and nobody else's. Not friends, not the public, and not the uploader for a
-- reposter's row — a repost removal names somebody else's caption.
drop policy if exists post_removals_select_own on public.post_removals;
create policy post_removals_select_own
  on public.post_removals for select
  to authenticated
  using (author_id = (select auth.uid()));

-- Dismiss: the "delete it" action on the card. Deleting the NOTICE is all this does — the
-- post is already gone and the ledger entry is untouched, so nobody clears a strike by
-- tidying their profile.
drop policy if exists post_removals_delete_own on public.post_removals;
create policy post_removals_delete_own
  on public.post_removals for delete
  to authenticated
  using (author_id = (select auth.uid()));

-- NO INSERT AND NO UPDATE POLICY. Written by the takedown function or by nobody, and the
-- reason shown to a user must not be something they can author.

-- ── 2. The notice ──────────────────────────────────────────────────────────
alter table public.activity_notifications
  drop constraint if exists activity_notifications_type_check;

alter table public.activity_notifications
  add constraint activity_notifications_type_check check (type in (
    'like','comment','repost','play_milestone',
    'new_fan','friend_accepted','friend_rejected',
    'credited','credit_accepted','credit_declined',
    'badge_granted',
    -- payload: {"reason","track_title","kind"}. NO ACTOR, deliberately — see below.
    'content_removed'
  ));

-- Mirrors `notify_badge_granted` (20260921000000), including the two decisions worth
-- repeating:
--
--   NO ACTOR. Naming the operator would put a real person's profile in the inbox of
--   somebody who just had content removed, and that is an invitation to retaliate.
--
--   SWALLOWS ERRORS. A takedown that fails because a notification failed would leave
--   infringing content up over a delivery problem. The removal is the obligation; the
--   notice is a courtesy that must not be able to block it.
create or replace function public.notify_content_removed(
  p_user_id uuid,
  p_track_title text,
  p_kind text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_notifications (recipient_id, type, actor_id, payload, updated_at)
  values (
    p_user_id,
    'content_removed',
    null,
    jsonb_build_object('track_title', p_track_title, 'kind', p_kind, 'reason', p_reason),
    now()
  );
exception
  when others then
    raise warning 'content removed but notification failed for %: %', p_user_id, sqlerrm;
end;
$$;

-- An internal of the takedown. A client able to call it could post itself — or anyone
-- else — a notice claiming their work had been removed, with any reason it liked.
revoke all     on function public.notify_content_removed(uuid, text, text, text) from public;
revoke execute on function public.notify_content_removed(uuid, text, text, text) from anon;
revoke execute on function public.notify_content_removed(uuid, text, text, text) from authenticated;

-- ── 3. Takedown records and tells ──────────────────────────────────────────
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
  v_title    text;
  v_down     timestamptz;
  v_reposts  integer := 0;
  v_posts    integer := 0;
  v_snapshot jsonb;
  r          record;
begin
  if not public.is_ops() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select uploader_id, title, taken_down_at into v_owner, v_title, v_down
    from public.tracks where id = p_track_id;
  if v_owner is null then
    raise exception 'no such track' using errcode = 'P0002';
  end if;

  if v_down is not null then
    raise exception 'this track is already taken down' using errcode = '42501';
  end if;

  perform set_config('livil.moderating', '1', true);

  select jsonb_agg(jsonb_build_object(
           'caption', p.caption,
           'clip_start_sec', p.clip_start_sec,
           'clip_end_sec', p.clip_end_sec))
    into v_snapshot
    from public.posts p
   where p.track_id = p_track_id and p.kind = 'upload';

  -- The record, written BEFORE the delete — the rows it describes are about to stop
  -- existing, and reading them afterwards is not an option.
  insert into public.post_removals
    (post_id, author_id, track_id, kind, track_title, caption, clip_start_sec, clip_end_sec, reason)
  select p.id, p.author_id, p_track_id, p.kind, v_title,
         p.caption, p.clip_start_sec, p.clip_end_sec, p_reason
    from public.posts p
   where p.track_id = p_track_id;

  -- Everyone who lost a post hears about it, once each. The reposter is told as well as
  -- the uploader: they also lost something, and they did not do anything wrong.
  for r in
    select distinct p.author_id, p.kind
      from public.posts p
     where p.track_id = p_track_id
  loop
    perform public.notify_content_removed(r.author_id, v_title, r.kind, p_reason);
  end loop;

  -- Reposts first. See the header of 20260923010000 for why the ordering is kept even
  -- though `posts.track_id` alone would catch both.
  with gone as (
    delete from public.posts
     where track_id = p_track_id and kind = 'repost'
     returning 1
  )
  select count(*) into v_reposts from gone;

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

  perform set_config('livil.moderating', '', true);

  return v_reposts + v_posts;
end;
$$;

-- Restore clears the notices along with the tombstone: the post is back, so a card saying
-- it was removed would be a lie the user has no way to dismiss as wrong.
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
  if v_down is null then
    raise exception 'this track is not taken down' using errcode = '42501';
  end if;

  perform set_config('livil.moderating', '1', true);

  select snapshot into v_snapshot
    from public.moderation_actions
   where track_id = p_track_id and action = 'takedown'
   order by created_at desc
   limit 1;

  insert into public.posts (author_id, kind, track_id, caption, clip_start_sec, clip_end_sec)
  values (
    v_owner, 'upload', p_track_id,
    nullif(v_snapshot -> 0 ->> 'caption', ''),
    (v_snapshot -> 0 ->> 'clip_start_sec')::numeric,
    (v_snapshot -> 0 ->> 'clip_end_sec')::numeric
  )
  returning id into v_post;

  update public.tracks
     set taken_down_at = null, taken_down_by = null, taken_down_reason = null
   where id = p_track_id;

  -- The reposter's notice goes too, even though their repost is NOT restored. Leaving it
  -- would tell them their post was removed while the track is visibly back, with no way
  -- to reconcile the two.
  delete from public.post_removals where track_id = p_track_id;

  insert into public.moderation_actions (action, track_id, target_owner_id, reason)
  values ('restore', p_track_id, v_owner, p_reason);

  perform set_config('livil.moderating', '', true);

  return v_post;
end;
$$;

revoke all on function public.ops_take_down_track(uuid, text) from public;
revoke all on function public.ops_restore_track(uuid, text) from public;
revoke execute on function public.ops_take_down_track(uuid, text) from anon;
revoke execute on function public.ops_restore_track(uuid, text) from anon;
grant execute on function public.ops_take_down_track(uuid, text) to authenticated;
grant execute on function public.ops_restore_track(uuid, text) to authenticated;

comment on function public.ops_take_down_track(uuid, text) is
  'Records what is about to be removed, tells everyone who loses a post, deletes every '
  'post for the track (reposts first), tombstones it, and writes the ledger. Files are '
  'NOT deleted. Returns posts removed.';

-- ── 4. The uploader may delete a blocked track ─────────────────────────────
--
-- Reversing part of 20260923010000, deliberately. That trigger existed so the strike
-- could not be erased by deleting the track — which was true while the count read
-- `tracks.taken_down_at`. Section 5 moves the count to the ledger, so the reason is gone
-- and the restriction now only stops somebody removing their own blocked upload from
-- their own profile. That is not a security property; it is an obstacle.
drop trigger if exists trg_tracks_block_taken_down_delete on public.tracks;
drop function if exists public.tracks_block_taken_down_delete();

-- ── 5. Strikes come from the ledger ────────────────────────────────────────
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

  -- From `moderation_actions`, not `tracks`: the ledger has no foreign keys and outlives
  -- both the track and any attempt to tidy it away. Restores are subtracted rather than
  -- ignored — a takedown that was reversed is not a strike, and counting it would punish
  -- somebody for an operator's own correction.
  return query
    select m.target_owner_id, p.username,
           count(*) filter (where m.action = 'takedown')
             - count(*) filter (where m.action = 'restore'),
           max(m.created_at) filter (where m.action = 'takedown')
      from public.moderation_actions m
      left join public.profiles p on p.id = m.target_owner_id
     where m.action in ('takedown', 'restore')
       and m.target_owner_id is not null
     group by m.target_owner_id, p.username
    having count(*) filter (where m.action = 'takedown')
         - count(*) filter (where m.action = 'restore') > 0
     order by 3 desc, 4 desc nulls last
     limit 200;
end;
$$;

revoke all on function public.ops_takedown_counts() from public;
revoke execute on function public.ops_takedown_counts() from anon;
grant execute on function public.ops_takedown_counts() to authenticated;

-- ── 6. Verify ───────────────────────────────────────────────────────────────
do $verify$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_removals'
      and cmd in ('INSERT', 'UPDATE')
  ) then
    raise exception 'VERIFY: a user could author the reason shown to them';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_removals' and cmd = 'DELETE'
  ) then
    raise exception 'VERIFY: a removal notice cannot be dismissed';
  end if;

  if has_function_privilege('authenticated',
       'public.notify_content_removed(uuid, text, text, text)', 'execute') then
    raise exception 'VERIFY: a client can post itself a content-removed notice';
  end if;

  -- Section 4 removed this deliberately. If it reappears, the uploader can no longer
  -- delete their own blocked track and section 5's reasoning has been undone.
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_tracks_block_taken_down_delete' and not tgisinternal
  ) then
    raise exception 'VERIFY: the delete block is back — strikes now live in the ledger';
  end if;
end
$verify$;
