-- ============================================================================
-- A posted comment is fixed: its words, attachment, id and time
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
-- 1. UPDATE: body, the song columns, the GIF columns, id and created_at cannot change.
--    One exception: song_post_id may be CLEARED when the post it shared is gone — that is
--    `song_post_id ... ON DELETE SET NULL`, which the database performs as an UPDATE. An
--    author clearing it by hand is refused (the original_post_id rule, 20260722140000).
--    Fires only when one of these columns is in the UPDATE (BEFORE UPDATE OF ...), so the
--    like_count counter triggers are untouched. Deleting a comment is untouched.
--
-- 2. INSERT: the server picks a new comment's id and time, and its like_count starts at 0.
--    Otherwise the lock has a side door — delete the reply, then insert the harmless
--    version under the SAME id and created_at, and the notification that quoted the
--    insult now opens the harmless comment (security review of (1), 2026-10-17). The same
--    door let a client post a comment with like_count = 9999 and pin it to the top of a
--    thread (comments sort by like_count). posts got this clamp in 20260722160000;
--    post_comments never did.
--
-- ADDITIVE for shipped apps: no build has ever updated a comment, and every build inserts
-- only {post_id, author_id, body, parent_comment_id} (+ song / GIF columns on newer
-- builds) and reads the row back — never sending id, created_at or like_count (checked
-- at every release commit through 2.1.3, 1c56cd0, and in web/). An "Edit comment"
-- feature would start by relaxing (1).
-- ============================================================================

-- ── 1. A posted comment cannot be edited ───────────────────────────────────
-- SECURITY DEFINER for the posts lookup alone: as invoker it would run under posts RLS,
-- and a post the author cannot see would read as "gone" and let a hand-written null in.
create or replace function public.post_comments_lock_content()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.body is distinct from old.body
     or new.song_label is distinct from old.song_label
     or new.song_spotify_track_id is distinct from old.song_spotify_track_id
     or new.gif_provider is distinct from old.gif_provider
     or new.gif_id is distinct from old.gif_id
     or new.gif_width is distinct from old.gif_width
     or new.gif_height is distinct from old.gif_height
  then
    raise exception 'a comment cannot be edited after it is posted' using errcode = '42501';
  end if;

  if new.song_post_id is distinct from old.song_post_id then
    -- Allowed only when this is the FK's ON DELETE SET NULL firing: the column is being
    -- cleared, and the post it pointed at no longer exists.
    if not (new.song_post_id is null
            and not exists (select 1 from public.posts where id = old.song_post_id)) then
      raise exception 'a comment cannot be edited after it is posted' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.post_comments_lock_content() from public, anon, authenticated;

drop trigger if exists trg_post_comments_lock_content on public.post_comments;
create trigger trg_post_comments_lock_content
  before update of id, created_at, body, song_label, song_spotify_track_id, song_post_id,
                   gif_provider, gif_id, gif_width, gif_height
  on public.post_comments
  for each row execute function public.post_comments_lock_content();

-- ── 2. The server, not the client, picks a new comment's id and time ───────
-- Clamped rather than raised, as posts_clamp_counters_on_insert is: no client sends
-- these, so a raise would only fire on an attack, and clamping stays correct for a future
-- client that sends back a whole row it read.
--
-- Gated on the ROLE — the row came in through the API as a signed-in user — where the
-- posts clamp gates on auth.uid(). Same rows in production; but service-role and
-- owner-run code (seeding, tests that stub auth.uid()) can still place a comment with a
-- known id. SECURITY INVOKER so current_user is the caller's role.
create or replace function public.post_comments_clamp_on_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.id         := gen_random_uuid();
    new.created_at := now();
    new.like_count := 0;
  end if;
  return new;
end;
$$;

revoke execute on function public.post_comments_clamp_on_insert() from public, anon, authenticated;

drop trigger if exists trg_post_comments_clamp_on_insert on public.post_comments;
create trigger trg_post_comments_clamp_on_insert
  before insert on public.post_comments
  for each row execute function public.post_comments_clamp_on_insert();
