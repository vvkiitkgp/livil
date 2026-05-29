-- ─────────────────────────────────────────────────────────────────────────────
-- Chat + Jam Room schema
-- Phase 1: conversations, conversation_members, messages, message_reactions
-- Phase 3: jam_rooms, jam_room_members, jam_queue
-- Also adds last_seen_at + show_activity to profiles for presence/now-playing
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Profiles: presence + privacy columns ──────────────────────────────────────
alter table profiles add column if not exists last_seen_at  timestamptz;
alter table profiles add column if not exists show_activity boolean default true;

-- ── Conversations ─────────────────────────────────────────────────────────────
create table conversations (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('dm', 'group')),
  name                 text,
  avatar_url           text,
  created_by           uuid references profiles(id) on delete set null,
  last_message_at      timestamptz,
  last_message_preview text,
  created_at           timestamptz default now()
);

-- ── Conversation members ──────────────────────────────────────────────────────
create table conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id         uuid references profiles(id)      on delete cascade,
  role            text default 'member' check (role in ('admin', 'member')),
  last_read_at    timestamptz default now(),
  joined_at       timestamptz default now(),
  primary key (conversation_id, user_id)
);

-- ── Messages ──────────────────────────────────────────────────────────────────
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  sender_id       uuid references profiles(id),
  kind            text default 'text'
                  check (kind in ('text', 'track_share', 'jam_invite', 'sticker', 'system')),
  body            text,
  -- track_share: { track_id, post_id, title, artist_name, cover_art_url }
  -- jam_invite:  { jam_room_id }
  -- sticker:     { sticker_id, sticker_url }
  -- system:      { event: 'joined'|'left'|'jam_started'|'jam_ended', user_id }
  metadata        jsonb,
  reply_to_id     uuid references messages(id),
  created_at      timestamptz default now(),
  deleted_at      timestamptz
);

-- ── Message reactions ─────────────────────────────────────────────────────────
create table message_reactions (
  message_id  uuid references messages(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz default now(),
  primary key (message_id, user_id, emoji)
);

-- ── Jam rooms ─────────────────────────────────────────────────────────────────
create table jam_rooms (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid references conversations(id) on delete cascade,
  host_id              uuid references profiles(id),
  status               text default 'active' check (status in ('active', 'ended')),
  current_track_id     uuid references tracks(id),
  playback_position_ms bigint default 0,
  is_playing           boolean default false,
  host_clock_at        timestamptz,
  started_at           timestamptz default now(),
  ended_at             timestamptz
);

-- ── Jam room members ──────────────────────────────────────────────────────────
create table jam_room_members (
  jam_room_id uuid references jam_rooms(id) on delete cascade,
  user_id     uuid references profiles(id)  on delete cascade,
  role        text default 'listener' check (role in ('host', 'listener')),
  -- can_play_pause: affects everyone's playback
  -- can_seek: scrub the shared timeline
  -- can_skip: skip to next queued track
  -- can_change_track: load any track (co-host only)
  -- can_suggest: add to queue (always true for active listeners)
  permissions jsonb default '{"can_play_pause":false,"can_seek":false,"can_skip":false,"can_change_track":false,"can_suggest":true}'::jsonb,
  joined_at   timestamptz default now(),
  primary key (jam_room_id, user_id)
);

-- ── Jam queue ─────────────────────────────────────────────────────────────────
create table jam_queue (
  id           uuid primary key default gen_random_uuid(),
  jam_room_id  uuid references jam_rooms(id) on delete cascade,
  track_id     uuid references tracks(id),
  suggested_by uuid references profiles(id),
  position     integer,
  upvotes      integer default 0,
  added_at     timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index on messages(conversation_id, created_at desc);
create index on conversation_members(user_id);
create index on jam_rooms(conversation_id) where status = 'active';
create index on jam_queue(jam_room_id, position);
create index on message_reactions(message_id);

-- ── assert_friendship: called before creating a DM ───────────────────────────
create or replace function assert_friendship(a uuid, b uuid)
returns void
language plpgsql
security definer
as $$
begin
  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and (
        (user_a_id = a and user_b_id = b)
        or
        (user_a_id = b and user_b_id = a)
      )
  ) then
    raise exception 'not_friends';
  end if;
end;
$$;

-- ── get_or_create_dm: idempotent DM creation ─────────────────────────────────
create or replace function get_or_create_dm(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  perform assert_friendship(user_a, user_b);

  select cm1.conversation_id into v_id
  from conversation_members cm1
  join conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
  join conversations c on c.id = cm1.conversation_id
  where cm1.user_id = user_a
    and cm2.user_id = user_b
    and c.kind = 'dm'
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into conversations (kind, created_by)
  values ('dm', user_a)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role)
  values
    (v_id, user_a, 'admin'),
    (v_id, user_b, 'member');

  return v_id;
end;
$$;

-- ── Trigger: update last_message_at + preview on new message ─────────────────
create or replace function update_conversation_last_message()
returns trigger
language plpgsql
security definer
as $$
begin
  update conversations
  set
    last_message_at      = new.created_at,
    last_message_preview = case
      when new.kind = 'text'        then left(new.body, 80)
      when new.kind = 'track_share' then '🎵 Shared a track'
      when new.kind = 'jam_invite'  then '🎶 Started a Jam Room'
      when new.kind = 'sticker'     then '🖼 Sent a sticker'
      when new.kind = 'system'      then null
      else left(new.body, 80)
    end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger after_message_insert
after insert on messages
for each row
when (new.deleted_at is null and new.kind != 'system')
execute function update_conversation_last_message();

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table conversations        enable row level security;
alter table conversation_members enable row level security;
alter table messages             enable row level security;
alter table message_reactions    enable row level security;
alter table jam_rooms            enable row level security;
alter table jam_room_members     enable row level security;
alter table jam_queue            enable row level security;

-- conversations
create policy "conv_select" on conversations for select
  using (exists (
    select 1 from conversation_members
    where conversation_id = conversations.id and user_id = auth.uid()
  ));

create policy "conv_insert" on conversations for insert
  with check (created_by = auth.uid());

create policy "conv_update" on conversations for update
  using (exists (
    select 1 from conversation_members
    where conversation_id = conversations.id
      and user_id = auth.uid() and role = 'admin'
  ));

-- Helper that checks membership without triggering its own RLS policy (avoids infinite recursion)
create or replace function is_conversation_member(conv_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = conv_id and user_id = auth.uid()
  );
$$;

-- conversation_members
create policy "members_select" on conversation_members for select
  using (is_conversation_member(conversation_id));

create policy "members_insert" on conversation_members for insert
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
        and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

create policy "members_update" on conversation_members for update
  using (user_id = auth.uid());

create policy "members_delete" on conversation_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
        and cm.user_id = auth.uid() and cm.role = 'admin'
    )
  );

