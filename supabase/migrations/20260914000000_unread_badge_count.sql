-- The number on the app's home-screen icon, computed server-side.
--
-- WHY THIS EXISTS
--
-- While the app is running, the client already knows its own unread total: HomeScreen
-- keeps `unread messages + incoming friend requests + unread livil Bot activity` live
-- from three realtime subscriptions, and pushes it at the OS badge directly. No server
-- round-trip is involved, and none is wanted -- the badge must move the instant a
-- message lands, not one network hop later.
--
-- The problem is the case the badge exists FOR: the app is not running. On iOS the
-- badge number is carried in the push payload itself (`aps.badge`), which means the
-- SENDER has to know the recipient's total at send time. Only the database can answer
-- that. Hence this function, called by the `send-push` edge function while it builds
-- the APNs payload.
--
-- Android needs nothing here: Android has no API to set an app's badge, and derives it
-- from the notifications in the tray instead (see src/services/appBadge.ts).
--
-- WHY IT IS `_for(uuid)` AND NOT `auth.uid()`
--
-- `send-push` runs as service_role and computes the badge for the RECIPIENT, who is by
-- definition not the caller -- so an `auth.uid()` version cannot serve it. But a
-- SECURITY DEFINER function that takes an arbitrary user id is an information leak if
-- any client can call it: "how many unread messages does @riya have" is not public.
-- The grants at the bottom are therefore load-bearing, not boilerplate. EXECUTE is
-- revoked from anon/authenticated and granted only to service_role, so the only way to
-- reach it is with the service key, which never leaves the edge function.
--
-- There is deliberately NO `auth.uid()` convenience wrapper. The client does not need
-- one (it computes the total locally, live), and adding one would create a second
-- definition of "unread" that could drift from this one.
--
-- WHY THE THREE COUNTS LOOK LIKE THIS
--
-- Each mirrors an existing, already-shipped definition. They are copied rather than
-- reused because the originals are all `auth.uid()`-scoped and cannot be parameterised
-- without changing their signatures:
--
--   messages  -> the `unread_count` subquery inside `list_my_conversations()`
--                (20260528000000_chat_jam.sql). Same three predicates, same NULL
--                semantics: `created_at > last_read_at` yields NULL -- and so excludes
--                the row -- when `last_read_at` is NULL. That column defaults to
--                now(), so this is a theoretical case, but it must match the client's
--                behaviour rather than quietly diverge from it.
--
--   friends   -> the `pendingIncoming` bucket in loadViewerRelationships()
--                (src/services/relationships.ts): a friendship row naming me that I did
--                not request. Narrowed to status = 'pending' explicitly. The client
--                derives the bucket by elimination (`not accepted` + `not requested by
--                me`), which also sweeps in status = 'blocked'; block_user() deletes the
--                friendship row, so no such row should exist -- but counting one toward
--                a badge that can never be cleared is the kind of bug that ships.
--
--   activity  -> `activity_unread_count()` (20260608000000_activity_notifications.sql),
--                unchanged apart from the parameterised recipient.
--
-- IF YOU CHANGE ONE OF THE THREE ORIGINALS, CHANGE IT HERE TOO. A badge that disagrees
-- with the in-app count reads as a broken app: the icon says 3, the inbox says 1, and
-- nothing the user does clears it.
create or replace function public.unread_badge_count_for(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    coalesce((
      select count(*)
      from conversation_members cm
      join messages m on m.conversation_id = cm.conversation_id
      where cm.user_id = p_user_id
        and m.created_at > cm.last_read_at
        and m.sender_id <> p_user_id
        and m.deleted_at is null
    ), 0)
    + coalesce((
      select count(*)
      from friendships f
      where f.status = 'pending'
        and f.requested_by <> p_user_id
        and (f.user_a_id = p_user_id or f.user_b_id = p_user_id)
    ), 0)
    + coalesce((
      select count(*)
      from activity_notifications an
      where an.recipient_id = p_user_id
        and an.is_read = false
    ), 0)
  )::int;
$$;

-- Load-bearing. See "WHY IT IS `_for(uuid)`" above: without these, any signed-in user
-- could read any other user's unread counts.
revoke all on function public.unread_badge_count_for(uuid) from public;
revoke all on function public.unread_badge_count_for(uuid) from anon;
revoke all on function public.unread_badge_count_for(uuid) from authenticated;
grant execute on function public.unread_badge_count_for(uuid) to service_role;
