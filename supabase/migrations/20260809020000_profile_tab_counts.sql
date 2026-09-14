-- ============================================================================
-- profile_tab_counts — how much is there, even when you cannot see it
-- ============================================================================
--
-- 20260809000000 made reposts friends-only. UserProfileScreen counts each tab
-- with `count: 'exact'` queries, and a count runs under the same RLS as the rows
-- it counts — so a non-friend's profile showed "Reposts 0" and "No reposts yet"
-- for someone with plenty of reposts. Not merely unhelpful: false. It told the
-- viewer this person does not repost, when the truth is that they do and you
-- are not close enough to see it.
--
-- Hiding CONTENT and hiding the EXISTENCE of content are different decisions,
-- and only the first was made. This makes the second explicitly: the count is
-- public, the rows are not, so the profile can say "17 reposts — add them as a
-- friend to see" instead of lying.
--
-- ── WHAT IS STILL WITHHELD ──────────────────────────────────────────────────
--
--   * PRIVATE playlists are excluded from the count entirely, for anyone but
--     the owner. "Friends-only" says come closer; "private" says this is not
--     yours to know about, and a number would leak that a private playlist
--     exists at all.
--   * A BLOCKED pair gets zeros in both directions. Returning true counts there
--     would hand a blocked person a live activity meter for someone who blocked
--     them — the opposite of what 20260809000000 is for.
--
-- Everything else — uploads, reposts, albums — is counted truthfully, because
-- uploads and albums are already public and a repost count is not sensitive.
-- ============================================================================

create or replace function public.profile_tab_counts(p_user_id uuid)
returns table (
  uploads   int,
  reposts   int,
  albums    int,
  playlists int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return;
  end if;

  -- Blocked either way: no numbers at all, not even honest ones.
  if public.is_blocked_between(me, p_user_id) then
    return query select 0, 0, 0, 0;
    return;
  end if;

  return query
    select
      (select count(*)::int from public.posts po
        where po.author_id = p_user_id and po.kind = 'upload'),
      (select count(*)::int from public.posts po
        where po.author_id = p_user_id and po.kind = 'repost'),
      (select count(*)::int from public.albums a
        where a.uploader_id = p_user_id),
      -- Private playlists count only for their owner.
      (select count(*)::int from public.playlists pl
        where pl.user_id = p_user_id
          and (pl.visibility <> 'private'::playlist_visibility or pl.user_id = me));
end;
$$;

revoke all on function public.profile_tab_counts(uuid) from public;
revoke execute on function public.profile_tab_counts(uuid) from anon;
grant execute on function public.profile_tab_counts(uuid) to authenticated;

comment on function public.profile_tab_counts(uuid) is
  'True per-tab counts for a profile, independent of whether the caller may READ the rows. Friends-only reposts are counted so the UI can say "add them to see" instead of "none". Private playlists are excluded for everyone but the owner, and a blocked pair gets zeros both ways.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.profile_tab_counts(uuid)', 'execute') then
    raise exception 'anon can execute profile_tab_counts — revoke did not take';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.profile_tab_counts(uuid)'::regprocedure) is not true then
    raise exception 'profile_tab_counts must be SECURITY DEFINER — under caller rights it would count only visible rows, which is the bug it exists to fix';
  end if;
end $$;
