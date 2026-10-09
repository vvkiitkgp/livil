-- message_preview — what the inbox list says about a conversation's last message.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/message-preview.test.sql
--
-- A shared profile is a TEXT message whose body is exactly the profile link. The inbox must
-- say "👤 Shared a profile" for exactly those messages — the same rule the app uses to draw
-- a profile card (profileHandleIfExactLink) — and leave every other text message as typed.
-- Breaking either direction is silent: a raw URL in the list, or someone's sentence
-- replaced by "Shared a profile".

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
