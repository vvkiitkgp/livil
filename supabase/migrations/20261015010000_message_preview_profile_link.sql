-- Inbox preview for a shared profile: "👤 Shared a profile", not the raw link.
--
-- Design: kb/architecture/post-sharing.md §10 ("Profile links").
--
-- A shared profile travels as a plain TEXT message whose body is exactly the profile link
-- (shareProfileToConversations) — deliberately not a new `messages.kind`, so every installed
-- build can read it. The inbox row, though, shows `conversations.last_message_preview`, which
-- `message_preview()` fills from the body — so the list read
-- "https://livil-music.com/@riya" where a shared track reads "🎵 Shared a track".
--
-- `message_preview` (20260730000000) is the ONE place that text is made, for both the
-- insert trigger and the recompute-on-delete trigger. Only its `text` branch changes: a body
-- that is exactly a canonical profile link becomes '👤 Shared a profile'. The rule matches
-- the app's `profileHandleIfExactLink` (src/utils/shareLinks.ts) — exact link, lowercase
-- handle, apex or www, optional trailing slash, surrounding whitespace ignored — so the
-- chat list says "profile" exactly when the chat itself draws a profile card. A link inside
-- a sentence stays as typed.
--
-- ── WHY THIS IS SAFE FOR APPS ALREADY INSTALLED ────────────────────────────
-- Same function, same signature, same return type; only a display string differs for one
-- kind of message. Every build shows `last_message_preview` as text, so the store build
-- shows "👤 Shared a profile" too — the same way it already shows "🎵 Shared a track".
--
-- ── EXISTING DATA ───────────────────────────────────────────────────────────
-- The backfill rewrites `last_message_preview` for conversations whose stored preview is
-- exactly a profile link — 1 row in production on 2026-10-09 (a test share). Only that
-- derived display column; no message is touched, and the next message in the conversation
-- overwrites it anyway. Runs with auth.uid() null, which conversations_freeze_derived
-- (20260722180000) permits by design.

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
   set last_message_preview = '👤 Shared a profile'
 where last_message_preview ~ '^\s*https://(www\.)?livil-music\.com/@[a-z0-9_-]{1,40}/?\s*$';
