-- ============================================================================
-- Blocking hides content, and reposts become friends-only
-- ============================================================================
--
-- Two changes, found by testing 2.0.1 rather than by review.
--
-- ── 1. BLOCKING NOW HIDES ───────────────────────────────────────────────────
--
-- 20260808100000 shipped blocking that severs CONTACT and deliberately left the
-- catalogue visible, with a long comment defending that. Tested against the real
-- app, it reads as broken: you block someone and their uploads are still in your
-- feed, their profile still browsable, their songs still in search. The earlier
-- reasoning ("a catalogue with holes based on who fell out with whom is a worse
-- product") is not wrong about catalogues — it was wrong about what a person
-- means when they press Block. This reverses it, deliberately.
--
-- Symmetric and total: if A blocks B, A sees none of B's uploads, reposts,
-- albums, playlists or tracks, and B sees none of A's — including A's profile,
-- name and username.
--
-- ── WHAT THIS COSTS, STATED PLAINLY ─────────────────────────────────────────
--
-- A block used to be INVISIBLE: 20260808100000 made the block row readable only
-- by the blocker specifically so a blocked user could not learn they had been
-- blocked ("exactly the signal a harasser would use to open a second account").
-- Hiding a profile destroys that property — B discovers the block the moment A's
-- profile stops resolving. There is no way to hide someone from a person and
-- also keep the hiding secret from them.
--
-- That trade is now made in favour of hiding, which is what every large platform
-- does and what users expect. The block row stays blocker-only readable anyway,
-- so B learns THAT they cannot see A, never a list of who blocked them.
--
-- ── THE SHARED-CONVERSATION EXCEPTION ───────────────────────────────────────
--
-- profiles is read directly by the chat client in four places
-- (src/services/conversations.ts:70,190,237,287), so hiding the row outright
-- turns any group both people are in into a wall of "Unknown" — including
-- historical messages, which neither party can leave behind. So the profile
-- stays readable to someone you already share a conversation with.
--
-- The cost, stated because it is a real leak and not a rounding error: a person
-- you blocked but still share a group with remains findable in search, because
-- RLS is row-level and cannot distinguish "reading this row to render a chat
-- bubble" from "reading it to fill a search result". Bounded to people you are
-- already in a room with. The alternative — hiding the row and giving chat a
-- privileged read path — is the better design and a bigger change than this.
--
-- ── 2. REPOSTS ARE FRIENDS-ONLY ─────────────────────────────────────────────
--
-- Unrelated to blocking, and a pre-existing hole: `posts_select_authenticated`
-- was `using (true)` with no distinction between kinds, so a stranger's reposts
-- were as public as their uploads. The intended model is uploads and albums
-- public, reposts and playlists between friends. Playlists already enforced it
-- (`playlists_select`, since 20260616000000); reposts never did.
--
-- ── WHY THIS IS ALL RLS ─────────────────────────────────────────────────────
--
-- `fetch_home_feed` is NOT SECURITY DEFINER and search is client-side `.ilike`
-- against these same tables, so every read path already runs under RLS. Fixing
-- the policies fixes the feed, search, and every profile screen at once, and no
-- screen can forget to apply the rule. Verified against production before
-- writing: had the feed been definer, none of this would have taken effect.
--
-- Stories need no change — `stories_select` is already friends-or-star gated and
-- block_user() deletes both, so a blocked user's stories disappear on their own.
-- ============================================================================

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- DEFINER for the reason 20260803180000 gives: a policy expression referencing
-- another table has THAT table's RLS applied, so an inline subquery over
-- friendships would start returning false the day that table's read policy is
-- tightened — failing CLOSED, silently, between real friends.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.user_a_id = a and f.user_b_id = b)
        or (f.user_b_id = a and f.user_a_id = b))
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
revoke execute on function public.are_friends(uuid, uuid) from anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

comment on function public.are_friends(uuid, uuid) is
  'Whether two users have an ACCEPTED friendship, either direction. Pending is not friendship. Used by the posts/playlists read policies.';

create or replace function public.shares_conversation_with(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members m1
    join public.conversation_members m2 on m2.conversation_id = m1.conversation_id
    where m1.user_id = a and m2.user_id = b
  );
$$;

revoke all on function public.shares_conversation_with(uuid, uuid) from public;
revoke execute on function public.shares_conversation_with(uuid, uuid) from anon;
grant execute on function public.shares_conversation_with(uuid, uuid) to authenticated;

comment on function public.shares_conversation_with(uuid, uuid) is
  'Whether two users are both members of any conversation. The single exception to profile hiding: a shared group must not render as "Unknown". See the migration header for the leak this accepts.';

-- ── profiles ────────────────────────────────────────────────────────────────
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or not public.is_blocked_between(auth.uid(), id)
    or public.shares_conversation_with(auth.uid(), id)
  );

-- ── posts ───────────────────────────────────────────────────────────────────
-- Own posts always visible, or: not blocked either way AND (an upload, which is
-- public, OR a repost between accepted friends).
drop policy if exists "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated" on public.posts
  for select to authenticated
  using (
    author_id = auth.uid()
    or (
      not public.is_blocked_between(auth.uid(), author_id)
      and (
        kind <> 'repost'
        or public.are_friends(auth.uid(), author_id)
      )
    )
  );

