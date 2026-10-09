-- ============================================================================
-- Repost audience, step 2: EVERYONE by default (ADR-0028)
-- ============================================================================
--
-- 20261019000000 added profiles.reposts_public starting FALSE for everyone (today's
-- friends-only rule) so the switch could ship first. This applies the owner's decision:
-- everyone by default, existing accounts and past reposts included.
--
--   * New profiles: default true.
--   * Existing profiles whose owner NEVER touched the switch (reposts_public_set_at IS
--     NULL): turned on.
--   * Anyone who chose — on or off — keeps their choice (reposts_public_set_at is set).
--
-- ── HELD — DO NOT APPLY UNTIL ───────────────────────────────────────────────
-- the build with the switch is at 100% on BOTH stores and most people have updated. It is
-- listed in supabase/held-migrations.txt; applying it and deleting that line happen
-- together. Builds ≤ 2.1.2 draw a Spotify repost as a false "the author removed this post"
-- tombstone, have no switch, and tell new sign-ups reposts are for friends.
--
-- NOT REVERSIBLE IN EFFECT: the moment this runs, every repost of everyone who never
-- touched the switch becomes visible to every signed-in user. Turning it back hides them
-- again, but not from anyone who already saw them.
-- ============================================================================

alter table public.profiles
  alter column reposts_public set default true;

-- Only the never-chosen. The stamp trigger fires on this update and records now() for each
-- row it flips, which is fine and intended: from here on those profiles are simply "on",
-- and nothing later relies on telling this step's flip apart from an owner's choice.
update public.profiles
   set reposts_public = true
 where reposts_public = false
   and reposts_public_set_at is null;

-- Self-check where applied: the default took, and nobody who never chose is left off.
do $$
begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'reposts_public') is distinct from 'true' then
    raise exception 'profiles.reposts_public default is not true';
  end if;
  if exists (select 1 from public.profiles
              where reposts_public = false and reposts_public_set_at is null) then
    raise exception 'a profile that never chose is still friends-only';
  end if;
end $$;
