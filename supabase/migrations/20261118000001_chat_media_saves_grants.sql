-- ============================================================================
-- chat_media_saves: only the access the app uses
-- ============================================================================
--
-- 20261118000000 granted `select, insert` to authenticated and assumed nothing else was
-- there. Production still auto-granted EVERY privilege on the new table to anon,
-- authenticated and service_role (checked 2026-11-02, right after applying it) — the
-- "no more automatic grants on new tables" change has not reached this project.
--
-- Not an open door: RLS refuses every row to anon (auth.uid() is null in both policies) and
-- there is no UPDATE or DELETE policy, and PostgREST exposes no TRUNCATE. But a privilege the
-- app never uses is one policy mistake away from being used, so this takes them back:
--
--   anon          — nothing (a logged-out client has no business with saves)
--   authenticated — SELECT, INSERT only (what src/services/chatMedia.ts does)
--   service_role  — unchanged
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- No shipped build reads or writes chat_media_saves; only the unreleased build does, and
-- only with SELECT and INSERT.
-- ============================================================================

revoke all on public.chat_media_saves from anon;
revoke update, delete, truncate, references, trigger on public.chat_media_saves from authenticated;
grant select, insert on public.chat_media_saves to authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'chat_media_saves'
       and (grantee = 'anon'
            or (grantee = 'authenticated' and privilege_type not in ('SELECT', 'INSERT')))
  ) then
    raise exception 'chat_media_saves: clients hold more than SELECT/INSERT';
  end if;
end $$;
