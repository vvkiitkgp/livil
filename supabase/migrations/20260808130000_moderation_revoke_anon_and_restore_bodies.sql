-- ============================================================================
-- Moderation functions: revoke anon, and restore the bodies the repo declares
-- ============================================================================
--
-- Two defects in 20260808100000 / 110000 / 120000, both found by the schema-parity
-- check on main rather than by review. Neither is exploitable today; both are the
-- kind that stop being harmless the moment someone edits a body.
--
-- ── 1. THE anon GRANTS WERE NEVER REMOVED ──────────────────────────────────
--
-- All three migrations wrote
--
--     revoke all on function public.<fn>(...) from public;
--     grant execute on function public.<fn>(...) to authenticated;
--
-- which is exactly the mistake 20260806040000_revoke_stale_anon_function_grants
-- was written to correct, repeated. REVOKE ... FROM public drops the PUBLIC
-- pseudo-role grant; Supabase's default privileges ALSO issue a DIRECT grant to
-- `anon`, and a direct grant is untouched by revoking from PUBLIC. Verified in
-- production: all seven functions answered has_function_privilege('anon', ...) = true.
--
-- Impact, honestly stated. Six of the seven fail closed on their own: block_user,
-- unblock_user and report_story raise 'not_authenticated' when auth.uid() is null,
-- ops_mark_report_reviewed raises 'not_authorized', ops_reports_overview returns
-- empty, and dm_blocked_for_sender answers false.
--
-- is_blocked_between is the exception and the reason this is not merely tidiness.
-- It takes both user ids as arguments and consults nothing about the caller, so an
-- UNAUTHENTICATED caller could ask whether any two users have blocked each other.
-- 20260808100000 states as a design property that a block must not be discoverable
-- — "exactly the signal a harasser would use to open a second account" — and then
-- left it discoverable to the whole internet. That is the defect.
--
-- ── 2. THREE BODIES DRIFTED FROM THE REPO ──────────────────────────────────
--
-- send_friend_request, report_story and ops_reports_overview were applied to
-- production with comment lines missing from their bodies. Postgres stores prosrc
-- verbatim, comments included, so the parity fingerprint differs even though the
-- behaviour is identical. Same cause as the 2026-08-07 drift: text retyped on its
-- way to the database instead of being copied.
--
-- The three definitions below are byte-identical to the ones in those migrations,
-- extracted from the files rather than retyped. Re-declaring them here makes this
-- migration authoritative for both a fresh apply and production, so the two agree
-- by construction instead of by careful transcription.
--
-- The fix for the CLASS is not in this file: `revoke all ... from public` reads as
-- a guard and is not one, and nothing stops the next migration writing it again.
-- ============================================================================

