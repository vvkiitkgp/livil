-- Publish conversation_members so clients can subscribe to last_read_at
-- updates and render Instagram-style "Seen" indicators in real time.
-- REPLICA IDENTITY FULL so UPDATE payloads carry enough columns for the
-- client to filter without an extra round-trip.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end$$;

alter table public.conversation_members replica identity full;
