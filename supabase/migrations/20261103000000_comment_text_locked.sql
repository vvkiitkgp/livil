-- ============================================================================
-- A comment's words and attachment are fixed once it is posted
-- ============================================================================
--
-- post_comments_update_self has always let an author rewrite their own comment, and no
-- app has ever offered it: there is no Edit button in any build or on the web, and the
-- only UPDATEs to post_comments anywhere are the like_count counter triggers. Left open,
-- it is a way to rewrite a comment AFTER it has been seen — a reply notifies someone with
-- an insult (20261031000000 stores that text), then the stored comment is quietly made
-- harmless before anyone reports it, so the report shows the harmless version (security
-- review, 2026-10-17; owner's decision to lock, same day). It also let an author swap the
-- song or GIF a comment carries.
--
-- Now: body, the song columns and the GIF columns cannot change. One exception: the
-- shared song's post may be cleared, because `song_post_id ... ON DELETE SET NULL` clears
-- it when that post is deleted, and the database does that through an UPDATE.
--
-- Fires only when one of these columns is in the UPDATE (BEFORE UPDATE OF ...), so the
-- like_count counter triggers are untouched. Deleting a comment is untouched.
--
-- ADDITIVE for shipped apps: no build has ever updated a comment (checked at release
-- 2.1.3, 1c56cd0, and in web/). An "Edit comment" feature would start by relaxing this.
-- ============================================================================

create or replace function public.post_comments_lock_content()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.body is distinct from old.body
     or new.song_label is distinct from old.song_label
     or new.song_spotify_track_id is distinct from old.song_spotify_track_id
     -- Cleared is allowed: ON DELETE SET NULL, when the shared post is deleted.
     or (new.song_post_id is distinct from old.song_post_id and new.song_post_id is not null)
     or new.gif_provider is distinct from old.gif_provider
     or new.gif_id is distinct from old.gif_id
     or new.gif_width is distinct from old.gif_width
     or new.gif_height is distinct from old.gif_height
  then
    raise exception 'a comment cannot be edited after it is posted' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.post_comments_lock_content() from public, anon, authenticated;

drop trigger if exists trg_post_comments_lock_content on public.post_comments;
create trigger trg_post_comments_lock_content
  before update of body, song_label, song_spotify_track_id, song_post_id,
                   gif_provider, gif_id, gif_width, gif_height
  on public.post_comments
  for each row execute function public.post_comments_lock_content();
