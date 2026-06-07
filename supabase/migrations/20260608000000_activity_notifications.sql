-- Slice 3 — Activity Notification Center ("Livil" chat).
--
-- A per-user, in-app activity feed rendered chat-style in the Inbox. This is
-- NOT a Supabase conversation and there is NO "Livil" user row — it's a
-- dedicated notifications store. One row per user-facing event, except LIKE
-- events (aggregated per post) and PLAY milestones (one row per threshold).
--
-- Inserts are funnelled exclusively through the SECURITY DEFINER RPCs below,
-- which derive the recipient from a trusted server-side author lookup — so a
-- client can never notify an arbitrary user. The client gets only SELECT (own
-- rows) and UPDATE (own rows, for mark-read).

create table if not exists public.activity_notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type         text not null check (type in (
                 'like','comment','repost','play_milestone',
                 'new_fan','friend_accepted','friend_rejected')),
  -- the user who triggered the event (null for milestones)
  actor_id     uuid references public.profiles(id) on delete set null,
  -- the subject post, when applicable (like/comment/repost/milestone)
  post_id      uuid references public.posts(id) on delete cascade,
  -- dedup / aggregation key. like: 'like:'||post_id (one row per post);
  -- milestone: 'milestone:'||post_id||':'||threshold (one row per threshold).
  -- null = never aggregate (comment/repost/new_fan/friend outcomes).
  agg_key      text,
  -- aggregated actor count for like-style rows ("X and N others")
  agg_count    int not null default 1,
  -- extensible render payload; intrinsic data only (e.g. {threshold}).
  -- display fields (names/avatars/track) are hydrated at read time.
  payload      jsonb not null default '{}'::jsonb,
  is_read      boolean not null default false,
  created_at   timestamptz not null default now(),
  -- sort key: an aggregation bump sets updated_at = now() to re-sort to top.
  updated_at   timestamptz not null default now()
);

-- One aggregated row per (recipient, agg_key) when agg_key is set.
create unique index if not exists activity_notifications_agg_uq
  on public.activity_notifications (recipient_id, agg_key)
  where agg_key is not null;

-- Main feed query: a user's notifications newest-first.
create index if not exists activity_notifications_recipient_idx
  on public.activity_notifications (recipient_id, updated_at desc);

-- Unread badge count.
create index if not exists activity_notifications_unread_idx
  on public.activity_notifications (recipient_id) where is_read = false;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.activity_notifications enable row level security;

-- Read only your own.
drop policy if exists activity_notifications_select_own on public.activity_notifications;
create policy activity_notifications_select_own on public.activity_notifications
  for select to authenticated using (recipient_id = auth.uid());

-- Update only your own (mark-read). No insert policy — inserts go via RPCs only.
drop policy if exists activity_notifications_update_own on public.activity_notifications;
create policy activity_notifications_update_own on public.activity_notifications
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ── realtime (live unread badge) ─────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'activity_notifications'
  ) then
    alter publication supabase_realtime add table public.activity_notifications;
  end if;
end$$;

alter table public.activity_notifications replica identity full;

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- like / comment / repost on a post. Actor is auth.uid(); recipient is the
-- post's author (looked up server-side). Self-actions insert nothing.
create or replace function public.activity_notify_post(
  p_post_id uuid,
  p_type    text                 -- 'like' | 'comment' | 'repost'
) returns table (
  recipient_id          uuid,
  notification_id       uuid,
  agg_count             int,
  actor_display_name    text,
  recipient_should_push boolean
)
language plpgsql security definer set search_path = public as $$
-- OUT-param names (recipient_id, agg_count) collide with column names inside
-- the INSERT ... ON CONFLICT below; prefer the column in ambiguous references.
#variable_conflict use_column
declare
  v_actor   uuid := auth.uid();
  v_author  uuid;
  v_agg_key text;
  v_id      uuid;
  v_count   int;
  v_name    text;
begin
  if v_actor is null then return; end if;
  if p_type not in ('like','comment','repost') then return; end if;

  select author_id into v_author from posts where id = p_post_id;
  if v_author is null or v_author = v_actor then return; end if;  -- no self-notify

  select coalesce(display_name, '@' || username) into v_name
    from profiles where id = v_actor;

  if p_type = 'like' then
    v_agg_key := 'like:' || p_post_id::text;
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, updated_at)
    values
      (v_author, 'like', v_actor, p_post_id, v_agg_key, 1, now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = activity_notifications.agg_count + 1,
          actor_id   = excluded.actor_id,   -- latest liker becomes "X"
          is_read    = false,               -- resurface as unread
          updated_at = now()
    returning id, agg_count into v_id, v_count;
  else
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, updated_at)
    values
      (v_author, p_type, v_actor, p_post_id, now())
    returning id, 1 into v_id, v_count;
  end if;

  return query select v_author, v_id, v_count, v_name, true;
