-- ============================================================================
-- profiles: bound the free-text columns, and require a real scheme on links
-- ============================================================================
--
-- From the security review of the dashboard branch. Both findings are pre-existing; both
-- must be closed before a browser profile editor ships, because a browser is a much easier
-- place to exploit either.
--
-- ── 1. UNBOUNDED FREE TEXT ────────────────────────────────────────────────────
--
-- The ONLY constraint on `profiles` in the entire migration set is
-- `profiles_links_max_10` (20260607000000_edit_profile_schema.sql:7-9). `display_name`,
-- `bio`, `avatar_url` and each `links` element have no length limit at all.
--
-- `tracks` got this right — `title` is 1..120 and `description` is <= 2000. `profiles` was
-- simply missed.
--
-- It matters more here than it looks, because `profiles_select_authenticated` is
-- `using (true)`: a multi-megabyte `bio` is downloaded by every feed page, every search
-- result and every profile view that touches that row. Unbounded is a defect.
--
-- Bounds are deliberately LOOSER than the mobile client's own limits (DISPLAY_NAME_MAX = 50,
-- BIO_MAX = 160 in EditProfileScreen.tsx:39-40). The client is the usability gate; this is
-- the perimeter. Matching them exactly would mean a trailing-whitespace difference between
-- client and server turns a legitimate save into a failed one.
--
-- ── 2. links HAS NO SCHEME VALIDATION, AND THAT IS STORED XSS ON WEB ──────────
--
-- `links text[]` accepts anything. The client's entire cleaning is
-- `.map(trim).filter(length > 0)` (EditProfileScreen.tsx:254-256).
--
-- Mobile is safe today, and for one specific reason worth naming so it is not deleted as
-- redundant: `normalizeUrl` in ProfileScreen.tsx:63-65 prefixes `https://` onto anything
-- without a scheme before `Linking.openURL`. So `javascript:alert(1)` becomes
-- `https://javascript:alert(1)` — inert. So do `data:`, `intent:` and `livil://`, that last
-- one mattering because a profile link chip would otherwise be an attacker-controlled deep
-- link into our own app.
--
-- The web dashboard has no equivalent, and the naive rendering is exploitable: React does
-- NOT sanitize `href`. It logs a development warning and renders the attribute anyway, so in
-- a production build `<a href={link}>` with a stored `javascript:` value fires. The
-- dashboard keeps its Supabase session in localStorage, so that is account takeover of any
-- artist who views the attacker's profile — and there is no CSP to catch it.
--
-- Validating in the renderer is not enough. There will be a third client. The perimeter is
-- the database.
--
-- ── Why a function-backed CHECK rather than a trigger ─────────────────────────
--
-- The repo's house pattern for column rules is a trigger, but every one of those needs to
-- compare OLD and NEW (counter freezes, username immutability) — something CHECK cannot do.
-- This rule only inspects the new value, so CHECK is the right and stronger tool: it is
-- declarative, it shows up in \d, and it applies to every writer including future ones.
-- A CHECK cannot contain a subquery or a set-returning call directly, hence the IMMUTABLE
-- helper.
--
-- Verified against production before writing: longest display_name 17, longest bio 14,
-- longest avatar_url 135, longest link 83, and 0 of 2 existing links lack a scheme. Nothing
-- currently stored violates any bound below, so ADD CONSTRAINT will validate cleanly.

-- ── links validator ─────────────────────────────────────────────────────────

create or replace function public.profile_links_ok(p_links text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  -- bool_and over an empty set is NULL, which a CHECK treats as passing; coalesce anyway so
  -- the intent is explicit rather than incidental.
  select coalesce(
    -- Length is checked separately from the pattern because Postgres caps regex
    -- repetition counts at 255 — `{1,480}` is rejected as an invalid repetition count.
    bool_and(l ~ '^https?://[^[:space:]]+$' and char_length(l) <= 500),
    true
  )
  from unnest(coalesce(p_links, '{}'::text[])) as l;
$$;

comment on function public.profile_links_ok(text[]) is
  'Every profile link must be an http(s) URL with no whitespace, at most 500 chars total. '
  'Blocks javascript:, data:, intent: and livil:// — the last because a profile link chip '
  'would otherwise be an attacker-controlled deep link into our own app.';

-- ── Constraints ─────────────────────────────────────────────────────────────

alter table public.profiles
  drop constraint if exists profiles_display_name_len,
  drop constraint if exists profiles_bio_len,
  drop constraint if exists profiles_avatar_url_len,
  drop constraint if exists profiles_links_are_http;

alter table public.profiles
  add constraint profiles_display_name_len
    check (display_name is null or char_length(display_name) <= 80),

  add constraint profiles_bio_len
    check (bio is null or char_length(bio) <= 500),

  -- Ours are Supabase public URLs around 135 chars. Bounded and scheme-checked: an
  -- `<img src>` will not execute a javascript: URL, but there is no reason to store one.
  add constraint profiles_avatar_url_len
    check (
      avatar_url is null
      or (char_length(avatar_url) <= 500 and avatar_url ~ '^https?://')
    ),

  add constraint profiles_links_are_http
    check (public.profile_links_ok(links));
