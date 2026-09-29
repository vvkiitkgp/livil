-- ============================================================================
-- Recently Played is recorded — every counted play now lands in user_recent_tracks
-- ============================================================================
-- `user_recent_tracks` was created in 20260515120000 and read by the Library tab's
-- "Recently played" strip and screen, but NOTHING EVER WROTE TO IT. The client comment
-- said "once playback hooks write to `user_recent_tracks`" and no hook was ever built,
-- so every user saw "No listening history yet" however much they played.
--
-- ── WHERE THE WRITE LIVES ──────────────────────────────────────────────────
--
-- A trigger on `post_views`, not a client upsert and not a new line in
-- `activity_record_play`:
--
--   * `post_views` already IS the counted-play log. The client inserts into it through
--     `activity_record_play` after 3s of forward playback (src/utils/playTracker.ts),
--     rate-limited to one row per (user, post) per second. A play that counts is a play
--     that belongs in history, so hanging the write on that row keeps the two from ever
--     disagreeing.
--   * A client upsert would be a second round trip per play and a second definition of
--     "a play", and would be skipped by any caller that forgets it.
--   * Leaving `activity_record_play` untouched keeps its authorization and milestone
--     logic out of this change's blast radius.
--
-- SECURITY DEFINER so the write does not depend on the caller's RLS — the row written is
-- always `new.user_id`, the viewer the `post_views` row names, and that row was itself
-- written by `activity_record_play` as `auth.uid()`. EXECUTE is revoked from every app
-- role: it is a trigger function and nothing calls it directly (PostgreSQL checks
-- EXECUTE when the trigger is created, not when it fires; see 20260923100000).
--
-- ── last_post_id ───────────────────────────────────────────────────────────
--
-- History is per TRACK (the primary key is (user_id, track_id)), so an upload and three
-- reposts of the same song collapse into one entry — which is what "recently played"
-- means. But a track cannot be played on its own: playback, likes and comments all hang
-- off a POST. `last_post_id` remembers which post the user last played it through, so
-- tapping a history row can open that post. ON DELETE SET NULL: if that post goes, the
-- history row stays and the client falls back to the track's own upload.
--
-- ── EXISTING DATA ──────────────────────────────────────────────────────────
--
-- Backfilled from `post_views`, the play history we already have, so users see what they
-- played before this shipped instead of an empty strip. Additive only: nothing existing
-- is rewritten (the table is empty in production), and the backfill is idempotent
-- (ON CONFLICT keeps the newer of the two timestamps).
--
-- Forward-only. Reversible by dropping the trigger; the rows written are harmless.
-- ============================================================================

alter table public.user_recent_tracks
  add column if not exists last_post_id uuid references public.posts (id) on delete set null;

create or replace function public.user_recent_tracks_record_play()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into user_recent_tracks (user_id, track_id, played_at, last_post_id)
  select new.user_id, p.track_id, new.played_at, p.id
    from posts p
   where p.id = new.post_id
  on conflict (user_id, track_id) do update
    set played_at    = greatest(user_recent_tracks.played_at, excluded.played_at),
        last_post_id = case
                         when excluded.played_at >= user_recent_tracks.played_at
                           then excluded.last_post_id
                         else user_recent_tracks.last_post_id
                       end;
  return new;
end;
$$;

revoke execute on function public.user_recent_tracks_record_play() from public;
revoke execute on function public.user_recent_tracks_record_play() from anon, authenticated;

drop trigger if exists trg_post_views_recent_tracks on public.post_views;
create trigger trg_post_views_recent_tracks
  after insert on public.post_views
  for each row execute function public.user_recent_tracks_record_play();

-- Backfill: the latest play of each (user, track), through whichever post it happened on.
insert into public.user_recent_tracks (user_id, track_id, played_at, last_post_id)
select distinct on (v.user_id, p.track_id)
       v.user_id, p.track_id, v.played_at, p.id
  from public.post_views v
  join public.posts p on p.id = v.post_id
 order by v.user_id, p.track_id, v.played_at desc
on conflict (user_id, track_id) do update
  set played_at    = greatest(user_recent_tracks.played_at, excluded.played_at),
      last_post_id = case
                       when excluded.played_at >= user_recent_tracks.played_at
                         then excluded.last_post_id
                       else user_recent_tracks.last_post_id
                     end;

-- ── Self-test ───────────────────────────────────────────────────────────────
-- Runs inside the migration, so a broken trigger fails the deploy instead of shipping an
-- empty Recently Played again. Fixture rows are removed before the block ends.
do $verify$
declare
  v_user  uuid := '0a0a0a0a-0000-0000-0000-0000000000a1';
  v_track uuid := '0a0a0a0a-1111-0000-0000-0000000000a1';
  v_post  uuid := '0a0a0a0a-2222-0000-0000-0000000000a1';
  v_n     int;
begin
  if has_function_privilege('anon', 'public.user_recent_tracks_record_play()', 'EXECUTE') then
    raise exception 'VERIFY: user_recent_tracks_record_play is anon-callable';
  end if;

  insert into auth.users (id, email)
  values (v_user, 'verify-recent@livil.invalid') on conflict (id) do nothing;
  insert into public.profiles (id, username)
  values (v_user, 'verify_recent_tmp') on conflict (id) do nothing;
  insert into public.tracks (id, uploader_id, title, media_kind, audio_url)
  values (v_track, v_user, 'Verify recent', 'audio', 'https://example.invalid/v.mp3');
  insert into public.posts (id, author_id, kind, track_id)
  values (v_post, v_user, 'upload', v_track);

  insert into public.post_views (post_id, user_id) values (v_post, v_user);
  insert into public.post_views (post_id, user_id) values (v_post, v_user);

  select count(*) into v_n from public.user_recent_tracks
   where user_id = v_user and track_id = v_track and last_post_id = v_post;
  if v_n <> 1 then
    raise exception 'VERIFY: a play did not produce exactly one history row (got %)', v_n;
  end if;

  delete from public.posts where id = v_post;
  delete from public.tracks where id = v_track;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;
end
$verify$;