end;
$$;

-- Record a play (the real post_views insert, so trg_post_views_count still
-- fires), then detect whether this exact insert crossed a milestone on an
-- ORIGINAL post. Returns the new count plus the milestone recipient/threshold
-- when one fired (so the client can push). Never milestones self-plays/reposts.
create or replace function public.activity_record_play(p_post_id uuid)
returns table (
  views_count         int,
  milestone_recipient uuid,
  milestone_threshold int
)
language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_author     uuid;
  v_kind       text;
  v_count      int;
  v_threshold  int;
  v_thresholds int[] := array[5,25,100,500,1000,5000,10000];
  v_inserted   uuid;
begin
  if v_actor is null then return; end if;

  insert into post_views (post_id, user_id) values (p_post_id, v_actor);

  select author_id, kind, posts.views_count
    into v_author, v_kind, v_count
    from posts where id = p_post_id;

  if v_author is null then
    return query select coalesce(v_count, 0), null::uuid, null::int;
    return;
  end if;

  if v_kind = 'upload' and v_author <> v_actor then
    select t into v_threshold from unnest(v_thresholds) t where t = v_count limit 1;
    if v_threshold is not null then
      insert into activity_notifications
        (recipient_id, type, actor_id, post_id, agg_key, payload, updated_at)
      values
        (v_author, 'play_milestone', null, p_post_id,
         'milestone:' || p_post_id::text || ':' || v_threshold::text,
         jsonb_build_object('threshold', v_threshold), now())
      on conflict (recipient_id, agg_key) where agg_key is not null do nothing
      returning id into v_inserted;

      if v_inserted is not null then
        return query select v_count, v_author, v_threshold;
        return;
      end if;
    end if;
  end if;

  return query select v_count, null::uuid, null::int;
end;
$$;

-- New fan (someone starred you). Recipient is the starred user.
create or replace function public.activity_notify_new_fan(p_target uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null or p_target = v_me then return null; end if;
  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (p_target, 'new_fan', v_me, now())
  returning id into v_id;
  return v_id;
end;
$$;

-- Friend request outcome. Recipient is the original requester (p_other_user),
-- actor is the responder (auth.uid()).
create or replace function public.activity_notify_friend_outcome(
  p_other_user uuid, p_accepted boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null or p_other_user = v_me then return null; end if;
  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (
    p_other_user,
    case when p_accepted then 'friend_accepted' else 'friend_rejected' end,
    v_me, now()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- The caller's feed, newest-first, with display fields hydrated so payloads
-- never go stale. "artist" is not a tracks column — the card shows the track
-- title; the artist of an upload is the recipient themselves.
create or replace function public.activity_list(
  p_limit int default 50,
  p_before timestamptz default null
) returns table (
  id                 uuid,
  type               text,
  actor_id           uuid,
  post_id            uuid,
  agg_count          int,
  is_read            boolean,
  created_at         timestamptz,
  updated_at         timestamptz,
  payload            jsonb,
  actor_username     text,
  actor_display_name text,
  actor_avatar_url   text,
  post_title         text,
  post_cover_art_url text
) language sql security definer set search_path = public as $$
  select
    n.id, n.type, n.actor_id, n.post_id, n.agg_count, n.is_read,
    n.created_at, n.updated_at, n.payload,
    a.username, a.display_name, a.avatar_url,
    t.title, t.cover_art_url
  from activity_notifications n
  left join profiles a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  left join tracks t on t.id = p.track_id
  where n.recipient_id = auth.uid()
    and (p_before is null or n.updated_at < p_before)
  order by n.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.activity_unread_count()
returns int
language sql security definer set search_path = public as $$
  select count(*)::int from activity_notifications
   where recipient_id = auth.uid() and is_read = false;
$$;

create or replace function public.activity_mark_all_read()
returns void
language sql security definer set search_path = public as $$
  update activity_notifications set is_read = true
   where recipient_id = auth.uid() and is_read = false;
$$;

create or replace function public.activity_mark_read(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  update activity_notifications set is_read = true
   where id = p_id and recipient_id = auth.uid();
$$;
