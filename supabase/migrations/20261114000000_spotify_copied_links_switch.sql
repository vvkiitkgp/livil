-- ============================================================================
-- Kill switch for "Repost the song you copied?" (copied Spotify link detection)
-- ============================================================================
--
-- The app checks the clipboard for a copied Spotify song link when it opens and offers to
-- repost it (SpotifyClipboardPrompt, #303). On an iPhone that check can make iOS ask "Livil
-- would like to paste from …" (#315 keeps that to once per copied link). If people still have
-- trouble with it, the owner needs to turn the whole feature off for everyone at once, without
-- an app release (owner, 2026-10-21).
--
-- A second row in app_switches (20261013000000), read through its own function, exactly like
-- spotify_reposts. While it is off the app does no clipboard check at all and hides its
-- "Detect copied Spotify links" row in Privacy & data. Starts ON. A missing function (this
-- migration not applied) reads as off in the app.
--
-- Nothing is enforced here: the check runs on the phone and stores nothing, so there is no
-- write to refuse. Old apps never call the function — adding it changes nothing for them.
--
-- Flipped by the owner in the SQL editor:
--   update public.app_switches set enabled = false, updated_at = now()
--    where key = 'spotify_copied_links';

insert into public.app_switches (key, enabled) values ('spotify_copied_links', true)
on conflict (key) do nothing;

-- Signed-in users only, like spotify_reposts_enabled(). The table stays deny-all to clients.
create or replace function public.spotify_copied_links_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select coalesce(
    (select enabled from public.app_switches where key = 'spotify_copied_links'),
    false
  );
$function$;

revoke execute on function public.spotify_copied_links_enabled() from public, anon;
grant execute on function public.spotify_copied_links_enabled() to authenticated;
