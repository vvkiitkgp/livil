-- ============================================================================
-- 5-minute photos and videos in chat
-- ============================================================================
--
-- Design: kb/debt/proposals/0011-disappearing-media-in-chat.md (PROP-0011).
--
-- A chat member sends a photo or a video. The FILE lives for exactly 5 minutes from the
-- moment the message is sent — opened or not — and is then deleted from Storage. The
-- message row and its metadata (type, size, dimensions, duration) stay forever, as does
-- the record of who saved it to their phone.
--
-- THE MESSAGE is an ordinary TEXT message (not a new `messages.kind`), exactly like GIFs:
--
--   body     '📷 Photo · Update Livil to view'  |  '🎬 Video · Update Livil to view'
--   metadata {"media": {"v": 1, "type": "photo"|"video", "object": "<conversation_id>/<uuid>.<ext>",
--                       "mime": …, "w": …, "h": …, "bytes": …, "duration_ms": … (video)}}
--
-- Every build in the stores renders `body` for a text message, so an old app shows the
-- upgrade line and has no way to the file. `metadata` is immutable after insert
-- (messages_freeze_identity, 20261107000000), and `created_at` is stamped by the server
-- (20261105000000), so EXPIRY = created_at + 5 minutes cannot be moved by a client and
-- needs no column of its own.
--
-- WHAT THIS ADDS
--
--   1. Bucket `chat-media`: PRIVATE. Members may upload into their conversation's folder;
--      nobody may read, change or delete by path. The bytes are reachable only through a
--      signed URL from the `chat-media` edge function, whose lifetime is the time left.
--   2. `chat_media_saves`: who saved which photo/video to their phone ("Saved to phone by").
--   3. message_preview(): the two upgrade lines read "📷 Sent a photo" / "🎬 Sent a video"
--      in the inbox.
--   4. The sweep: every minute, if the bucket holds anything older than 5 minutes, pg_cron
--      asks the edge function to delete it. Direct DELETE on storage.objects is refused by
--      Supabase, so the deletion itself goes through the Storage API in the function.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Additive only. The bucket, table, functions and cron job are new and no shipped build
-- references them. message_preview() gains two branches that match only the two new
-- labels, which no shipped build sends. Nothing existing is renamed, retyped or tightened.
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

-- ── 1. The bucket ───────────────────────────────────────────────────────────
-- 25 MB covers 10 s of phone video with room to spare; photos are re-encoded to ≤1600 px
-- JPEG by the app. QuickTime is what an iPhone records.
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage'
       and table_name   = 'buckets'
       and column_name  = 'file_size_limit'
  ) then
    update storage.buckets
       set public = false,
           file_size_limit = 26214400,
           allowed_mime_types = array['image/jpeg', 'video/mp4', 'video/quicktime']
     where id = 'chat-media';
  else
    update storage.buckets set public = false where id = 'chat-media';
  end if;
end $$;

-- May the caller upload this object? Its path must be `<conversation_id>/<uuid>.<ext>`, the
-- caller must be a member of that conversation and pass can_write_to_conversation() — the
-- test msg_insert uses, so a blocked or unfriended DM partner cannot upload either. The
-- path is checked with a regex BEFORE the cast, so a malformed name is a plain "no", never
-- a cast error.
create or replace function public.chat_media_can_upload(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation uuid;
begin
  if auth.uid() is null
     or p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|mov)$' then
    return false;
  end if;
  v_conversation := split_part(p_name, '/', 1)::uuid;
  return exists (
           select 1 from public.conversation_members cm
            where cm.conversation_id = v_conversation
              and cm.user_id = auth.uid()
         )
     and public.can_write_to_conversation(v_conversation);
end $$;

revoke all on function public.chat_media_can_upload(text) from public;
revoke execute on function public.chat_media_can_upload(text) from anon;
grant execute on function public.chat_media_can_upload(text) to authenticated;

-- Upload only. NO select / update / delete policy for clients, on purpose: nobody — members
-- included — can download, overwrite or remove by path. Drop-by-name first: policies OR
-- together, so a leftover permissive one would defeat this (ADR-0007).
drop policy if exists "chat_media_insert" on storage.objects;
drop policy if exists "chat_media_select" on storage.objects;
drop policy if exists "chat_media_update" on storage.objects;
drop policy if exists "chat_media_delete" on storage.objects;
create policy "chat_media_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and public.chat_media_can_upload(name)
  );

-- ── 2. Who saved it ─────────────────────────────────────────────────────────
create table if not exists public.chat_media_saves (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.chat_media_saves enable row level security;

-- Everyone in the chat sees who saved it (that is the point of the marker).
drop policy if exists "chat_media_saves_select" on public.chat_media_saves;
create policy "chat_media_saves_select" on public.chat_media_saves for select
  using (
    exists (
      select 1
        from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
       where m.id = chat_media_saves.message_id
         and cm.user_id = auth.uid()
    )
  );

-- A member other than the sender records their own save, while the file still exists:
-- 5 minutes plus 1 minute of clock grace (the app deletes its copy at 5). A modified client
-- can always save without recording it — the marker is what honest clients show.
drop policy if exists "chat_media_saves_insert" on public.chat_media_saves;
create policy "chat_media_saves_insert" on public.chat_media_saves for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
        from public.messages m
        join public.conversation_members cm on cm.conversation_id = m.conversation_id
       where m.id = chat_media_saves.message_id
         and cm.user_id = auth.uid()
         and m.sender_id is distinct from auth.uid()
         and m.deleted_at is null
         and m.metadata ? 'media'
         and now() < m.created_at + interval '6 minutes'
    )
  );

