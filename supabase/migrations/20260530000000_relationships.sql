-- ─────────────────────────────────────────────────────────────────────────────
-- Friends + Stars relationship layer
-- Adds RLS on friendships/follows + 9 mutation/query RPCs + fans_seen_at.
-- Assumes friendships(user_a_id, user_b_id, requested_by, status, created_at,
-- accepted_at) and follows(follower_id, following_id, kind, created_at) tables
-- already exist (created via Supabase console earlier).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Profiles: track when viewer last dismissed the "new fans" banner ─────────
alter table profiles add column if not exists fans_seen_at timestamptz;

-- ── RLS: friendships ─────────────────────────────────────────────────────────
alter table friendships enable row level security;

drop policy if exists "friendships_select" on friendships;
create policy "friendships_select" on friendships for select
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "friendships_insert" on friendships;
create policy "friendships_insert" on friendships for insert
  with check (
    requested_by = auth.uid()
    and (user_a_id = auth.uid() or user_b_id = auth.uid())
    and user_a_id <> user_b_id
  );

drop policy if exists "friendships_update" on friendships;
create policy "friendships_update" on friendships for update
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

drop policy if exists "friendships_delete" on friendships;
create policy "friendships_delete" on friendships for delete
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- ── RLS: follows ─────────────────────────────────────────────────────────────
alter table follows enable row level security;

drop policy if exists "follows_select" on follows;
create policy "follows_select" on follows for select using (true);

drop policy if exists "follows_insert" on follows;
create policy "follows_insert" on follows for insert
  with check (follower_id = auth.uid() and follower_id <> following_id);

drop policy if exists "follows_delete" on follows;
create policy "follows_delete" on follows for delete
  using (follower_id = auth.uid());

-- ── Helper: normalize pair so the lower uuid is user_a_id ────────────────────
create or replace function _friendship_pair(a uuid, b uuid)
returns table (lo uuid, hi uuid)
language sql immutable as $$
  select case when a < b then a else b end,
         case when a < b then b else a end;
$$;

-- ── One-time normalization: ensure user_a_id < user_b_id on every row ────────
-- Existing rows were inserted in arbitrary order; new RPCs assume the lo/hi
-- form. Safe to run repeatedly — only swaps when out of order.
update friendships
   set user_a_id = user_b_id, user_b_id = user_a_id
 where user_a_id > user_b_id;

-- ── send_friend_request ──────────────────────────────────────────────────────
create or replace function send_friend_request(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_befriend_self'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, target_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'already_friends';
    end if;
    -- pending row already exists; idempotent no-op
    return;
  end if;

  insert into friendships (user_a_id, user_b_id, requested_by, status)
  values (v_lo, v_hi, me, 'pending');
end;
$$;

-- ── accept_friend_request ────────────────────────────────────────────────────
-- Accepts a pending request from other_user_id and atomically removes any
-- star edge in either direction (friend supersedes star).
create or replace function accept_friend_request(other_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi
   for update;

  if not found then raise exception 'no_pending_request'; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by = me then raise exception 'cannot_accept_own_request'; end if;

  update friendships
     set status = 'accepted', accepted_at = now()
   where user_a_id = v_lo and user_b_id = v_hi;

  delete from follows
   where kind = 'star'
     and ((follower_id = me and following_id = other_user_id)
       or (follower_id = other_user_id and following_id = me));
end;
$$;

-- ── reject_friend_request ────────────────────────────────────────────────────
create or replace function reject_friend_request(other_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if not found then return; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by = me then raise exception 'cannot_reject_own_request'; end if;

  delete from friendships where user_a_id = v_lo and user_b_id = v_hi;
end;
$$;

-- ── cancel_friend_request ────────────────────────────────────────────────────
create or replace function cancel_friend_request(other_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if not found then return; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by <> me then raise exception 'not_requester'; end if;

  delete from friendships where user_a_id = v_lo and user_b_id = v_hi;
end;
$$;

-- ── remove_friend ────────────────────────────────────────────────────────────
create or replace function remove_friend(other_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);
  delete from friendships
   where user_a_id = v_lo and user_b_id = v_hi
     and status = 'accepted';
end;
$$;

-- ── add_star ─────────────────────────────────────────────────────────────────
-- Rejects when an accepted friendship exists — UI surfaces a confirm modal.
create or replace function add_star(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_star_self'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, target_user_id);

  if exists (
    select 1 from friendships
     where user_a_id = v_lo and user_b_id = v_hi and status = 'accepted'
  ) then
    raise exception 'already_friends';
  end if;

  if exists (
    select 1 from follows
     where follower_id = me and following_id = target_user_id and kind = 'star'
  ) then return; end if;

  insert into follows (follower_id, following_id, kind)
  values (me, target_user_id, 'star');
end;
$$;

-- ── remove_star ──────────────────────────────────────────────────────────────
create or replace function remove_star(target_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  delete from follows
   where follower_id = me and following_id = target_user_id and kind = 'star';
end;
$$;

-- ── list_incoming_friend_requests ────────────────────────────────────────────
create or replace function list_incoming_friend_requests()
returns table (
  other_user_id uuid,
  username      text,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz
)
language sql
security definer
as $$
  select
    case when f.user_a_id = auth.uid() then f.user_b_id else f.user_a_id end as other_user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    f.created_at
  from friendships f
  join profiles p on p.id = case when f.user_a_id = auth.uid() then f.user_b_id else f.user_a_id end
  where f.status = 'pending'
    and (f.user_a_id = auth.uid() or f.user_b_id = auth.uid())
    and f.requested_by <> auth.uid()
  order by f.created_at desc;
$$;

-- ── get_new_fans_summary ─────────────────────────────────────────────────────
-- Returns count + up to 3 most recent fans since fans_seen_at.
create or replace function get_new_fans_summary()
returns table (
  total_count    bigint,
  recent_user_id uuid,
  username       text,
  display_name   text,
  avatar_url     text,
  created_at     timestamptz
)
language sql
security definer
as $$
  with seen as (
    select coalesce(fans_seen_at, 'epoch'::timestamptz) as ts
    from profiles where id = auth.uid()
  ),
  new_fans as (
    select f.follower_id, f.created_at
    from follows f, seen
    where f.following_id = auth.uid()
      and f.kind = 'star'
      and f.created_at > seen.ts
  )
  select
    (select count(*) from new_fans) as total_count,
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    nf.created_at
  from new_fans nf
  join profiles p on p.id = nf.follower_id
  order by nf.created_at desc
  limit 3;
$$;

-- ── mark_fans_seen ───────────────────────────────────────────────────────────
create or replace function mark_fans_seen()
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() is null then return; end if;
  update profiles set fans_seen_at = now() where id = auth.uid();
end;
$$;
