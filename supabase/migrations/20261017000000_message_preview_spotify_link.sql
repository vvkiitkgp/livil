-- Inbox preview for a shared Spotify song: "🎵 Shared a Spotify song", not the raw link.
--
-- Design: ADR-0027 (Spotify reposts — chat song cards).
--
-- A Spotify song in chat travels as a plain TEXT message whose body is the track's link
-- (the 🎵 song search sends `https://open.spotify.com/track/<id>`; a pasted link is the same)
-- — deliberately not a new `messages.kind`, so every installed build can read it. The chat
-- draws it as a song card and the push says "🎵 Shared a Spotify song", but the inbox row
-- shows `conversations.last_message_preview`, which `message_preview()` fills from the body —
-- so the list read "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT".
--
-- `message_preview` (20260730000000, last changed 20261015010000) is the ONE place that text
-- is made, for both the insert trigger and the recompute-on-delete trigger. This copies the
-- 20261015010000 definition exactly and adds one branch to its `text` case: a body that is
-- exactly a direct Spotify track link becomes '🎵 Shared a Spotify song'. The rule is the
-- app's direct-link rule (TRACK_IN_TEXT_RE in src/utils/spotifyLinks.ts, used by the chat
-- card and by the push preview in src/services/messages.ts) applied to the WHOLE body:
--
--   [http(s)://]open.spotify.com/[intl-xx/]track/<22-char id>[?query or #fragment]
--   spotify:track:<22-char id>
--
-- case-insensitive, surrounding whitespace ignored. A link inside a sentence, or with
-- anything after it, stays as typed — nobody's words are hidden behind "Shared a song".
--
-- NOT short links (spotify.link/<code>): only the server can tell what one points at, and the
-- chat draws a card for it only once it resolves to a TRACK. Calling an album link a "song"
-- here would be wrong, so a short link stays as typed.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Same function, same signature, same return type; only a display string differs for one
-- kind of message. Every build shows `last_message_preview` as text, so the store build
-- shows "🎵 Shared a Spotify song" too — the same way it already shows "🎵 Shared a track"
-- and "👤 Shared a profile". The store build still draws the message itself as the raw link,
-- which is unchanged.
--
-- ── EXISTING DATA ───────────────────────────────────────────────────────────
-- The backfill rewrites `last_message_preview` for conversations whose stored preview is
-- exactly such a link. Count not measured against production when written; any build could
-- always paste a Spotify link, so expect a handful. Only that derived display column; no
-- message is touched, and the next message in the conversation overwrites it anyway. Runs
-- with auth.uid() null, which conversations_freeze_derived (20260722180000) permits by design.
--
-- One guard the profile-link backfill did not need: the stored preview is left(body, 80), and
-- a Spotify link with an `?si=` query can reach 80 characters. At exactly 80 the stored value
-- may be a cut-off longer message (a link, then words), so only previews SHORTER than 80 —
-- which are the whole body — are rewritten. A link of 80+ characters keeps showing until the
-- next message, as it does today.

create or replace function public.message_preview(p_kind text, p_body text)
returns text
language sql
immutable
as $$
  select case p_kind
           when 'text' then
             case
               when p_body ~ '^\s*https://(www\.)?livil-music\.com/@[a-z0-9_-]{1,40}/?\s*$'
                 then '👤 Shared a profile'
               when p_body ~* '^\s*((https?://)?open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]{22}([?#][^\s)>"'']*)?|spotify:track:[a-z0-9]{22})\s*$'
                 then '🎵 Shared a Spotify song'
               else left(p_body, 80)
             end
           when 'track_share' then '🎵 Shared a track'
           when 'jam_invite'  then '🎶 Started a Jam Room'
           when 'sticker'     then '🖼 Sent a sticker'
           when 'system'      then null
           else left(p_body, 80)
         end
$$;

update public.conversations
   set last_message_preview = '🎵 Shared a Spotify song'
 where char_length(last_message_preview) < 80
   and last_message_preview ~* '^\s*((https?://)?open\.spotify\.com/(intl-[a-z-]+/)?track/[a-z0-9]{22}([?#][^\s)>"'']*)?|spotify:track:[a-z0-9]{22})\s*$';
