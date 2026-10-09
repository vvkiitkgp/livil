-- ============================================================================
-- Repost audience: a per-PROFILE switch — everyone (default) or friends only
-- ============================================================================
--
-- Until now every repost was friends-only (20260809000000, posts_select_authenticated:
-- "uploads and albums public, reposts and playlists between friends"). This makes the
-- repost half a choice each person makes ONCE, for all their reposts, past and future:
--
--   profiles.reposts_public = true   → any signed-in Livil user may see my reposts
--   profiles.reposts_public = false  → only my accepted friends (the old rule)
--
-- A profile setting, not a per-post choice — decided 2026-10-09 (ADR-0028). It is
-- evaluated LIVE by the read policy, so flipping it hides or reveals every repost at
-- once; nothing is copied onto the posts.
--
-- ── TWO STEPS: THE SWITCH NOW (OFF FOR EVERYONE), "EVERYONE" LATER ──────────
-- The owner's decision is everyone-by-default, existing accounts and past reposts included
-- (ADR-0028). It lands in two migrations so the switch can ship — and be tested — before
-- that default may safely take effect:
--
--   THIS migration: the column starts FALSE for every profile, i.e. exactly today's rule.
--     Applying it changes nobody's visibility. The new app shows the switch (off); a person
--     who turns it on makes THEIR reposts visible to every signed-in user.
--   20261020000000_reposts_public_by_default: sets the default to true and turns it on for
--     every profile whose owner never touched the switch (reposts_public_set_at IS NULL).
--     HELD (supabase/held-migrations.txt) until the build with the switch is at 100% on both
--     stores — see "OLD APPS" below. That one is NOT reversible in effect.
--
-- `reposts_public_set_at` is stamped by a trigger whenever the owner changes the value, so
-- the second step can tell "never chose" from "chose friends only" and never overrides a
-- choice.
--
-- ── UNCHANGED ───────────────────────────────────────────────────────────────
--  * Own posts are always visible to their author; blocks hide everything both ways.
--  * Uploads stay public; this column is read only for kind = 'repost'.
--  * Signed out: still nothing. posts_select_authenticated is `to authenticated`, and
--    the public share page (shared_post_public) stays uploads-only — a repost is "a
--    second person's clip choice", never a public URL (20260901000000).
--  * Stories have their own policy and are untouched.
--
-- ── WHERE IT TAKES EFFECT ───────────────────────────────────────────────────
-- Every read path runs under this one policy (fetch_home_feed is INVOKER; profile tabs,
-- search, playlists and the share resolver read `posts` directly), so a public repost
-- now reaches strangers' Home feeds through its hot/newest candidate sources (and the
-- Home of anyone who starred the reposter) and their view of the reposter's profile, with
-- no change to any of them. NOTE the feed groups by COALESCE(track_id, post_id): Livil
-- reposts of one song collapse together, Spotify reposts (track_id NULL) do not. The ONE place that
-- repeats the predicate by hand is record_post_impressions (DEFINER, so it bypasses
-- RLS); it is redefined below with the identical predicate, or a public repost shown
-- to a stranger would never be recorded as seen and would never fade from their feed.
--
-- ── OLD APPS ────────────────────────────────────────────────────────────────
-- Nothing breaks: additive columns with defaults (old sign-ups and profile edits do not
-- send them); the policy only ever WIDENS, so every row an old app could read before it
-- can still read; no function signature, return shape or client-read column changes.
-- SAFE TO APPLY NOW: every profile starts friends-only, so nothing becomes visible until
-- someone on the new app turns their own switch on.
--
-- What waits (20261020000000): making everyone public by default. Builds ≤ 2.1.2 draw a
-- SPOTIFY repost (track_id and original_post_id NULL, ADR-0027) as the "Original post no
-- longer available — the author removed this post" tombstone, have no switch, and tell new
-- sign-ups "Reposts and playlists are for friends". Public by default while most people
-- are on those builds would put false tombstones into their Home feeds. Until then, the
-- only public reposts are those of people who chose it on the new app.
-- ============================================================================

alter table public.profiles
  add column if not exists reposts_public boolean not null default false,
  add column if not exists reposts_public_set_at timestamptz;

comment on column public.profiles.reposts_public is
  'Who may see this user''s reposts: true = any signed-in user, false = accepted friends '
  'only. Read live by posts_select_authenticated and record_post_impressions via '
  'reposts_public(). Writable by its owner (profiles_update_own). Default false here; '
  '20261020000000 makes it true. ADR-0028.';
comment on column public.profiles.reposts_public_set_at is
  'When the owner last changed reposts_public (stamped by trigger). NULL = never chosen, '
  'which is what 20261020000000 uses to apply the everyone default without overriding a choice.';

-- Server clock, on any change of the value — whoever writes it (the owner, through
-- profiles_update_own). Firing only on a real change keeps unrelated profile edits from
-- counting as a choice.
create or replace function public.profiles_stamp_reposts_public()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reposts_public is distinct from old.reposts_public then
    new.reposts_public_set_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_stamp_reposts_public on public.profiles;
create trigger trg_profiles_stamp_reposts_public
  before update of reposts_public on public.profiles
  for each row execute function public.profiles_stamp_reposts_public();

