-- ============================================================================
-- ops_tracks_for_user — the uploads behind the number, for badge review
-- ============================================================================
--
-- /studio/ops/user/:id lists one artist's uploads so an operator can listen before
-- granting the First 100 badge. It first read `tracks` directly, on the reasoning that
-- `tracks_select_authenticated` was `using (true)` and therefore no privileged read was
-- needed. THAT WAS TRUE UNTIL 20260809000000 AND IS NOT TRUE NOW:
--
--   create policy "tracks_select_authenticated" on public.tracks
--     for select to authenticated
--     using (uploader_id = auth.uid()
--            or not public.is_blocked_between(auth.uid(), uploader_id));
--
-- OBSERVED, NOT THEORISED. The roster showed `test1` with 19 tracks and the review page
-- said "No uploads" — with no error, because RLS does not error, it returns fewer rows.
-- There is a block between the operator's account and that artist. The artist's NAME still
-- rendered, because profiles_select_authenticated has a shares_conversation_with exception
-- and tracks has none, so the page looked like a working page about an artist with nothing
-- to show.
--
-- ── WHY THE COUNT AND THE LIST DISAGREED ────────────────────────────────────
--
-- `ops_users_overview()` is SECURITY DEFINER, so its count sees all 19. The list ran as the
-- operator, so it saw 0. A number that links to a page contradicting it is worse than
-- either number alone: it reads as data loss. The two must be computed under the same
-- authority, and DEFINER is the one that answers the operator's actual question.
--
-- ── WHY BLOCKS MUST NOT APPLY TO AN OPERATOR REVIEWING WORK ─────────────────
--
-- Blocking is a tool for how a PERSON experiences the app — it should absolutely hide that
-- artist from this account's feed and search. It is not a statement about what an OPERATOR
-- may review, and letting it leak into ops has a nasty shape: it hands any user partial
-- control over their own moderation by blocking the reviewer. `ops_reports_overview()`
-- already settles this the same way for reported content.
--
-- SCOPE THIS CLAIM BEFORE CITING IT. What makes it safe here is not the principle, it is
-- that `tracks` is readable by every authenticated account anyway — across a block the row
-- is hidden from ONE account, not made confidential, so defeating the block loses nobody
-- any privacy. That is NOT true of `messages`, `conversations`, `conversation_members`,
-- `jam_rooms` or presence, where a block is load-bearing and an ops read would be a real
-- escalation. A future ops_messages_for_user must make its own argument; it cannot inherit
-- this one.
--
-- CONSIDERED AND REJECTED: a dedicated ops account with no social graph, which could not be
-- blocked incidentally and would need no DEFINER function. Rejected because it does not fix
-- the general case — a user who learns the handle can block that account too, and the
-- count-versus-list divergence returns the moment they do.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
--
-- Not a widening of what ops can see: an operator could already read every one of these
-- rows from an account with no block, and the media URLs are public objects. It removes an
-- inconsistency; it does not grant new reach. Returns EMPTY rather than raising for a
-- non-ops caller, like every other read here, which is why the route needs no guard.
-- ============================================================================

create or replace function public.ops_tracks_for_user(p_user_id uuid)
returns table (
  id               uuid,
  title            text,
  description      text,
  media_kind       text,
  duration_seconds integer,
  cover_art_url    text,
  thumbnail_url    text,
  audio_url        text,
  video_url        text,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;

  return query
    select t.id, t.title, t.description, t.media_kind, t.duration_seconds,
           t.cover_art_url, t.thumbnail_url, t.audio_url, t.video_url, t.created_at
      from public.tracks t
     where t.uploader_id = p_user_id
     order by t.created_at desc;
end;
$$;

revoke all     on function public.ops_tracks_for_user(uuid) from public;
revoke execute on function public.ops_tracks_for_user(uuid) from anon;
grant  execute on function public.ops_tracks_for_user(uuid) to authenticated;

comment on function public.ops_tracks_for_user(uuid) is
  'Ops-only: one artist''s uploaded tracks, newest first, for manual review before granting a badge. SECURITY DEFINER so a block between the operator and the artist cannot hide the work being reviewed — matching ops_users_overview(), whose count this list must agree with. Empty for a non-ops caller.';

-- ── who the artist is ───────────────────────────────────────────────────────
--
-- THE SAME BUG, ONE FIELD OVER. Listing the tracks through a DEFINER function fixed the
-- list and left the review page reading the artist's identity with a plain
-- `from('profiles')`, under the operator's own session. `profiles_select_authenticated`
-- carries the same block clause `tracks` does, plus a shares_conversation_with exception —
-- which is the only reason the name rendered at all in the case that was reported. With a
-- block and NO shared conversation the profile read returns zero rows, `maybeSingle()`
-- yields null rather than an error, and the page shows "This artist" with no handle, no
-- avatar and nothing wrong on screen.
--
-- So the page computes EVERYTHING under one authority, which was the whole argument of this
-- migration. Deliberately narrow: the fields a reviewer needs to know who they are looking
-- at, and no PII the roster does not already show — in fact less, since ops_users_overview()
-- already returns the email and this does not. Dob and phone live on `profiles_private`
-- (20260607000000), a separate self-only table: this function must never join it, which is
-- what the self-verification below actually checks.
create or replace function public.ops_profile_for_user(p_user_id uuid)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  bio          text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_ops() then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.bio
      from public.profiles p
     where p.id = p_user_id;
end;
$$;

revoke all     on function public.ops_profile_for_user(uuid) from public;
revoke execute on function public.ops_profile_for_user(uuid) from anon;
grant  execute on function public.ops_profile_for_user(uuid) to authenticated;

comment on function public.ops_profile_for_user(uuid) is
  'Ops-only: who an artist is, for the badge-review page. SECURITY DEFINER for the same reason as ops_tracks_for_user — a block must not decide what an operator reviewing work can see, and a half-identified page is how that failure looks. Deliberately excludes dob and phone. Empty for a non-ops caller.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.ops_tracks_for_user(uuid)', 'execute')
     or has_function_privilege('anon', 'public.ops_profile_for_user(uuid)', 'execute') then
    raise exception 'anon can execute an ops review function — a revoke did not take';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.ops_profile_for_user(uuid)'::regprocedure) is not true
     or pg_get_functiondef('public.ops_profile_for_user(uuid)'::regprocedure) not ilike '%is_ops()%' then
    raise exception 'ops_profile_for_user must be SECURITY DEFINER and is_ops()-gated';
  end if;
  -- dob and phone live on profiles_private, and joining it in is the realistic escalation
  -- from a screen like this. Pin that it never happens.
  if pg_get_functiondef('public.ops_profile_for_user(uuid)'::regprocedure) ilike '%profiles_private%'
     or pg_get_functiondef('public.ops_profile_for_user(uuid)'::regprocedure) ilike '%date_of_birth%'
     or pg_get_functiondef('public.ops_profile_for_user(uuid)'::regprocedure) ilike '%phone%' then
    raise exception 'ops_profile_for_user must not reach profiles_private, dob or phone';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.ops_tracks_for_user(uuid)'::regprocedure) is not true then
    raise exception 'ops_tracks_for_user must be SECURITY DEFINER — under caller rights a block hides the tracks, which is the bug it exists to fix';
  end if;
  -- The is_ops() gate is the ONLY thing standing between this and every signed-in user,
  -- because definer rights bypass the RLS that would otherwise apply.
  if pg_get_functiondef('public.ops_tracks_for_user(uuid)'::regprocedure) not ilike '%is_ops()%' then
    raise exception 'ops_tracks_for_user lost its is_ops() gate';
  end if;
end $$;
