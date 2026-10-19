-- ============================================================================
-- Chat vibe: a number between two friends that grows as they chat and share
-- ============================================================================
--
-- Owner's design (2026-10-17): in the chat list, each one-to-one chat shows a "vibe" — an
-- ever-growing number, no cap, no levels, no fading, no daily limits — that only the two
-- people in it can see. Group chats have none. ADR-0032 (music score) is its sibling; this
-- one is live rather than nightly because it is private to the pair.
--
-- Points, all between the two of you:
--   a message (either of you; not system messages, not deleted)        1
--   a shared song (Livil track or Spotify link) — instead of the 1     3
--   a reaction by one of you to the other's message                     1
--   a Jam in this chat that played 5+ minutes (host heartbeat)          10
--   a like or a comment on the other's post                              1
--
-- my_chat_vibes() answers only for the caller's own one-to-one chats (exactly two
-- members), and nothing across a block.
--
-- NOT counted, on purpose: "the other person played the song you shared". It needs the
-- friend's play history (post_views) and Spotify opens, which no one else may read, and a
-- sender can rewrite an old message into a share of any song — so the number became a
-- lookup of what the friend had played, ignoring their "keep my listening private" switch
-- (security review, 2026-10-18). Nothing here reads anyone's listening.
--
-- ADDITIVE: one new function no shipped app calls. The new app hides the vibe when it is
-- missing.
-- ============================================================================

create or replace function public.my_chat_vibes()
returns table (conversation_id uuid, vibe bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select c.id as conversation_id, them.user_id as friend_id
      from conversations c
      join conversation_members me
        on me.conversation_id = c.id and me.user_id = (select auth.uid())
      join conversation_members them
        on them.conversation_id = c.id and them.user_id <> (select auth.uid())
     where c.kind = 'dm'
       and (select count(*) from conversation_members x where x.conversation_id = c.id) = 2
       and not public.is_blocked_between((select auth.uid()), them.user_id)
  ),
  pts as (
    -- every message 1, a shared song 3. message_preview decides what a shared song is;
    -- the LIKE only spares it the text messages that cannot be one.
    select m.conversation_id,
           case when m.kind = 'track_share'
                  or (m.kind = 'text' and m.body like '%spotify%'
                      and public.message_preview(m.kind, m.body) = '🎵 Shared a song')
                then 3 else 1 end as p
      from messages m
      join mine on mine.conversation_id = m.conversation_id
     where m.deleted_at is null
       and m.kind <> 'system'

    union all
    -- a reaction by one of the two to the other's message
    select m.conversation_id, 1
      from messages m
      join mine on mine.conversation_id = m.conversation_id
      join message_reactions r on r.message_id = m.id
     where m.deleted_at is null
       and m.kind <> 'system'
       and r.user_id in ((select auth.uid()), mine.friend_id)
       and r.user_id <> m.sender_id

    union all
    -- a Jam in this chat that played 5+ minutes
    select j.conversation_id, 10
      from jam_rooms j
      join mine on mine.conversation_id = j.conversation_id
     where coalesce(j.last_played_at, j.host_clock_at) - j.started_at >= interval '5 minutes'

    union all
    -- a like on the other's post, either way round
    select mine.conversation_id, 1
      from mine
      join post_likes l on l.user_id in ((select auth.uid()), mine.friend_id)
      join posts p on p.id = l.post_id
     where p.author_id in ((select auth.uid()), mine.friend_id)
       and p.author_id <> l.user_id

    union all
    -- a comment on the other's post, either way round
    select mine.conversation_id, 1
      from mine
      join post_comments c on c.author_id in ((select auth.uid()), mine.friend_id)
      join posts p on p.id = c.post_id
     where p.author_id in ((select auth.uid()), mine.friend_id)
       and p.author_id <> c.author_id
  )
  select pts.conversation_id, sum(pts.p)::bigint
    from pts
   group by pts.conversation_id
$$;

revoke execute on function public.my_chat_vibes() from public, anon;
grant execute on function public.my_chat_vibes() to authenticated;

comment on function public.my_chat_vibes() is
  'The caller''s one-to-one chats and the vibe of each: messages, shared songs, reactions, '
  'Jams, and likes/comments on each other''s posts. Reads no one''s listening. Nothing across '
  'a block, nothing for groups.';