-- messages
create policy "msg_select" on messages for select
  using (exists (
    select 1 from conversation_members
    where conversation_id = messages.conversation_id and user_id = auth.uid()
  ));

create policy "msg_insert" on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversation_members
      where conversation_id = messages.conversation_id and user_id = auth.uid()
    )
  );

create policy "msg_update" on messages for update
  using (sender_id = auth.uid());

-- message_reactions
create policy "rxn_select" on message_reactions for select
  using (exists (
    select 1 from messages m
    join conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_reactions.message_id and cm.user_id = auth.uid()
  ));

create policy "rxn_insert" on message_reactions for insert
  with check (user_id = auth.uid());

create policy "rxn_delete" on message_reactions for delete
  using (user_id = auth.uid());

-- jam_rooms
create policy "jam_select" on jam_rooms for select
  using (exists (
    select 1 from conversation_members
    where conversation_id = jam_rooms.conversation_id and user_id = auth.uid()
  ));

create policy "jam_insert" on jam_rooms for insert
  with check (
    host_id = auth.uid()
    and exists (
      select 1 from conversation_members
      where conversation_id = jam_rooms.conversation_id and user_id = auth.uid()
    )
  );

create policy "jam_update" on jam_rooms for update
  using (host_id = auth.uid());

-- jam_room_members
create policy "jmem_select" on jam_room_members for select
  using (exists (
    select 1 from jam_rooms jr
    join conversation_members cm on cm.conversation_id = jr.conversation_id
    where jr.id = jam_room_members.jam_room_id and cm.user_id = auth.uid()
  ));

create policy "jmem_insert" on jam_room_members for insert
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from jam_rooms
      where id = jam_room_members.jam_room_id and host_id = auth.uid()
    )
  );

create policy "jmem_update" on jam_room_members for update
  using (
    exists (
      select 1 from jam_rooms
      where id = jam_room_members.jam_room_id and host_id = auth.uid()
    )
    or user_id = auth.uid()
  );

create policy "jmem_delete" on jam_room_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from jam_rooms
      where id = jam_room_members.jam_room_id and host_id = auth.uid()
    )
  );

-- jam_queue
create policy "jq_select" on jam_queue for select
  using (exists (
    select 1 from jam_room_members
    where jam_room_id = jam_queue.jam_room_id and user_id = auth.uid()
  ));

create policy "jq_insert" on jam_queue for insert
  with check (
    suggested_by = auth.uid()
    and exists (
      select 1 from jam_room_members
      where jam_room_id = jam_queue.jam_room_id and user_id = auth.uid()
    )
  );

create policy "jq_delete" on jam_queue for delete
  using (
    suggested_by = auth.uid()
    or exists (
      select 1 from jam_rooms
      where id = jam_queue.jam_room_id and host_id = auth.uid()
    )
  );

-- ── list_my_conversations: inbox query ───────────────────────────────────────
create or replace function list_my_conversations()
returns table (
  id                   uuid,
  kind                 text,
  name                 text,
  avatar_url           text,
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         bigint,
  other_user_id        uuid,
  other_user_username  text,
  other_user_name      text,
  other_user_avatar    text,
  other_user_online    boolean
)
language sql
security definer
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.avatar_url,
    c.last_message_at,
    c.last_message_preview,
    (
      select count(*) from messages m
      where m.conversation_id = c.id
        and m.created_at > cm_me.last_read_at
        and m.sender_id != auth.uid()
        and m.deleted_at is null
    ) as unread_count,
    case when c.kind = 'dm' then p.id          end as other_user_id,
    case when c.kind = 'dm' then p.username    end as other_user_username,
    case when c.kind = 'dm' then p.display_name end as other_user_name,
    case when c.kind = 'dm' then p.avatar_url  end as other_user_avatar,
    case when c.kind = 'dm' then
      (p.show_activity = true and p.last_seen_at > now() - interval '3 minutes')
    end as other_user_online
  from conversations c
  join conversation_members cm_me
    on cm_me.conversation_id = c.id and cm_me.user_id = auth.uid()
  left join conversation_members cm_other
    on cm_other.conversation_id = c.id and cm_other.user_id != auth.uid() and c.kind = 'dm'
  left join profiles p on p.id = cm_other.user_id
  order by c.last_message_at desc nulls last, c.created_at desc;
$$;
