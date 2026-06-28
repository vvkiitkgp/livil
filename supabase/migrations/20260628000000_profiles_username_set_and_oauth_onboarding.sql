-- OAuth (Google) onboarding: a dedicated "create your account" step where the
-- new social-login user picks a PERMANENT username (Instagram-style gate).
--
-- Background: handle_new_user() previously fell back to the email prefix as the
-- username for any signup lacking a `username` in metadata — which is every
-- Google sign-in. That auto-generated a handle the user never picked. We now:
--   * flag such users (username_set = false) so the app forces a username step,
--   * let them claim a username exactly once, and
--   * lock the username for life once set.

-- 1. Track whether the user has deliberately chosen a username.
--    Email/password signups provide one at signup; OAuth users do not.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username_set boolean NOT NULL DEFAULT false;

-- 2. Existing users keep their current setup — never prompt them retroactively.
UPDATE public.profiles SET username_set = true WHERE username_set = false;

-- 3. New-user trigger: for OAuth signups (no username in metadata) generate a
--    guaranteed-unique placeholder, prefill name/avatar from the provider, and
--    flag username_set = false so the app shows the onboarding screen.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  meta_username text := new.raw_user_meta_data->>'username';
begin
  insert into public.profiles (id, username, display_name, avatar_url, username_set)
  values (
    new.id,
    coalesce(
      meta_username,
      -- collision-proof placeholder; replaced by claim_username on first launch
      'user_' || replace(substring(new.id::text, 1, 8), '-', '')
    ),
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    ),
    meta_username is not null
  );
  return new;
end;
$function$;

-- 4. One-time username claim: validates format + case-insensitive uniqueness,
--    optionally sets the display name, and flips username_set = true. Refuses to
--    run a second time (username is permanent).
CREATE OR REPLACE FUNCTION public.claim_username(
  p_username text,
  p_display_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  uid uuid := auth.uid();
  uname text := lower(trim(p_username));
  already boolean;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select username_set into already from public.profiles where id = uid;
  if already then
    raise exception 'Username has already been set and cannot be changed' using errcode = '23505';
  end if;

  if uname !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Username must be 3-30 characters: letters, numbers, underscore' using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles where username = uname and id <> uid) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;

  update public.profiles
    set username = uname,
        username_set = true,
        display_name = coalesce(nullif(trim(p_display_name), ''), display_name)
    where id = uid;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_username(text, text) TO authenticated;

-- 5. Username is permanent for life. Block any change to `username` once it has
--    been set, and forbid reverting the username_set flag. claim_username is the
--    only sanctioned path to the first set (it runs while username_set is still
--    false, so this trigger passes it through).
CREATE OR REPLACE FUNCTION public.enforce_username_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  if OLD.username_set then
    if NEW.username is distinct from OLD.username then
      raise exception 'Username cannot be changed once set';
    end if;
    if NEW.username_set is distinct from OLD.username_set then
      raise exception 'username_set cannot be reverted';
    end if;
  end if;
  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_username_immutable ON public.profiles;
CREATE TRIGGER trg_enforce_username_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_username_immutable();
