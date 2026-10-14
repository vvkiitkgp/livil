-- ============================================================================
-- Scheduled pushes: mood nudges + repost digests, written and switched from ops
-- ============================================================================
-- Four notifications a day at fixed India times, each sent only when it has something
-- to say:
--
--   08:00 IST  mood_morning    "Ssup, music buddy? 👀" — skipped if you posted today
--   11:00 IST  digest_morning  "Arjun, Kavya and 10 others" / "reposted 18 songs since
--                              last night" — skipped when nobody you can see reposted
--   18:00 IST  digest_evening  same, counting reposts since the 11:00 digest
--   20:00 IST  mood_evening    "Hey, are you okay? 🫶" — skipped if you posted today
--
-- The WORDING is data, not code: `push_messages` holds every message and ops edits it
-- from the dashboard (RLS: is_ops()), so changing a line ships nothing. Each slot rotates
-- through its pool's active messages in `position` order.
--
-- ── HOW A SEND FLOWS ────────────────────────────────────────────────────────
--   pg_cron → push_run_slot(slot)        picks the message, queues one push_deliveries
--                                        row per recipient with the FINAL text (digest
--                                        names and counts filled in here, under the
--                                        same visibility rule as the posts policy)
--           → net.http_post → send-push  {"scheduledSendId": …}: the function claims the
--                                        queued rows and sends them through FCM, exactly
--                                        like every other push (same token handling,
--                                        same pruning, same iOS badge)
--   pg_cron → push_maintain()            every 15 min: re-dispatches a send whose rows
--                                        are still queued (function was down), expires
--                                        ones over an hour old, fills `came_back`, and
--                                        purges rows past retention
--
-- The function never decides who or what: it sends rows this file wrote. A caller who
-- invents a `scheduledSendId` claims nothing — the ids are unguessable and the tables are
-- deny-all — and a real id can only make already-queued rows go out once, which is what
-- was going to happen anyway.
--
-- ── WHAT IS MEASURED ────────────────────────────────────────────────────────
--   sent       FCM accepted it for at least one of the recipient's devices.
--   opened     the recipient TAPPED it — push_record_open(), called with the push's
--              `pushId` (this row's id) by the app release that knows that key. Older
--              apps never report a tap.
--   came_back  the recipient had Livil open within an hour of the send, read from
--              user_last_seen (every app version stamps it while foregrounded). A proxy:
--              someone already in the app at send time counts too.
--
-- ── SWITCHED OFF UNTIL OPS TURNS THEM ON ────────────────────────────────────
-- Every slot starts DISABLED. Applying this sends nothing. Ops turns a slot on from the
-- dashboard. The MOOD slots must stay off until the app release with the "Mood
-- reminders" switch is out: App Store guideline 4.5.4 requires an in-app opt-out for
-- this kind of message (the switch is `notification_preferences.reminders`, added here,
-- default on).
--
-- ── PRODUCTION ──────────────────────────────────────────────────────────────
-- Additive: new tables, functions and cron jobs no shipped app knows about, plus one
-- new notification_preferences column with a default (inserts from old apps, which do
-- not send it, keep working). Needs pg_cron (installed) and pg_net (created below when
-- the platform offers it). Safe to apply before the send-push deploy: with every slot
-- off, nothing is queued, and a queued send whose function call fails is retried by
-- push_maintain and expires after an hour.
-- ============================================================================

-- ── 0. The scheduler and the HTTP client must exist ─────────────────────────
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not installed — enable it (Database → Extensions → pg_cron) first';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net is not installed — enable it (Database → Extensions → pg_net) first';
  end if;
end $$;

-- ── 1. The recipient's switch for mood nudges ───────────────────────────────
-- Digests follow the existing `activity` switch (they are about other people's activity,
-- like a like or a repost). Mood nudges are Livil's own and get their own switch, which
-- the next app release shows in Notification settings. Default on; an old app's upsert,
-- which does not send this column, leaves it alone.
alter table public.notification_preferences
  add column if not exists reminders boolean not null default true;

-- ── 2. The messages ops can edit ────────────────────────────────────────────
create table if not exists public.push_messages (
  id         uuid primary key default gen_random_uuid(),
  pool       text not null check (pool in ('mood_morning', 'mood_evening', 'digest')),
  position   integer not null check (position between 1 and 999),
  title      text not null check (char_length(title) between 1 and 80),
  body       text not null check (char_length(body) between 1 and 200),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  unique (pool, position),
  -- Digest lines may use exactly these fill-ins; any other brace is a typo that would
  -- reach phones verbatim. Mood lines have nothing to fill in, so no braces at all.
  constraint push_messages_fill_ins check (
    case when pool = 'digest'
      then regexp_replace(title || body, '\{(names|songs|since)\}', '', 'g') !~ '[{}]'
      else (title || body) !~ '[{}]'
    end
  )
);
alter table public.push_messages enable row level security;
revoke all on public.push_messages from anon, authenticated;
grant select, insert, update on public.push_messages to authenticated;

-- Ops only, and no DELETE: a message that has been sent is what the stats are about, so
-- it is switched off (active = false), never removed.
drop policy if exists push_messages_ops_select on public.push_messages;
create policy push_messages_ops_select on public.push_messages
  for select to authenticated using (public.is_ops());
drop policy if exists push_messages_ops_insert on public.push_messages;
create policy push_messages_ops_insert on public.push_messages
  for insert to authenticated with check (public.is_ops());
drop policy if exists push_messages_ops_update on public.push_messages;
create policy push_messages_ops_update on public.push_messages
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

create or replace function public.push_messages_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    -- Which pool a message belongs to is part of what its stats mean; moving a sent
    -- message to another pool would rewrite history. Make a new one instead.
    new.pool := old.pool;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists push_messages_stamp on public.push_messages;
create trigger push_messages_stamp
  before insert or update on public.push_messages
  for each row execute function public.push_messages_stamp();

-- ── 3. The four slots and their switches ────────────────────────────────────
create table if not exists public.push_slots (
  slot          text primary key
                check (slot in ('mood_morning', 'digest_morning', 'digest_evening', 'mood_evening')),
  pool          text not null check (pool in ('mood_morning', 'mood_evening', 'digest')),
  send_at_ist   time not null,
  enabled       boolean not null default false,
  last_position integer not null default 0,
  updated_at    timestamptz not null default now()
);
alter table public.push_slots enable row level security;
revoke all on public.push_slots from anon, authenticated;
-- Ops may read every slot and flip `enabled` — nothing else (the column grant is the
-- limit; the policies are the who).
grant select on public.push_slots to authenticated;
grant update (enabled) on public.push_slots to authenticated;
drop policy if exists push_slots_ops_select on public.push_slots;
create policy push_slots_ops_select on public.push_slots
  for select to authenticated using (public.is_ops());
drop policy if exists push_slots_ops_update on public.push_slots;
create policy push_slots_ops_update on public.push_slots
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

insert into public.push_slots (slot, pool, send_at_ist) values
  ('mood_morning',   'mood_morning', '08:00'),
  ('digest_morning', 'digest',       '11:00'),
  ('digest_evening', 'digest',       '18:00'),
  ('mood_evening',   'mood_evening', '20:00')
on conflict (slot) do nothing;

-- ── 4. What was sent, to whom, and what happened ────────────────────────────
create table if not exists public.push_sends (
  id         uuid primary key default gen_random_uuid(),
  slot       text not null check (slot in ('mood_morning', 'digest_morning', 'digest_evening',
                                           'mood_evening', 'test')),
  kind       text not null check (kind in ('mood_nudge', 'repost_digest')),
  message_id uuid references public.push_messages(id) on delete set null,
  recipients integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.push_sends enable row level security;
revoke all on public.push_sends from anon, authenticated;
create index if not exists push_sends_created_idx on public.push_sends (created_at desc);

create table if not exists public.push_deliveries (
  id           uuid primary key default gen_random_uuid(),
  send_id      uuid not null references public.push_sends(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  body         text not null,
  -- The first named person's photo (digests only). send-push re-checks it against its
  -- own allow-list before a phone ever fetches it.
  avatar_url   text,
  status       text not null default 'queued'
               check (status in ('queued', 'sending', 'sent', 'failed', 'expired')),
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  opened_at    timestamptz,
  came_back    boolean,
  unique (send_id, recipient_id)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
create index if not exists push_deliveries_send_idx on public.push_deliveries (send_id, status);
create index if not exists push_deliveries_recipient_idx on public.push_deliveries (recipient_id);
create index if not exists push_deliveries_pending_idx on public.push_deliveries (created_at)
  where status in ('queued', 'sending') or (status = 'sent' and came_back is null);

-- Where the scheduler reaches send-push. The key is the PUBLIC anon key the app ships
-- (lib/supabase.ts) — it only gets the call past the gateway's JWT check; send-push
-- itself decides what a scheduled call may do. Deny-all to clients.
create table if not exists public.push_config (
  id           integer primary key default 1 check (id = 1),
  function_url text not null,
  anon_key     text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (id, function_url, anon_key) values (
  1,
  'https://fqzrmqnlgjeuxzinbqvs.supabase.co/functions/v1/send-push',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxenJtcW5sZ2pldXh6aW5icXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjQwNDYsImV4cCI6MjA5OTAwMDA0Nn0.lM3_oFmNmNL9vyjI1bAuBON_P1rAJolgocB0HWmDCmo'
)
on conflict (id) do update
  set function_url = excluded.function_url, anon_key = excluded.anon_key;

-- ── 5. Filling in a digest ──────────────────────────────────────────────────
-- "18 songs" / "1 song", and the names line: "Riya", "Riya and Sam",
-- "Riya, Sam and 1 other", "Riya, Sam and 10 others".
create or replace function public.push_render(
  p_template text, p_names text, p_songs integer, p_since text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(replace(p_template,
    '{names}', coalesce(p_names, '')),
    '{songs}', coalesce(p_songs, 0) || case when p_songs = 1 then ' song' else ' songs' end),
    '{since}', coalesce(p_since, ''));
$$;

-- What one person's digest says: the reposts in [p_since, p_until) that THEY may see,
-- under the same predicate as posts_select_authenticated (20261019000000) — not blocked
-- either way, and the reposter shows reposts to everyone OR is their friend — minus their
-- own. Named in order: friends, then people they star, then everyone else; most recent
-- first within each. A name is the display name, else @username, like the Activity rows.
create or replace function public.push_digest_for(
  p_viewer uuid, p_since timestamptz, p_until timestamptz
)
returns table (songs integer, people integer, names text, avatar_url text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with seen as (
    select r.author_id, r.created_at
      from public.posts r
     where r.kind = 'repost'
       and r.created_at >= p_since and r.created_at < p_until
       and r.author_id <> p_viewer
       and not public.is_blocked_between(p_viewer, r.author_id)
       and (public.reposts_public(r.author_id) or public.are_friends(p_viewer, r.author_id))
  ),
  who as (
    select s.author_id,
           max(s.created_at) as latest,
           case when public.are_friends(p_viewer, s.author_id) then 0
                when exists (select 1 from public.follows f
                              where f.follower_id = p_viewer and f.following_id = s.author_id) then 1
                else 2 end as closeness
      from seen s
     group by s.author_id
  ),
  named as (
    select coalesce(nullif(btrim(p.display_name), ''), '@' || p.username) as name,
           p.avatar_url,
           row_number() over (order by w.closeness, w.latest desc, w.author_id) as n
      from who w
      join public.profiles p on p.id = w.author_id
  )
  select (select count(*)::int from seen),
         (select count(*)::int from who),
         case (select count(*) from who)
           when 0 then null
           when 1 then (select name from named where n = 1)
           when 2 then (select name from named where n = 1) || ' and ' || (select name from named where n = 2)
           else (select name from named where n = 1) || ', ' || (select name from named where n = 2)
                || ' and ' || ((select count(*) from who) - 2)
                || case when (select count(*) from who) - 2 = 1 then ' other' else ' others' end
         end,
         (select avatar_url from named where n = 1);
$$;

-- Hands a queued send to send-push. pg_net is asynchronous: the request leaves after this
-- transaction commits, so the rows it names are visible to the function by then.
create or replace function public.push_dispatch(p_send_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cfg public.push_config;
begin
  select * into v_cfg from public.push_config where id = 1;
  if v_cfg.function_url is null then
    raise warning 'push_dispatch: push_config is empty; send % stays queued', p_send_id;
    return;
  end if;
  perform net.http_post(
    url := v_cfg.function_url,
    body := jsonb_build_object('scheduledSendId', p_send_id),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.anon_key,
      'apikey', v_cfg.anon_key),
    timeout_milliseconds := 30000
  );
end;
$$;

-- ── 6. Running a slot ───────────────────────────────────────────────────────
-- Called by pg_cron at the slot's time. Returns the send it queued, or null when the slot
-- is off, its pool has no active message, or nobody qualifies.
create or replace function public.push_run_slot(p_slot text)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_slot   public.push_slots;
  v_msg    public.push_messages;
  v_send   uuid;
  v_count  integer;
  v_kind   text;
  v_since  timestamptz;
  v_word   text;
  v_today  timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
  -- Locked so two runs of one slot (a retried cron tick) cannot both rotate and send.
  select * into v_slot from public.push_slots where slot = p_slot for update;
  if not found or not v_slot.enabled then
    return null;
  end if;

  -- The next active message after the last one this slot sent, wrapping to the first.
  select * into v_msg
    from public.push_messages m
   where m.pool = v_slot.pool and m.active
   order by (m.position <= v_slot.last_position), m.position
   limit 1;
  if not found then
    return null;
  end if;

  v_kind := case when v_slot.pool = 'digest' then 'repost_digest' else 'mood_nudge' end;
  insert into public.push_sends (slot, kind, message_id)
  values (p_slot, v_kind, v_msg.id)
  returning id into v_send;

  if v_kind = 'mood_nudge' then
    -- Everyone with a phone and the reminders switch on, except people who already
    -- posted or reposted today (India time).
    insert into public.push_deliveries (send_id, recipient_id, title, body)
    select v_send, p.id, v_msg.title, v_msg.body
      from public.profiles p
     where exists (select 1 from public.device_tokens t where t.user_id = p.id)
       and coalesce((select np.reminders from public.notification_preferences np
                      where np.user_id = p.id), true)
       and not exists (select 1 from public.posts x
                        where x.author_id = p.id and x.created_at >= v_today);
  else
    -- Since the previous digest, whichever slot sent it; at most a day back, so a digest
    -- switched on after a week off does not announce a week of reposts as "since last night".
    select greatest(coalesce(max(s.created_at), now() - interval '12 hours'),
                    now() - interval '24 hours')
      into v_since
      from public.push_sends s
     where s.slot in ('digest_morning', 'digest_evening') and s.id <> v_send;
    v_word := case when p_slot = 'digest_morning' then 'since last night' else 'today' end;

    insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
    select v_send, p.id,
           public.push_render(v_msg.title, d.names, d.songs, v_word),
           public.push_render(v_msg.body,  d.names, d.songs, v_word),
           d.avatar_url
      from public.profiles p
      cross join lateral public.push_digest_for(p.id, v_since, now()) d
     where exists (select 1 from public.device_tokens t where t.user_id = p.id)
       and coalesce((select np.activity from public.notification_preferences np
                      where np.user_id = p.id), true)
       and d.songs > 0;
  end if;

  get diagnostics v_count = row_count;
  update public.push_sends set recipients = v_count where id = v_send;
  update public.push_slots set last_position = v_msg.position, updated_at = now()
   where slot = p_slot;

  if v_count > 0 then
    perform public.push_dispatch(v_send);
  end if;
  return v_send;
end;
$$;

-- ── 7. Every 15 minutes: retry, expire, measure, forget ─────────────────────
create or replace function public.push_maintain()
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_send uuid;
begin
  -- A send whose rows are still queued two minutes on: the function was down or the call
  -- was lost. Ask again; the claim in send-push makes a double call harmless.
  for v_send in
    select distinct d.send_id
      from public.push_deliveries d
     where d.status = 'queued'
       and d.created_at < now() - interval '2 minutes'
       and d.created_at > now() - interval '1 hour'
  loop
    perform public.push_dispatch(v_send);
  end loop;

  -- An hour late is too late for "8 AM": drop it rather than buzz someone mid-morning.
  -- `sending` an hour on means the function died mid-send; those are not retried either.
  update public.push_deliveries
     set status = 'expired'
   where status in ('queued', 'sending')
     and created_at < now() - interval '1 hour';

  -- Came back within the hour: user_last_seen is stamped every few minutes while the app
  -- is open, so once the hour has passed, a stamp at or after the send means they did.
  update public.push_deliveries d
     set came_back = coalesce((select ls.last_seen_at >= d.sent_at
                                 from public.user_last_seen ls
                                where ls.user_id = d.recipient_id), false)
   where d.status = 'sent'
     and d.came_back is null
     and d.sent_at < now() - interval '1 hour';

  -- Retention: who received what is kept 90 days, the per-send summary a year.
  delete from public.push_deliveries where created_at < now() - interval '90 days';
  delete from public.push_sends where created_at < now() - interval '365 days';
end;
$$;

-- ── 8. The app reports a tap (from the release that knows `pushId`) ────────
create or replace function public.push_record_open(p_delivery_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.push_deliveries
     set opened_at = now()
   where id = p_delivery_id
     and recipient_id = auth.uid()
     and opened_at is null;
$$;

-- ── 9. Ops: the numbers, and "send it to me" ────────────────────────────────
-- Every message with what it did in the window. Test sends are left out.
create or replace function public.ops_push_message_stats(p_days integer default 14)
returns table (
  message_id uuid, pool text, "position" integer, title text, body text, active boolean,
  updated_at timestamptz, sends bigint, delivered bigint, opened bigint, came_back bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_ops() then
    return;
  end if;
  p_days := least(greatest(coalesce(p_days, 14), 1), 365);

  return query
  select m.id, m.pool, m.position, m.title, m.body, m.active, m.updated_at,
         count(distinct s.id),
         count(d.id) filter (where d.status = 'sent'),
         count(d.id) filter (where d.opened_at is not null),
         count(d.id) filter (where d.came_back)
    from public.push_messages m
    left join public.push_sends s
      on s.message_id = m.id and s.slot <> 'test'
     and s.created_at >= now() - make_interval(days => p_days)
    left join public.push_deliveries d on d.send_id = s.id
   group by m.id
   order by m.pool, m.position;
end;
$$;

-- The latest sends, newest first, with one recipient's text as an example (a digest reads
-- differently for every person; the example is never matched to who received it).
create or replace function public.ops_push_recent_sends(p_limit integer default 20)
returns table (
  send_id uuid, slot text, kind text, created_at timestamptz, message_id uuid,
  "position" integer, example_title text, example_body text,
  recipients integer, delivered bigint, opened bigint, came_back bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_ops() then
    return;
  end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return query
  select s.id, s.slot, s.kind, s.created_at, s.message_id, m.position,
         (select d.title from public.push_deliveries d where d.send_id = s.id
           order by d.created_at, d.id limit 1),
         (select d.body from public.push_deliveries d where d.send_id = s.id
           order by d.created_at, d.id limit 1),
         s.recipients,
         (select count(*) from public.push_deliveries d where d.send_id = s.id and d.status = 'sent'),
         (select count(*) from public.push_deliveries d where d.send_id = s.id and d.opened_at is not null),
         (select count(*) from public.push_deliveries d where d.send_id = s.id and d.came_back)
    from public.push_sends s
    left join public.push_messages m on m.id = s.message_id
   order by s.created_at desc
   limit p_limit;
end;
$$;

-- Sends one message to the operator's own phone, now — the way to see a line on a real
-- device before switching a slot on. Skip rules do not apply; a digest uses the operator's
-- own last 24 hours, or an example when there is nothing to count. Null when the operator
-- has no phone registered (or is not an operator).
create or replace function public.ops_push_test(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  v_msg   public.push_messages;
  v_send  uuid;
  v_d     record;
begin
  if not public.is_ops() or v_me is null then
    return null;
  end if;
  if not exists (select 1 from public.device_tokens t where t.user_id = v_me) then
    return null;
  end if;
  select * into v_msg from public.push_messages where id = p_message_id;
  if not found then
    return null;
  end if;

  insert into public.push_sends (slot, kind, message_id, recipients)
  values ('test', case when v_msg.pool = 'digest' then 'repost_digest' else 'mood_nudge' end,
          v_msg.id, 1)
  returning id into v_send;

  if v_msg.pool = 'digest' then
    select * into v_d from public.push_digest_for(v_me, now() - interval '24 hours', now());
    if coalesce(v_d.songs, 0) = 0 then
      select 18 as songs, 12 as people, 'Arjun, Kavya and 10 others' as names,
             null::text as avatar_url
        into v_d;
    end if;
    insert into public.push_deliveries (send_id, recipient_id, title, body, avatar_url)
    values (v_send, v_me,
            public.push_render(v_msg.title, v_d.names, v_d.songs, 'since last night'),
            public.push_render(v_msg.body,  v_d.names, v_d.songs, 'since last night'),
            v_d.avatar_url);
  else
    insert into public.push_deliveries (send_id, recipient_id, title, body)
    values (v_send, v_me, v_msg.title, v_msg.body);
  end if;

  perform public.push_dispatch(v_send);
  return v_send;
end;
$$;

-- ── 10. Who may call what ───────────────────────────────────────────────────
-- The scheduler's own functions: no client role, ever (cron runs them as the owner).
revoke all on function public.push_run_slot(text) from public;
revoke all on function public.push_run_slot(text) from anon, authenticated;
revoke all on function public.push_maintain() from public;
revoke all on function public.push_maintain() from anon, authenticated;
revoke all on function public.push_dispatch(uuid) from public;
revoke all on function public.push_dispatch(uuid) from anon, authenticated;
revoke all on function public.push_digest_for(uuid, timestamptz, timestamptz) from public;
revoke all on function public.push_digest_for(uuid, timestamptz, timestamptz) from anon, authenticated;
revoke all on function public.push_render(text, text, integer, text) from public;
revoke all on function public.push_render(text, text, integer, text) from anon, authenticated;
revoke all on function public.push_messages_stamp() from public;
revoke all on function public.push_messages_stamp() from anon, authenticated;

-- Signed-in users: report their own tap. Ops: the dashboard (empty / null for others).
revoke all on function public.push_record_open(uuid) from public;
revoke execute on function public.push_record_open(uuid) from anon;
grant execute on function public.push_record_open(uuid) to authenticated;
revoke all on function public.ops_push_message_stats(integer) from public;
revoke execute on function public.ops_push_message_stats(integer) from anon;
grant execute on function public.ops_push_message_stats(integer) to authenticated;
revoke all on function public.ops_push_recent_sends(integer) from public;
revoke execute on function public.ops_push_recent_sends(integer) from anon;
grant execute on function public.ops_push_recent_sends(integer) to authenticated;
revoke all on function public.ops_push_test(uuid) from public;
revoke execute on function public.ops_push_test(uuid) from anon;
grant execute on function public.ops_push_test(uuid) to authenticated;

-- ── 11. The messages to start with ──────────────────────────────────────────
-- Picked by the owner 2026-10-14. Editable from the dashboard from here on; re-running
-- this migration never overwrites an edited line (do nothing on conflict).
insert into public.push_messages (pool, position, title, body) values
  ('mood_morning', 1, 'Ssup, music buddy? 👀', 'What are you listening to right now? Don’t gatekeep the good stuff!'),
  ('mood_morning', 2, 'Hey, suggest me a song? 🥹', 'Need something new to listen to. Got a favourite you’d recommend? 🎶'),
  ('mood_morning', 3, 'Can I borrow your ears? 🥹', 'Recommend me a song I probably haven’t heard. Surprise me!'),
  ('mood_morning', 4, 'A little birdie asked… 🐦', 'What song would you send your best friend right now? Go share it. 💛'),
  ('mood_morning', 5, 'Your friends are listening 👀', 'Found a song that hits different? Repost it and let them in on it.'),
  ('mood_evening', 1, 'Hey, are you okay? 🫶', 'If words are hard today, maybe there’s a song that says it better. 🎧'),
  ('mood_evening', 2, 'Hey, you crossed my mind 💛', 'Sending you a tiny reminder to take a breath and play something you love.'),
  ('mood_evening', 3, 'Be honest with me 👀', 'What song describes your life right now? No explanations needed. Just the song. 🎶'),
  ('mood_evening', 4, 'Don’t keep the good stuff secret 🤫', 'That song you can’t stop listening to? Your friends need to hear it too.'),
  ('mood_evening', 5, 'Hey stranger, missed your taste 😌', 'Heard anything good lately? Your friends could use a new favourite.'),
  ('digest',       1, '{names}', 'reposted {songs} {since} · check them out')
on conflict (pool, position) do nothing;

-- ── 12. The schedule (UTC; India has no daylight saving) ────────────────────
select cron.schedule('push-mood-morning',   '30 2 * * *',  $$select public.push_run_slot('mood_morning')$$);
select cron.schedule('push-digest-morning', '30 5 * * *',  $$select public.push_run_slot('digest_morning')$$);
select cron.schedule('push-digest-evening', '30 12 * * *', $$select public.push_run_slot('digest_evening')$$);
select cron.schedule('push-mood-evening',   '30 14 * * *', $$select public.push_run_slot('mood_evening')$$);
select cron.schedule('push-maintain',       '*/15 * * * *', $$select public.push_maintain()$$);

-- ── 13. Self-checks ─────────────────────────────────────────────────────────
do $$
declare
  v_fn text;
begin
  if (select count(*) from cron.job where jobname in ('push-mood-morning', 'push-digest-morning',
        'push-digest-evening', 'push-mood-evening', 'push-maintain')) <> 5 then
    raise exception 'a scheduled-push cron job is missing';
  end if;
  if exists (select 1 from public.push_slots where enabled) then
    raise notice 'a scheduled-push slot is ON — this migration never turns one on; ops did';
  end if;
  foreach v_fn in array array[
    'public.push_run_slot(text)', 'public.push_maintain()', 'public.push_dispatch(uuid)',
    'public.push_digest_for(uuid,timestamptz,timestamptz)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '% is executable by a client role', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.ops_push_test(uuid)', 'execute') then
    raise exception 'ops_push_test is executable by anon';
  end if;
  if exists (select 1 from pg_class c where c.relname in
        ('push_sends', 'push_deliveries', 'push_config', 'push_messages', 'push_slots')
        and c.relnamespace = 'public'::regnamespace and not c.relrowsecurity) then
    raise exception 'a scheduled-push table has RLS off';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('push_sends', 'push_deliveries', 'push_config')) then
    raise exception 'push_sends / push_deliveries / push_config must have no policies (deny-all)';
  end if;
end $$;