-- No update or delete: a save is a fact. New tables get no automatic grants (Supabase,
-- 2026-10-30), so grant exactly what the app does.
grant select, insert on public.chat_media_saves to authenticated;
grant select, insert, delete on public.chat_media_saves to service_role;

create index if not exists chat_media_saves_message_idx on public.chat_media_saves (message_id);

-- Realtime, so "Saved to phone by" appears for the sender while the chat is open. Delivery
-- is filtered by the select policy above for every subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_media_saves'
  ) then
    alter publication supabase_realtime add table public.chat_media_saves;
  end if;
end $$;

-- ── 3. Inbox preview ────────────────────────────────────────────────────────
-- Copies 20261017000000 exactly and adds two branches to the `text` case: a body that is
-- exactly one of the upgrade lines (src/utils/chatMedia.ts) becomes "📷 Sent a photo" /
-- "🎬 Sent a video". chat_vibes (20261106000000) matches only '🎵 Shared a song', so vibe
-- scoring is unchanged.
create or replace function public.message_preview(p_kind text, p_body text)
returns text
language sql
immutable
as $$
  select case p_kind
           when 'text' then
             case
               when p_body ~ '^\s*https://(www\.)?livil-music\.com/@[a-z0-9_-]{1,40}/?\s*$'
                 then '👤 Shared a profile'
               when p_body ~* '^\s*((https?://)?open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]{22}([?#][^\s)>"'']*)?|spotify:track:[a-z0-9]{22})\s*$'
                 then '🎵 Shared a song'
               when btrim(p_body) = '📷 Photo · Update Livil to view'
                 then '📷 Sent a photo'
               when btrim(p_body) = '🎬 Video · Update Livil to view'
                 then '🎬 Sent a video'
               else left(p_body, 80)
             end
           when 'track_share' then '🎵 Shared a song'
           when 'jam_invite'  then '🎶 Started a Jam Room'
           when 'sticker'     then '🖼 Sent a sticker'
           when 'system'      then null
           else left(p_body, 80)
         end
$$;

-- ── 4. The sweep ────────────────────────────────────────────────────────────
-- What the edge function deletes: every object in the bucket older than 5 minutes. No join
-- to messages — everything in this bucket lives at most 5 minutes, which also removes
-- orphans from uploads whose message insert never happened. Service role only.
-- plpgsql, not sql: a sql body is resolved at CREATE time, and replay shims of
-- storage.objects older than this migration have no created_at.
create or replace function public.chat_media_expired_objects(p_limit integer default 500)
returns setof text
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
begin
  return query
    select o.name
      from storage.objects o
     where o.bucket_id = 'chat-media'
       and o.created_at < now() - interval '5 minutes'
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $$;

revoke all on function public.chat_media_expired_objects(integer) from public;
revoke execute on function public.chat_media_expired_objects(integer) from anon, authenticated;
grant execute on function public.chat_media_expired_objects(integer) to service_role;

-- Where the sweep reaches the function. The key is the PUBLIC anon key the app ships
-- (lib/supabase.ts) — it only gets the call past the gateway; `sweep` deletes nothing but
-- expired files, so it needs no further authority. Server-only: deny-all to clients, no
-- `authenticated` grant on purpose (same shape as push_config, 20261025000000).
create table if not exists public.chat_media_config (
  id           integer primary key default 1 check (id = 1),
  function_url text not null,
  anon_key     text not null
);
alter table public.chat_media_config enable row level security;
revoke all on public.chat_media_config from anon, authenticated;
insert into public.chat_media_config (id, function_url, anon_key) values (
  1,
  'https://fqzrmqnlgjeuxzinbqvs.supabase.co/functions/v1/chat-media',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxenJtcW5sZ2pldXh6aW5icXZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjQwNDYsImV4cCI6MjA5OTAwMDA0Nn0.lM3_oFmNmNL9vyjI1bAuBON_P1rAJolgocB0HWmDCmo'
)
on conflict (id) do update
  set function_url = excluded.function_url, anon_key = excluded.anon_key;

-- Calls the function only when there is something to delete, so an idle minute costs one
-- index probe and no invocation. Never raises: a failure is a WARNING and the next minute
-- tries again.
create or replace function public.chat_media_sweep_dispatch()
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_cfg public.chat_media_config;
begin
  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'chat-media'
       and o.created_at < now() - interval '5 minutes'
  ) then
    return;
  end if;
  select * into v_cfg from public.chat_media_config where id = 1;
  if v_cfg.function_url is null then
    raise warning 'chat_media_sweep_dispatch: chat_media_config is empty';
    return;
  end if;
  perform net.http_post(
    url := v_cfg.function_url,
    body := jsonb_build_object('action', 'sweep'),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.anon_key,
      'apikey', v_cfg.anon_key),
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'chat_media_sweep_dispatch: %', sqlerrm;
end $$;

revoke all on function public.chat_media_sweep_dispatch() from public;
revoke execute on function public.chat_media_sweep_dispatch() from anon, authenticated;

select cron.schedule('chat-media-sweep', '* * * * *', $$select public.chat_media_sweep_dispatch()$$);

-- ── 5. Self-checks ──────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from storage.buckets where id = 'chat-media' and public) then
    raise exception 'chat-media must be a private bucket';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'chat\_media\_%' and cmd <> 'INSERT'
  ) then
    raise exception 'chat-media must have no read/update/delete policy for clients';
  end if;
  if public.message_preview('text', '📷 Photo · Update Livil to view') <> '📷 Sent a photo'
     or public.message_preview('text', '🎬 Video · Update Livil to view') <> '🎬 Sent a video'
     or public.message_preview('text', 'hello') <> 'hello' then
    raise exception 'message_preview: media labels not mapped';
  end if;
end $$;
