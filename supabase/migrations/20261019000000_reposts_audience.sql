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
-- ── DEFAULT: EVERYONE, INCLUDING EXISTING ACCOUNTS AND EXISTING REPOSTS ─────
-- Deliberate (product decision, 2026-10-09): every profile starts at true, so reposts
-- made under the friends-only rule become visible to every signed-in user the moment
-- this is applied. NOT reversible in effect — flipping the column back hides the posts
-- again, but anyone who saw them saw them. People still on an app without the switch
-- (≤ 2.1.2) cannot turn it off until they update.
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
-- now reaches strangers' Home feeds through its hot/newest candidate sources and their
-- view of the reposter's profile, with no change to any of them. The ONE place that
-- repeats the predicate by hand is record_post_impressions (DEFINER, so it bypasses
-- RLS); it is redefined below with the identical predicate, or a public repost shown
-- to a stranger would never be recorded as seen and would never fade from their feed.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Additive column with a default (old sign-ups and profile edits do not send it).
-- The policy only ever WIDENS: every row an old app could read before, it can still
-- read. Old apps already render any repost they are given through the same feed and
-- profile code, so a stranger's public repost displays normally there. No function
-- signature, return shape or column used by an old app changes.
-- ============================================================================

alter table public.profiles
  add column if not exists reposts_public boolean not null default true;

comment on column public.profiles.reposts_public is
  'Who may see this user''s reposts: true = any signed-in user (default), false = accepted '
  'friends only. Read live by posts_select_authenticated and record_post_impressions via '
  'reposts_public(). Writable by its owner (profiles_update_own). ADR-0028.';

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
