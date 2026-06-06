-- Username login + sign-up availability check.
--
-- The profiles table is select-only for authenticated users, so anon
-- sign-up/sign-in can't query it directly. Two SECURITY DEFINER RPCs
-- expose the minimum surface needed:
--   * is_username_available: bool only, no other data leaks
--   * get_email_for_username: returns the email tied to a username so the
--     client can call signInWithPassword. Enables email enumeration via
--     usernames, an accepted tradeoff for username-based login; rely on
--     Supabase's per-IP rate limiting.

create or replace function is_username_available(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_username is null or length(trim(p_username)) = 0 then
    return false;
  end if;
  return not exists (
    select 1 from profiles where username = lower(trim(p_username))
  );
end;
$$;

grant execute on function is_username_available(text) to anon, authenticated;

create or replace function get_email_for_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  if p_username is null or length(trim(p_username)) = 0 then
    return null;
  end if;
  select u.email into v_email
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.username = lower(trim(p_username))
  limit 1;
  return v_email;
end;
$$;

grant execute on function get_email_for_username(text) to anon, authenticated;
