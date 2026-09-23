-- ============================================================================
-- A blocked track stops existing for everyone except its owner
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- A takedown deletes the POSTS, which is what removes a track from feeds, profiles,
-- search and the public share page. But `posts` is not the only thing that points at a
-- track, and the others survive:
--
--   album_tracks      -> tracks   an album still lists it, and it still plays
--   user_recent_tracks -> tracks  "Recently played" still offers it
--   track_collaborators, jam state, and anything added later
--
-- So a blocked song could still be queued and played, just not discovered. Which is the
-- worst of both: gone from the places somebody would look, present in the places they
-- would not think to check.
--
-- ── WHY THIS IS ONE POLICY AND NOT N CLIENT FILTERS ────────────────────────
--
-- The alternative is `and taken_down_at is null` added to every query that reads a track
-- for playback. There are at least three today across two clients, and the failure mode
-- of missing one is silent: the track plays. Worse, each new surface — an album shuffle,
-- a radio queue, a jam handoff — inherits the bug by default and nothing complains.
--
-- Making the row UNREADABLE closes all of them at once, including the ones not written
-- yet. The queue cannot contain what the client cannot fetch.
--
-- ── EXCEPT THE OWNER, WHO MUST STILL SEE IT ────────────────────────────────
--
-- `uploader_id = auth.uid()` stays first. The whole point of the blocked card is that the
-- owner sees their own track, the reason, and a delete button. Hiding it from them too
-- would recreate the silent disappearance this all exists to fix.
--
-- ── WHAT IS DELIBERATELY NOT CHANGED ───────────────────────────────────────
--
-- Operator reads are SECURITY DEFINER (`ops_tracks_for_user`, `ops_copyright_scans`) and
-- bypass RLS, so moderation still sees everything. `moderation_actions` and
-- `post_removals` hold no track join at all — they carry plain uuids and their own copied
-- title precisely so they keep working when the track is invisible or gone.
--
-- Storage is untouched. The OBJECT remains at its public URL, so anybody holding the
-- direct link can still fetch the audio. That is stated plainly in the operator UI and
-- does not change here: removing bytes needs the storage probe nobody has run.

drop policy if exists "tracks_select_authenticated" on public.tracks;
create policy "tracks_select_authenticated" on public.tracks
  for select to authenticated
  using (
    uploader_id = (select auth.uid())
    or (
      taken_down_at is null
      and not public.is_blocked_between((select auth.uid()), uploader_id)
    )
  );

comment on column public.tracks.taken_down_at is
  'Set by ops_take_down_track. The track and its files survive — only the posts are '
  'deleted — so a takedown can be reversed by ops_restore_track. While set, the row is '
  'readable ONLY by its uploader, which is what keeps a blocked track out of albums, '
  'recently-played and every future playback surface.';

do $verify$
declare
  v_expr text;
begin
  select pg_get_expr(polqual, polrelid) into v_expr
    from pg_policy where polrelid = 'public.tracks'::regclass
     and polname = 'tracks_select_authenticated';

  if v_expr is null or v_expr not like '%taken_down_at%' then
    raise exception 'VERIFY: blocked tracks are still readable — albums and recently-played will keep playing them';
  end if;

  -- The owner clause must remain, and must remain FIRST in effect: without it the person
  -- whose upload was blocked cannot see their own blocked card.
  if v_expr not like '%uploader_id%' then
    raise exception 'VERIFY: the uploader can no longer see their own blocked track';
  end if;
end
$verify$;
