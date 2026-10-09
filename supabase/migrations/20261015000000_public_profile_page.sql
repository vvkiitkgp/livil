-- Public profile links — `https://livil-music.com/@<username>`.
--
-- Design: kb/architecture/post-sharing.md §10 ("Profile links").
--
-- ── WHAT THE PAGE IS, AND WHAT IT IS NOT ───────────────────────────────────
-- The profile page on the web is a SIGNPOST, not a profile. It exists so that
--
--   * a link pasted into WhatsApp / iMessage / an Instagram bio unfurls into a card that
--     names the person ("Riya (@riya) on Livil") instead of a bare URL, and
--   * an artist's page can be indexed by a search engine under their name,
--
-- and on any tap it sends the visitor into the app (or to the store). The profile itself —
-- bio, uploads, friends, stars, counts — is only ever shown inside the app, to a signed-in
-- viewer, under the existing RLS. That was the owner's explicit call (2026-10-09): "profile
-- can only be seen in the app".
--
-- So the anonymous surface this adds is deliberately TINY: a name, a handle, a photo, and
-- one boolean, for ONE handle the caller already knows. Nothing else about a person
-- crosses to `anon`, and nothing can be listed.
--
-- Same shape as `shared_post_public` (20260901000000): SECURITY DEFINER with an
-- ENUMERATED return type, so `profiles_select_authenticated` stays exactly as it is and
-- `anon` still cannot select a single row from `profiles`. The return type is a published
-- contract with the whole internet; adding a column to `profiles` changes nothing here,
-- which is the point of not writing `select *`.
--
-- ── WHY THERE IS NO ARTIST SITEMAP (YET) ───────────────────────────────────
-- A sitemap listing every artist's handle was built and deliberately held back. On its own
-- it is harmless — handles are public — but `get_email_for_username` (20260607000003) is
-- still executable by `anon` in production (verified 2026-10-09; the username sign-in
-- screen calls it before there is a session), and it returns the login email for any
-- handle. A public list of handles + that function = every artist's email address,
-- harvested by someone with no account. Today that harvest needs a (free) account to list
-- usernames; a sitemap would remove even that step. Ship the sitemap after username
-- sign-in stops handing emails to the client and that grant is revoked — see
-- check-definer-anon-grants.mjs, where it is already flagged.
--
-- ── WHO IS NEVER SHOWN AT ALL ──────────────────────────────────────────────
--   * unconfirmed sign-ups (ADR-0025) — the same CASE the profiles policy uses, so the
--     cached column is trusted when true and auth.users is consulted only when it is not;
--   * accounts that have not chosen their username yet (`username_set = false`): their
--     handle is a placeholder that is about to change, and a link built on it would break.
--     Every other handle is permanent (20260628000000 blocks the change), which is what
--     makes a handle-based URL safe to put in a bio at all.
--
-- ── A DISPLAY NAME THAT IS REALLY AN EMAIL ─────────────────────────────────
-- `handle_new_user` has fallen back to the email's local part for the display name
-- (accounts made by an OAuth provider that sent no name). For a gmail user that local
-- part IS the address. It was visible only to signed-in users; this page would put it on
-- the open web and, for an artist, in a search index. So when the display name equals the
-- local part it comes back NULL, and the page shows the handle instead. 0 such rows in
-- production on 2026-10-09 — this is a guard, not a cleanup.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Purely additive: one new function, no table, column, policy or existing function is
-- touched. No shipped build calls it, so nothing changes for anyone until the web page
-- starts using it.

create or replace function public.public_profile_card(p_username text)
returns table (
  username     text,
  display_name text,
  avatar_url   text,
  is_artist    boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    pr.username,
    -- `is distinct from`, not `<>`: a NULL email must not turn every name into NULL.
    case
      when pr.display_name is distinct from split_part(u.email, '@', 1) then pr.display_name
    end,
    pr.avatar_url,
    -- An artist = has published at least one upload whose track is still up. Decides
    -- whether the page may be indexed; never shown as a label.
    exists (
      select 1
        from public.posts  po
        join public.tracks t on t.id = po.track_id
       where po.author_id = pr.id
         and po.kind = 'upload'
         and t.taken_down_at is null
    )
  from public.profiles pr
  left join auth.users u on u.id = pr.id
  -- `lower(username)` is what `profiles_username_lower_key` indexes, so this is a unique
  -- index probe, not a scan, however the visitor capitalised the URL.
  where lower(pr.username) = lower(btrim(p_username))
    and pr.username_set
    and (case when pr.email_confirmed then true else public.auth_email_confirmed(pr.id) end)
  limit 1;
$$;

comment on function public.public_profile_card(text) is
  'Public profile link page (livil-music.com/@<username>). Granted to anon by design: '
  'returns ONLY handle, display name (NULL when it is the email local part), avatar and '
  'whether the person has published music, for one handle. Zero rows for unconfirmed '
  'accounts and unchosen usernames. See 20261015000000.';

-- Written out rather than inherited from Supabase's default privileges, for the same
-- reason as shared_post_public: the grant IS the feature, so it is stated where a
-- reviewer reads it. `revoke ... from public` first so the only grants are these.
revoke all     on function public.public_profile_card(text) from public;
grant  execute on function public.public_profile_card(text) to anon, authenticated;
