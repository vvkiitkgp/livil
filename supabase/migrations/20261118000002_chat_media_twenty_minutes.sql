-- ============================================================================
-- Disappearing chat photos and videos live 20 minutes, not 5
-- ============================================================================
--
-- Owner decision, 2026-11-02. PROP-0011 (kb/debt/proposals/0011-disappearing-media-in-chat.md).
--
-- 20261118000000 wrote the lifetime into three places in the database; each moves to 20:
--
--   chat_media_saves_insert     — a save may be recorded until created_at + 21 min
--                                 (20 + 1 minute of clock grace; was 6)
--   chat_media_expired_objects  — the sweep deletes objects older than 20 min (was 5)
--   chat_media_sweep_dispatch   — calls the sweep only when something is older than 20 min
--
-- The same number lives in the chat-media edge function (LIFETIME_MS) and the app
-- (CHAT_MEDIA_LIFETIME_MS, src/utils/chatMedia.ts); all three must agree. Apply this and
-- deploy the function BEFORE the app build that counts 20 minutes, or the server deletes a
-- photo at 5 minutes while the app still shows 15 minutes left.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- No shipped build sends or opens chat photos; only the unreleased build does. Nothing is
-- renamed or retyped. Files already in the bucket simply live longer (at most 20 minutes).
-- ============================================================================

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
         and now() < m.created_at + interval '21 minutes'
    )
  );

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
       and o.created_at < now() - interval '20 minutes'
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $$;

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
       and o.created_at < now() - interval '20 minutes'
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

-- `create or replace` keeps the grants 20261118000000 set; restated so this file stands alone.
revoke all on function public.chat_media_expired_objects(integer) from public;
revoke execute on function public.chat_media_expired_objects(integer) from anon, authenticated;
grant execute on function public.chat_media_expired_objects(integer) to service_role;
revoke all on function public.chat_media_sweep_dispatch() from public;
revoke execute on function public.chat_media_sweep_dispatch() from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'chat_media_saves'
       and policyname = 'chat_media_saves_insert'
       -- Postgres stores the interval as '00:21:00'.
       and (with_check like '%00:21:00%' or with_check like '%21 minutes%')
  ) then
    raise exception 'chat_media_saves_insert: 21-minute window not in place';
  end if;
end $$;
