-- Make the username availability check correct on its own terms, rather than correct
-- because of an invariant it does not verify.
--
-- THE PROBLEM. `is_username_available` lowercases its INPUT (`v_name := lower(btrim(...))`)
-- and then compares it against a case-sensitive column:
--
--     if exists (select 1 from public.profiles where username = v_name)
--
-- That returns the right answer only while every stored username is already lowercase. It is
-- today — `enforce_username_reservation` assigns `lower(btrim(...))` and
-- `profiles_username_lower_key` is unique on `lower(username)`, verified: 0 rows in
-- `profiles` and 0 in `deleted_accounts` differ from their lowercase form. But a check whose
-- correctness rests on a separate object's behaviour is one refactor away from silently
-- reporting a taken handle as free, and the handle is PERMANENT — the artist would discover
-- it as a failed signup at the unique index, or worse, as someone else's name.
--
-- Comparing `lower(username)` instead makes the function independently correct AND lets the
-- planner use `profiles_username_lower_key`; the previous form could not, because the index
-- is on the expression, not the raw column.
--
-- The `deleted_accounts` half gets the same treatment. Its rows are written from `profiles`
-- at deletion, so they inherit whatever was stored — the ledger is what stops a deleted
-- account's handle being taken by someone else, and a case mismatch there would quietly
-- release a name that is meant to stay reserved.
--
-- Behaviour is otherwise UNCHANGED: same signature, same SECURITY DEFINER, same
-- search_path, same deleted-account carve-out letting the original owner reclaim their own
-- handle by email hash.

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name text := lower(btrim(p_username));
  v_hash text;
begin
  if p_username is null or length(v_name) = 0 then
    return false;
  end if;

  -- lower(username), not username: independently correct, and index-backed by
  -- profiles_username_lower_key.
  if exists (select 1 from public.profiles where lower(username) = v_name) then
    return false;
  end if;

  select public.account_email_hash(u.email) into v_hash
    from auth.users u
   where u.id = auth.uid();

  return not exists (
    select 1 from public.deleted_accounts d
     where lower(d.username) = v_name
       and (v_hash is null or d.email_sha256 is null or d.email_sha256 <> v_hash)
  );
end $function$;