-- ── Helper ──────────────────────────────────────────────────────────────────
-- DEFINER for the same reason as are_friends (20260809000000): a policy expression that
-- reads another table has THAT table's RLS applied. profiles_select_authenticated hides a
-- blocked pair's profiles — harmless here only because the posts policy already excludes
-- blocked pairs first — but the read policy on profiles is not this policy's business,
-- and a future tightening there must not silently flip reposts to friends-only.
-- Unknown author → false (fails closed to the old rule).
create or replace function public.reposts_public(p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select pr.reposts_public from public.profiles pr where pr.id = p_author), false);
$$;

revoke all on function public.reposts_public(uuid) from public;
revoke execute on function public.reposts_public(uuid) from anon;
grant execute on function public.reposts_public(uuid) to authenticated;

comment on function public.reposts_public(uuid) is
  'Whether a user shows their reposts to everyone (profiles.reposts_public). False for an '
  'unknown user. Used by posts_select_authenticated and record_post_impressions.';

-- ── posts: the read policy ──────────────────────────────────────────────────
-- Own posts always visible, or: not blocked either way AND (an upload, which is public,
-- OR a repost whose author shows reposts to everyone, OR a repost between accepted
-- friends). Replaced, never added alongside: two permissive policies are OR'd, so a
-- second one would widen this one in ways nobody reviewed.
drop policy if exists "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated" on public.posts
  for select to authenticated
  using (
    author_id = auth.uid()
    or (
      not public.is_blocked_between(auth.uid(), author_id)
      and (
        kind <> 'repost'
        or public.reposts_public(author_id)
        or public.are_friends(auth.uid(), author_id)
      )
    )
  );

-- ── record_post_impressions: same predicate, by hand ────────────────────────
-- Body identical to 20260816000000 except the visibility predicate, which must stay the
-- same predicate as posts_select_authenticated above (see the comment inside).
create or replace function public.record_post_impressions(p_post_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_post_ids is null then
    return;
  end if;

  insert into public.post_impressions as pi (user_id, post_id)
  -- Bounded rather than trusted: an unbounded array is an unbounded write, and the
  -- client never has more than a screenful buffered. DISTINCT because the same card
  -- can be reported twice in one flush and the rate limit below should be what
  -- decides that, not the accident of how the batch was assembled.
  --
  -- Bounded via unnest+limit rather than `p_post_ids[1:100]`: a slice assumes a
  -- 1-based array, and one built with a different lower bound slices to nothing.
  select distinct v_actor, p.id
    from public.posts p
   where p.id in (select x from unnest(p_post_ids) x limit 100)
     -- THE VISIBILITY PREDICATE IS LOAD-BEARING. This function is SECURITY DEFINER, so
     -- the join above BYPASSES posts_select_authenticated: without this, a row was
     -- written for any post id that merely EXISTS, and the caller could read it back
     -- through post_impressions_select_own — an existence oracle for posts RLS hides.
     --
     -- Deliberately the same predicate as posts_select_authenticated
     -- (20261019000000) rather than a paraphrase of it, so the two cannot drift into
     -- disagreeing about who can see what.
     and (
       p.author_id = v_actor
       or (
         not public.is_blocked_between(v_actor, p.author_id)
         and (
           p.kind <> 'repost'
           or public.reposts_public(p.author_id)
           or public.are_friends(v_actor, p.author_id)
         )
       )
     )
  on conflict (user_id, post_id) do update
     set seen_count   = pi.seen_count + 1,
         last_seen_at = now()
   -- RATE LIMIT, and the definition of "an occasion": scrolling a card off screen and
   -- back is one exposure, not two; a browsing session is roughly ten minutes.
   where pi.last_seen_at < now() - interval '10 minutes';
end;
$$;

revoke all on function public.record_post_impressions(uuid[]) from public;
revoke execute on function public.record_post_impressions(uuid[]) from anon;
grant execute on function public.record_post_impressions(uuid[]) to authenticated;

-- ── Self-verification ───────────────────────────────────────────────────────
-- Same practice as 20260809000000: assert the PROPERTY where it is applied, so drift in
-- the target database fails this migration loudly instead of silently neutering it. A
-- leftover second permissive SELECT policy on posts would be OR'd in and could make the
-- friends-only setting do nothing.
do $$
declare
  v_qual text;
  v_roles text;
  n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'posts' and cmd = 'SELECT';
  if n <> 1 then
    raise exception
      'expected exactly 1 SELECT policy on posts, found % — a second permissive policy would OR the audience rule away', n;
  end if;

  select qual, roles::text into v_qual, v_roles from pg_policies
   where schemaname = 'public' and tablename = 'posts' and cmd = 'SELECT';
  if v_roles <> '{authenticated}' then
    raise exception 'posts SELECT policy must apply to authenticated only, found %', v_roles;
  end if;
  if v_qual not like '%is_blocked_between%'
     or v_qual not like '%reposts_public%'
     or v_qual not like '%are_friends%'
     or v_qual not like '%repost%' then
    raise exception 'posts SELECT policy lost a clause (blocks / audience / friendship): %', v_qual;
  end if;

  if has_function_privilege('anon', 'public.reposts_public(uuid)', 'execute') then
    raise exception 'anon can execute public.reposts_public(uuid) — revoke did not take';
  end if;
end $$;
