-- message_preview — what the inbox list says about a conversation's last message.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/message-preview.test.sql
--
-- A shared profile is a TEXT message whose body is exactly the profile link. The inbox must
-- say "👤 Shared a profile" for exactly those messages — the same rule the app uses to draw
-- a profile card (profileHandleIfExactLink) — and leave every other text message as typed.
-- Breaking either direction is silent: a raw URL in the list, or someone's sentence
-- replaced by "Shared a profile".
--
-- A shared Spotify song is likewise a TEXT message whose body is a direct track link
-- (20261017000000). The inbox says "🎵 Shared a Spotify song" — the push's words — for a body
-- that is exactly such a link (the app's TRACK_IN_TEXT_RE, whole body), and nothing else.

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert_text(label text, actual text, expected text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, coalesce(expected, 'NULL'), coalesce(actual, 'NULL');
  end if;
  raise notice 'ok    %', label;
end $$;

-- ── A profile link alone becomes "Shared a profile" ─────────────────────────
select pg_temp.assert_text('the link the Share sheet sends',
  public.message_preview('text', 'https://livil-music.com/@riya'), '👤 Shared a profile');
select pg_temp.assert_text('the www form with a trailing slash',
  public.message_preview('text', 'https://www.livil-music.com/@riya_99/'), '👤 Shared a profile');
select pg_temp.assert_text('surrounding whitespace from a paste',
  public.message_preview('text', E'  https://livil-music.com/@riya\n'), '👤 Shared a profile');

-- ── Everything else stays as typed ───────────────────────────────────────────
select pg_temp.assert_text('a link inside a sentence is the sentence',
  public.message_preview('text', 'follow https://livil-music.com/@riya'),
  'follow https://livil-music.com/@riya');
select pg_temp.assert_text('a link with text after it is the text — nothing hidden',
  public.message_preview('text', 'https://livil-music.com/@riya?your account is locked'),
  'https://livil-music.com/@riya?your account is locked');
select pg_temp.assert_text('a non-canonical capitalised handle is left alone, as the app leaves it',
  public.message_preview('text', 'https://livil-music.com/@Riya'), 'https://livil-music.com/@Riya');
select pg_temp.assert_text('a lookalike host is left alone',
  public.message_preview('text', 'https://livil-music.com.evil.test/@riya'),
  'https://livil-music.com.evil.test/@riya');
select pg_temp.assert_text('a post link is not a profile',
  public.message_preview('text', 'https://livil-music.com/p/8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e'),
  'https://livil-music.com/p/8f14e45f-ceea-4d1a-9c0f-1f2a3b4c5d6e');
select pg_temp.assert_text('ordinary text is still truncated to 80',
  public.message_preview('text', repeat('a', 100)), repeat('a', 80));

-- ── A Spotify track link alone becomes "Shared a Spotify song" ────────────────
select pg_temp.assert_text('the link the chat song search sends',
  public.message_preview('text', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'),
  '🎵 Shared a Spotify song');
select pg_temp.assert_text('a link copied from Spotify, with its ?si= query',
  public.message_preview('text', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=1a2b3c4d5e6f4a7b'),
  '🎵 Shared a Spotify song');
select pg_temp.assert_text('a localised link (intl-xx segment)',
  public.message_preview('text', 'https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT'),
  '🎵 Shared a Spotify song');
select pg_temp.assert_text('surrounding whitespace from a paste',
  public.message_preview('text', E'  https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT\n'),
  '🎵 Shared a Spotify song');
select pg_temp.assert_text('a spotify:track: URI',
  public.message_preview('text', 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'), '🎵 Shared a Spotify song');
select pg_temp.assert_text('no scheme, upper-case host — the app reads both',
  public.message_preview('text', 'OPEN.SPOTIFY.COM/track/4cOdK2wGLETKBW3PvgPWqT'), '🎵 Shared a Spotify song');

-- ── …and nothing else does ───────────────────────────────────────────────────
select pg_temp.assert_text('a Spotify link inside a sentence is the sentence',
  public.message_preview('text', 'listen https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'),
  'listen https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
select pg_temp.assert_text('a Spotify link with words after it keeps the words',
  public.message_preview('text', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT this one!!'),
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT this one!!');
select pg_temp.assert_text('an album is not a song',
  public.message_preview('text', 'https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT'),
  'https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT');
select pg_temp.assert_text('a short link might not be a song — left as typed',
  public.message_preview('text', 'https://spotify.link/AbCdEf123'), 'https://spotify.link/AbCdEf123');
select pg_temp.assert_text('a lookalike host is left alone',
  public.message_preview('text', 'https://open.spotify.com.evil.test/track/4cOdK2wGLETKBW3PvgPWqT'),
  'https://open.spotify.com.evil.test/track/4cOdK2wGLETKBW3PvgPWqT');
select pg_temp.assert_text('an id one character short is not a track',
  public.message_preview('text', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWq'),
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWq');
select pg_temp.assert_text('an id one character long is not a track',
  public.message_preview('text', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqTx'),
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqTx');
select pg_temp.assert_text('a trailing bracket ends the link, as in the app — so not the whole body',
  public.message_preview('text', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=ab)'),
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=ab)');
select pg_temp.assert_text('a profile link is still a profile',
  public.message_preview('text', 'https://livil-music.com/@riya'), '👤 Shared a profile');

-- ── The other kinds are unchanged ────────────────────────────────────────────
select pg_temp.assert_text('a shared track',
  public.message_preview('track_share', null), '🎵 Shared a track');
select pg_temp.assert_text('a jam invite',
  public.message_preview('jam_invite', null), '🎶 Started a Jam Room');
select pg_temp.assert_text('a sticker',
  public.message_preview('sticker', null), '🖼 Sent a sticker');
select pg_temp.assert_text('a system message has no preview',
  public.message_preview('system', 'x'), null);

rollback;