-- ── tracks ──────────────────────────────────────────────────────────────────
-- Public, minus blocks. Gated explicitly rather than left to `posts`, because
-- search queries tracks DIRECTLY (src/services/tracks.ts) — leaving this open
-- would hide a blocked user's posts from the feed and surface the same songs in
-- search, which is the bug this migration exists to fix.
drop policy if exists "tracks_select_authenticated" on public.tracks;
create policy "tracks_select_authenticated" on public.tracks
  for select to authenticated
  using (
    uploader_id = auth.uid()
    or not public.is_blocked_between(auth.uid(), uploader_id)
  );

-- ── albums ──────────────────────────────────────────────────────────────────
drop policy if exists "albums_select_authenticated" on public.albums;
create policy "albums_select_authenticated" on public.albums
  for select to authenticated
  using (
    uploader_id = auth.uid()
    or not public.is_blocked_between(auth.uid(), uploader_id)
  );

drop policy if exists "album_tracks_select_authenticated" on public.album_tracks;
create policy "album_tracks_select_authenticated" on public.album_tracks
  for select to authenticated
  using (
    exists (
      select 1 from public.albums a
      where a.id = album_tracks.album_id
        and (
          a.uploader_id = auth.uid()
          or not public.is_blocked_between(auth.uid(), a.uploader_id)
        )
    )
  );

-- ── playlists ───────────────────────────────────────────────────────────────
-- The owner / public / friends / private model is UNCHANGED — it already worked,
-- and the visibility picker on CreatePlaylistScreen already offers all three.
-- The only addition is the block clause. `are_friends` replaces the inline
-- friendships subquery for the reason given above.
drop policy if exists "playlists_select" on public.playlists;
create policy "playlists_select" on public.playlists
  for select
  using (
    user_id = auth.uid()
    or (
      not public.is_blocked_between(auth.uid(), user_id)
      and (
        visibility = 'public'::playlist_visibility
        or (
          visibility = 'friends'::playlist_visibility
          and public.are_friends(auth.uid(), user_id)
        )
      )
    )
  );

drop policy if exists "playlist_posts_select" on public.playlist_posts;
create policy "playlist_posts_select" on public.playlist_posts
  for select
  using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_posts.playlist_id
        and (
          p.user_id = auth.uid()
          or (
            not public.is_blocked_between(auth.uid(), p.user_id)
            and (
              p.visibility = 'public'::playlist_visibility
              or (
                p.visibility = 'friends'::playlist_visibility
                and public.are_friends(auth.uid(), p.user_id)
              )
            )
          )
        )
    )
  );

-- ── Self-verification ───────────────────────────────────────────────────────
-- Asserts the PROPERTY. The failure mode these guard against is a later
-- migration replacing one of these policies from an older copy and silently
-- dropping the block clause — which is exactly how `posts_select_authenticated`
-- stayed `using (true)` through three visibility features.
do $$
declare
  v_qual text;
  t text;
  n int;
begin
  foreach t in array array[
    'profiles', 'posts', 'tracks', 'albums', 'album_tracks', 'playlists', 'playlist_posts'
  ] loop
    select count(*) into n from pg_policies
     where schemaname = 'public' and tablename = t and cmd = 'SELECT';
    if n <> 1 then
      raise exception
        'expected exactly 1 SELECT policy on %, found % — a second permissive policy would OR the hiding away',
        t, n;
    end if;

    select qual into v_qual from pg_policies
     where schemaname = 'public' and tablename = t and cmd = 'SELECT';
    if v_qual not like '%is_blocked_between%' then
      raise exception '% SELECT policy does not consult is_blocked_between: %', t, v_qual;
    end if;
  end loop;

  -- Reposts specifically: uploads stay public, so the friendship clause is the
  -- only thing standing between a stranger and someone's reposts.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'posts' and cmd = 'SELECT';
  if v_qual not like '%are_friends%' or v_qual not like '%repost%' then
    raise exception 'posts SELECT policy lost the repost/friendship clause: %', v_qual;
  end if;

  -- The playlist model must survive intact.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'playlists' and cmd = 'SELECT';
  if v_qual not like '%public%' or v_qual not like '%friends%' then
    raise exception 'playlists SELECT policy lost its visibility model: %', v_qual;
  end if;

  -- The chat exception must exist, or every shared group renders as Unknown.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT';
  if v_qual not like '%shares_conversation_with%' then
    raise exception 'profiles SELECT policy lost the shared-conversation exception: %', v_qual;
  end if;

  -- New DEFINER functions must not be anon-callable (20260808130000's lesson).
  foreach t in array array[
    'public.are_friends(uuid, uuid)', 'public.shares_conversation_with(uuid, uuid)'
  ] loop
    if has_function_privilege('anon', t, 'execute') then
      raise exception 'anon can execute % — revoke did not take', t;
    end if;
  end loop;
end $$;