create or replace function public.send_friend_request(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if target_user_id = me then raise exception 'cannot_befriend_self'; end if;
  if public.is_blocked_between(me, target_user_id) then
    raise exception 'blocked';
  end if;

  select lo, hi into v_lo, v_hi from public._friendship_pair(me, target_user_id);

  select * into v_existing from public.friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if found then
    if v_existing.status = 'accepted' then
      raise exception 'already_friends';
    end if;
    -- pending row already exists; idempotent no-op
    return;
  end if;

  insert into public.friendships (user_a_id, user_b_id, requested_by, status)
  values (v_lo, v_hi, me, 'pending');
end;
$$;

create or replace function public.report_story(
  p_story_id uuid,
  p_reason   text,
  p_details  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_author uuid;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select author_id into v_author from public.stories where id = p_story_id;
  if v_author is null then raise exception 'story_not_found'; end if;
  if v_author = me then raise exception 'cannot_report_own_story'; end if;

  -- Mirrors the client-side rule in the report modals so the constraint is
  -- enforced on both sides rather than trusted from one.
  if p_reason = 'other' and coalesce(btrim(p_details), '') = '' then
    raise exception 'details_required_for_other';
  end if;

  insert into public.story_reports
    (story_id, reported_user_id, reporter_id, reason, details)
  values
    (p_story_id, v_author, me, p_reason, nullif(btrim(p_details), ''));
end;
$$;

create or replace function public.ops_reports_overview(p_include_reviewed boolean default false)
returns table (
  kind               text,
  id                 uuid,
  created_at         timestamptz,
  reason             text,
  details            text,
  reporter_id        uuid,
  reporter_username  text,
  reported_user_id   uuid,
  reported_username  text,
  -- What was reported, in whatever form still exists. Null for a story that has
  -- since expired — the report survives it, so the row must tolerate the absence.
  target_id          uuid,
  target_excerpt     text,
  target_exists      boolean,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  reviewer_username  text
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
    -- ── Posts ──
    select
      'post'::text,
      r.id,
      r.created_at,
      r.reason,
      r.details,
      r.reporter_id,
      rep.username,
      po.author_id,
      auth_p.username,
      r.post_id,
      coalesce(t.title, '(track unavailable)')::text,
      (po.id is not null),
      r.reviewed_at,
      r.reviewed_by,
      rv.username
    from public.post_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.posts po        on po.id = r.post_id
    left join public.profiles auth_p on auth_p.id = po.author_id
    left join public.tracks t        on t.id = po.track_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Comments ──
    select
      'comment'::text,
      r.id,
      r.created_at,
      r.reason,
      r.details,
      r.reporter_id,
      rep.username,
      c.author_id,
      auth_p.username,
      r.comment_id,
      left(c.body, 140),
      (c.id is not null),
      r.reviewed_at,
      r.reviewed_by,
      rv.username
    from public.post_comment_reports r
    left join public.profiles rep     on rep.id = r.reporter_id
    left join public.post_comments c  on c.id = r.comment_id
    left join public.profiles auth_p  on auth_p.id = c.author_id
    left join public.profiles rv      on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Stories ──
    -- reported_user_id comes off the REPORT, not the story: the story may be gone.
    select
      'story'::text,
      r.id,
      r.created_at,
      r.reason,
      r.details,
      r.reporter_id,
      rep.username,
      r.reported_user_id,
      auth_p.username,
      r.story_id,
      case
        when s.id is null then '(story expired)'
        else coalesce(nullif(btrim(s.comment), ''), t.title, '(no caption)')
      end::text,
      (s.id is not null),
      r.reviewed_at,
      r.reviewed_by,
      rv.username
    from public.story_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.stories s       on s.id = r.story_id
    left join public.tracks t        on t.id = s.track_id
    left join public.profiles auth_p on auth_p.id = r.reported_user_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    order by 3 desc;
end;
$$;

-- ── The revokes that the three migrations meant to write ────────────────────
-- `FROM anon` — the statement that actually removes the grant. Idempotent:
-- revoking a privilege that is not held is a no-op, not an error.
revoke execute on function public.is_blocked_between(uuid, uuid)              from anon;
revoke execute on function public.block_user(uuid)                            from anon;
revoke execute on function public.unblock_user(uuid)                          from anon;
revoke execute on function public.dm_blocked_for_sender(uuid)                 from anon;
revoke execute on function public.report_story(uuid, text, text)              from anon;
revoke execute on function public.ops_reports_overview(boolean)               from anon;
revoke execute on function public.ops_mark_report_reviewed(text, uuid, boolean) from anon;

-- ── Self-verification ───────────────────────────────────────────────────────
-- Asserts the PROPERTY. A future migration that recreates any of these functions
-- gets a fresh default-privilege grant to anon, and this is what would catch it.
do $verify$
declare
  f text;
begin
  foreach f in array array[
    'public.is_blocked_between(uuid, uuid)',
    'public.block_user(uuid)',
    'public.unblock_user(uuid)',
    'public.dm_blocked_for_sender(uuid)',
    'public.report_story(uuid, text, text)',
    'public.ops_reports_overview(boolean)',
    'public.ops_mark_report_reviewed(text, uuid, boolean)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'anon can still execute % — the revoke did not take', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'authenticated LOST execute on % — the revoke was too wide', f;
    end if;
  end loop;
end $verify$;
