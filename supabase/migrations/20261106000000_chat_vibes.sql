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
--   the other person played the song you shared (Livil play after the
--   share, or opening the Spotify song after the share)                 3 per shared song
--   a reaction to the other's message                                    1
--   a Jam in this chat that played 5+ minutes (host heartbeat)          10
--   a like or a comment on the other's post                              1
--
-- my_chat_vibes() answers only for the caller's own one-to-one chats, and nothing across
-- a block. "They played the song you shared" tells the sharer something about the other
-- person's listening — that is the feature, and it stays inside the pair.
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
       and not public.is_blocked_between((select auth.uid()), them.user_id)
  ),
  msgs as (
    select m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.metadata, m.created_at,
           public.message_preview(m.kind, m.body) = '🎵 Shared a song' as is_song
      from messages m
      join mine on mine.conversation_id = m.conversation_id
     where m.deleted_at is null
       and m.kind <> 'system'
  ),
  pts as (
    -- every message 1, a shared song 3
    select g.conversation_id, case when g.is_song then 3 else 1 end as p
      from msgs g

    union all
    -- the other person played the Livil song you shared, after you shared it
    select g.conversation_id, 3
      from msgs g
     where g.kind = 'track_share'
       and exists (select 1 from post_views v
                    where v.post_id::text = g.metadata->>'post_id'
                      and v.user_id <> g.sender_id
                      and v.user_id in (select cm.user_id from conversation_members cm
                                         where cm.conversation_id = g.conversation_id)
                      and v.played_at >= g.created_at)

    union all
    -- …or opened the Spotify song you shared, after you shared it
    select g.conversation_id, 3
      from msgs g
     where g.kind = 'text'
       and g.is_song
       and exists (select 1 from spotify_opens o
                    where o.spotify_track_id = substring(g.body from 'track[/:]([A-Za-z0-9]{22})')
                      and o.user_id <> g.sender_id
                      and o.user_id in (select cm.user_id from conversation_members cm
                                         where cm.conversation_id = g.conversation_id)
                      and o.created_at >= g.created_at)

    union all
    -- a reaction to the other person's message
    select g.conversation_id, 1
      from msgs g
      join message_reactions r on r.message_id = g.id
     where r.user_id <> g.sender_id

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
  'The caller''s one-to-one chats and the vibe of each: messages, shared songs (and the other '
  'person playing them), reactions, Jams, and likes/comments on each other''s posts. Nothing '
  'across a block, nothing for groups.';
