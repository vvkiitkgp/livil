-- ============================================================================
-- ops_tracks_for_user — carry takedown state, so the review page can act on it
-- ============================================================================
--
-- /studio/ops/user/:id now offers Take down / Restore on each upload, through the same
-- ops_take_down_track / ops_restore_track pair and the same TakedownDialog the moderation
-- queues use. To do that honestly the row has to say two things it did not:
--
--   * taken_down_at — whether the button should read "Take down" or "Restore". Without it
--     the page would offer to take down a track that is already down, and the operator
--     would learn the truth only from the RPC's error.
--   * live_uploads / live_reposts — what a takedown would actually remove, right now.
--     Same counts, computed the same way, as ops_copyright_scans (20260923040000): two
--     identically-titled uploads with nothing live on one of them is exactly how the first
--     real misclick happened, and the dialog warns on zero for that reason.
--
-- Return type changes, so this is DROP + CREATE, not create-or-replace. `drop function`
-- discards the comment and the grants; both are restated below and self-verified.
--
-- Everything else is unchanged: SECURITY DEFINER so a block cannot hide the work, is_ops()
-- gated in the body, EMPTY rather than raising for a non-ops caller. No new reach — the
-- posts counted here are already counted for the same operator by ops_copyright_scans.
-- ============================================================================

drop function if exists public.ops_tracks_for_user(uuid);

create function public.ops_tracks_for_user(p_user_id uuid)
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
  created_at       timestamptz,
  taken_down_at    timestamptz,
  live_uploads     bigint,
  live_reposts     bigint
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
           t.cover_art_url, t.thumbnail_url, t.audio_url, t.video_url, t.created_at,
           t.taken_down_at,
           coalesce((select count(*) from public.posts po
                      where po.track_id = t.id and po.kind = 'upload'), 0),
           coalesce((select count(*) from public.posts po
                      where po.track_id = t.id and po.kind = 'repost'), 0)
      from public.tracks t
     where t.uploader_id = p_user_id
     order by t.created_at desc;
end;
$$;

revoke all     on function public.ops_tracks_for_user(uuid) from public;
revoke execute on function public.ops_tracks_for_user(uuid) from anon;
grant  execute on function public.ops_tracks_for_user(uuid) to authenticated;

comment on function public.ops_tracks_for_user(uuid) is
  'Ops-only: one artist''s uploaded tracks, newest first, with takedown state and live post counts, for review and moderation. SECURITY DEFINER so a block between the operator and the artist cannot hide the work being reviewed — matching ops_users_overview(), whose count this list must agree with. Empty for a non-ops caller.';

-- ── Self-verification ───────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.ops_tracks_for_user(uuid)', 'execute') then
    raise exception 'anon can execute ops_tracks_for_user — a revoke did not take';
  end if;
  if not has_function_privilege('authenticated', 'public.ops_tracks_for_user(uuid)', 'execute') then
    raise exception 'authenticated lost execute on ops_tracks_for_user — the drop discarded the grant';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.ops_tracks_for_user(uuid)'::regprocedure) is not true then
    raise exception 'ops_tracks_for_user must be SECURITY DEFINER — under caller rights a block hides the tracks, and a taken-down track is invisible to everyone but its uploader';
  end if;
  if pg_get_functiondef('public.ops_tracks_for_user(uuid)'::regprocedure) not ilike '%is_ops()%' then
    raise exception 'ops_tracks_for_user lost its is_ops() gate';
  end if;
end $$;
