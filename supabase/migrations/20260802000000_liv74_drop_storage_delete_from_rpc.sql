-- LIV-74 — delete_my_account() must not delete from storage.objects.
--
-- Supabase installs `protect_objects_delete`, a BEFORE DELETE statement trigger running
-- storage.protect_delete(), which raises 42501 'Direct deletion from storage tables is not
-- allowed. Use the Storage API instead.' unless `storage.allow_delete_query` is set.
--
-- So the statement this removes has ALWAYS failed on a real project. It shipped in
-- 20260722200000 on 2026-07-23 and was never exercised, because no client called the RPC
-- until the LIV-74 delete flow was built. The first real tap raised, and the whole
-- transaction rolled back — no data lost, but deletion was impossible.
--
-- WHY NOTHING CAUGHT IT: every test replays migrations on a plain Postgres, which has no
-- Supabase storage extension and therefore no trigger. 48 assertions, 30 mutations and
-- three security reviews all passed against an environment where the guard did not exist.
--
-- DO NOT re-add it, and do not reach for `set_config('storage.allow_delete_query','true')`:
-- that deletes the metadata row while leaving the S3 object orphaned, which breaks the
-- media-deletion promise on docs/delete-account.html more quietly than failing does.
--
-- The client is now the only storage mechanism, which is what PROP-0003 §3 and PROP-0008
-- always required: deleteMyAccount() sweeps both buckets through the Storage API BEFORE
-- calling this function, and aborts without calling it if the sweep fails.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Written before auth.users goes, while the email and username are still readable.
  insert into public.deleted_accounts (email_sha256, username)
  select public.account_email_hash(u.email), lower(btrim(p.username))
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = v_me;

  -- End any jam this user is hosting first. host_id is about to become null, and a live
  -- room with no host is unusable but still advertised: broadcast_jam_state gates on
  -- `host_id = auth.uid()`, so nobody could ever drive it again.
  update public.jam_rooms
     set status = 'ended', ended_at = now()
   where host_id = v_me
     and status = 'active';

  -- A DM goes whole — ratified, not an oversight. Cascades from conversations take
  -- conversation_members, messages, message_reactions, jam_rooms and jam_queue with it.
  --
  -- EXACTLY TWO MEMBERS, and that clause is load-bearing. What the maintainer ratified is
  -- a two-party thread going with the party who leaves. `kind = 'dm'` alone does not mean
  -- two parties: 20260730000000 §6 closes the way a third person gets added, but a `dm`
  -- that already has three members would otherwise let one of them destroy the other two's
  -- history. Anything wider is treated as a group — only the departing user's own messages
  -- go, which is the fail-safe direction.
  delete from public.conversations c
   where c.kind = 'dm'
     and exists (
       select 1 from public.conversation_members m
        where m.conversation_id = c.id
          and m.user_id = v_me
     )
     and (select count(*) from public.conversation_members m2
           where m2.conversation_id = c.id) = 2;

  -- Groups keep everyone else's messages. Runs after the DM sweep, so this is the
  -- group remainder.
  delete from public.messages where sender_id = v_me;

  -- Storage is NOT touched here — see the header. The client sweeps it through the
  -- Storage API before calling this function.

  -- The cascade does the rest.
  delete from auth.users where id = v_me;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;


-- Drift check: assert the statement is gone and cannot creep back.
do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'delete_my_account'
       and p.prosrc ~* 'delete\s+from\s+storage\.objects'
  ) then
    raise exception
      'LIV-74 aborted: delete_my_account still deletes from storage.objects, which protect_objects_delete rejects';
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_my_account'
       and p.prosecdef and p.pronargs = 0
  ) then
    raise exception
      'LIV-74 aborted: delete_my_account must remain SECURITY DEFINER with no parameter';
  end if;
end $$;
