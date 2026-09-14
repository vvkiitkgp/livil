-- ============================================================================
-- profiles.username: store the normalised form, and index it case-insensitively
-- ============================================================================
--
-- Found by security review; fixed now because WEB SIGNUP makes it live.
--
-- THE DEFECT. `enforce_username_reservation` computes `v_name := lower(btrim(new.username))`,
-- validates THAT against `^[a-z0-9_]{3,30}$`, checks it against the deleted-accounts ledger —
-- and then stores `new.username` unmodified. The uniqueness authority is
-- `username text not null unique`, a plain CASE-SENSITIVE index.
--
-- So an account inside the `username_set = false` window could PATCH `username = 'Vamsi'`
-- directly: the lowercased form passes the regex, the ledger check passes, and the unique
-- index permits it because `'Vamsi' <> 'vamsi'` in `text`. `claim_username` lowercases before
-- writing, so every RPC-created handle is lowercase — but the RPC is not the path being used.
--
-- The result is a handle that renders on a profile and is INVISIBLE to both
-- `is_username_available` and `get_email_for_username`, which look up `lower(trim(...))`. It
-- cannot be found, cannot be reclaimed, and impersonates the real holder.
--
-- WHY NOW. 0 accounts are in that window today and 0 usernames are non-lowercase, so this has
-- never been exploitable in practice. ADR-0015 decision 3 made the dashboard sign-in only,
-- which kept the window empty. Reversing that decision — adding web signup — sends EVERY new
-- account through it. The fix has to land with signup, not after.
--
-- TWO CHANGES, because either alone is incomplete:
--   1. The trigger now assigns the normalised name back. Closes the class regardless of what
--      index exists.
--   2. A unique index on `lower(username)`. Belt and braces: it holds even if some future
--      writer bypasses the trigger, and it is free — verified 0 collisions across 47 rows
--      before creating it.
--
-- The rest of the function body below is the DEPLOYED definition reproduced verbatim. Only
-- the one assignment is new.

create or replace function public.enforce_username_reservation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_name text := lower(btrim(new.username));
  v_hash text;
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if v_name !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Username must be 3-30 characters: letters, numbers, underscore'
      using errcode = '22023';
  end if;

  select public.account_email_hash(u.email) into v_hash
    from auth.users u
   where u.id = new.id;

  if exists (
    select 1 from public.deleted_accounts d
     where d.username = v_name
       and (v_hash is null or d.email_sha256 is null or d.email_sha256 <> v_hash)
  ) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;

  -- NEW. Everything above validated v_name; this is what makes the stored value match what
  -- was validated.
  new.username := v_name;

  return new;
end $function$;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));
