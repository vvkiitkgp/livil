-- ============================================================================
-- The last paths around a hidden post (ADR-0028 follow-up, after 20261111000000)
-- ============================================================================
--
-- THE GAP. posts_select_authenticated (20261019000000) hides a friends-only repost from
-- everyone but the reposter's accepted friends, and a blocked pair's posts from each
-- other. 20261111000000 made likes, comments and comment likes follow that rule. Its
-- security review found four more paths, all older than the switch, open to a caller who
-- holds a hidden post's id (sharing a repost in chat hands such ids to non-friends):
--
--   1. posts_insert_own checks only author_id. "Repost only uploads" lived in the app
--      (createRepost), so a direct insert of posts(kind='repost', original_post_id=<a
--      friends-only repost>) was stored, bumped that repost's reposts_count (a feed
--      ranking term) and let activity_notify_post push "reposted your post" to its owner.
--   2. activity_notify_post / activity_notify_comment are SECURITY DEFINER and checked only
--      that the caller's like / comment / repost row exists. A like left from before the
--      post was hidden (or before 20261111000000) still notified, and the call returned
--      agg_count: the live number of people who like a post the caller cannot see.
--      Neither function checked blocks either, so a blocked person's leftover like,
--      comment or repost kept pushing to the person who blocked them.
--   3. activity_record_play is DEFINER and inserted a play for ANY post id, returning its
--      views_count — and the caller reads the play back (post_views_select_own): a play
--      counter and an existence oracle for posts the policy hides. (A non-existent id
--      raised a foreign-key error instead, which told "hidden" apart from "no such post".)
--   4. post_comment_likes sits in the supabase_realtime publication with REPLICA IDENTITY
--      FULL. Realtime does not apply RLS to DELETE events, so every subscriber was sent
--      (comment_id, user_id) — the primary key — for every unlike in the app. No build has
--      ever subscribed to it: the comment sheet listens to post_comments only, and reads
--      like_count off the comment row.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--   1. posts_insert_own: a post with an original must name an UPLOAD the caller can see,
--      carrying that upload's track. The EXISTS runs as the caller, so the posts read
--      policy applies to it (the stories_insert pattern, 20260724120000). Uploads and
--      Spotify reposts have no original and are untouched.
--   2, 3. The three DEFINER functions repeat posts_select_authenticated BY HAND, as
--      record_post_impressions (20261019000000) and can_comment_on_post (20261111000000)
--      do — the same predicate, not a paraphrase, so they cannot drift into disagreeing
--      about who can see what. A post the caller cannot see is treated exactly like one
--      that does not exist: no row written, no row returned. activity_record_play checks
--      FIRST, so a missing id now returns nothing too, instead of a foreign-key error.
--   4. post_comment_likes leaves the publication; its replica identity goes back to the
--      default (FULL existed only to give Realtime the old row).
--
-- Every function body below is copied from its current definition (activity_notify_post:
-- 20260929010000; activity_notify_comment: 20261031000000; activity_record_play:
-- 20260722000000 + 20260724000000's search_path) with only the marked block added.
--
-- ── WHO NOTICES ─────────────────────────────────────────────────────────────
-- Nobody, in what the app shows. These calls are made by the app for a post it has just
-- loaded through posts_select_authenticated (or, for a repost, an upload it has loaded),
-- so the new check is already true for honest calls, with the one exception noted under
-- plays:
--   * createRepost (2.1.3 and main) reads the original first and refuses a non-upload;
--     the guide's auto-reposts go through it; Spotify reposts send no original.
--     Production: 0 reposts whose original is not an upload, 0 whose track differs.
--   * The like / comment / reply / repost notifications follow the action, on a post on
--     screen. A post that becomes hidden between the tap and the call notifies nobody.
--   * Plays are recorded for the post the player is on, which the app loaded under the
--     policy — with ONE exception: a jam LISTENER plays the host's post straight from the
--     host's broadcast (JamRealtimeContext) and never reads it. When the host plays a
--     friends-only repost by someone the listener is not friends with (or anything by
--     someone the listener is blocked with), the listener's play is no longer counted on
--     that post and no longer lands in their Recently Played, where it already opened as
--     "no longer available". Accepted: a hidden post's counter should not hear from
--     people it is hidden from. Counting it against the original upload instead needs
--     the host to broadcast the original's id (an app change).
--     The other "exception" is stale lists: a post hidden after it was loaded.
--   * Both app versions treat an empty RPC result as "nothing to push" (2.1.3:
--     src/services/activity.ts:378, posts.ts:1056).
--
-- ── OLD APPS ────────────────────────────────────────────────────────────────
-- No column, function signature or return shape changes; the publication change removes
-- events no build listens for. Safe to apply before or after 20261111000000.
-- ============================================================================


-- ── 1. posts_insert_own: an original must be a visible upload ───────────────
-- NOTE ON QUALIFICATION — load-bearing, do not "simplify". The new row is referred to as
-- `posts.<col>`; the original is aliased `o`. posts has its own original_post_id and
-- track_id, so an UNQUALIFIED name inside `from public.posts o` binds to `o` (inner scope
-- wins): `o.id = original_post_id` would silently become `o.id = o.original_post_id`
-- (NULL for every upload) and refuse every repost. The test's 1d (an honest repost must
-- be accepted) is what catches that.
--
-- Replaced, never added alongside: two permissive INSERT policies are OR'd, and the old
-- one alone admits anything with your author_id.
drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      original_post_id is null
      or exists (
        select 1 from public.posts o
         where o.id = posts.original_post_id
           and o.kind = 'upload'
           and o.track_id = posts.track_id
      )
    )
  );


-- ── 2a. activity_notify_post ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_notify_post(p_post_id uuid, p_type text, p_comment_text text DEFAULT NULL::text, p_comment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(recipient_id uuid, notification_id uuid, agg_count integer, actor_display_name text, recipient_should_push boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_actor   uuid := auth.uid();
  v_author  uuid;
  v_agg_key text;
  v_id      uuid;
  v_count   int;
  v_name    text;
  v_payload jsonb := '{}'::jsonb;
  v_body    text;
  v_seen    boolean;
begin
  if v_actor is null then return; end if;
  if p_type not in ('like','comment','repost') then return; end if;

  select author_id into v_author from posts where id = p_post_id;
  if v_author is null or v_author = v_actor then return; end if;

  -- ── VISIBILITY (20261113000000) ──────────────────────────────────────────
  -- THE VISIBILITY PREDICATE IS LOAD-BEARING. This function is SECURITY DEFINER, so its
  -- reads of posts / post_likes BYPASS RLS: without this, a like left on a post the
  -- caller can no longer see still notified its owner, and agg_count below handed back
  -- that post's live like count. Deliberately the same predicate as
  -- posts_select_authenticated (20261019000000), not a paraphrase of it.
  if not exists (
    select 1 from posts po
     where po.id = p_post_id
       and (
         po.author_id = v_actor
         or (
           not is_blocked_between(v_actor, po.author_id)
           and (
             po.kind <> 'repost'
             or reposts_public(po.author_id)
             or are_friends(v_actor, po.author_id)
           )
         )
       )
  ) then return; end if;

  -- ── AUTHORIZATION: the caller must have actually performed the action ──────
  -- Authentication got us this far and proves nothing about this post.
  if p_type = 'like' then
    if not exists (
      select 1 from post_likes
      where post_id = p_post_id and user_id = v_actor
    ) then return; end if;

  elsif p_type = 'comment' then
    if not exists (
      select 1 from post_comments
      where post_id = p_post_id and author_id = v_actor
    ) then return; end if;

  else -- repost
    if not exists (
      select 1 from posts
      where original_post_id = p_post_id
        and author_id = v_actor
        and kind = 'repost'
    ) then return; end if;
  end if;

  select coalesce(display_name, '@' || username) into v_name
    from profiles where id = v_actor;

  if p_type = 'comment' and p_comment_id is not null then
    -- Snippet is read from the stored comment, never from the parameter. If the id
    -- does not name a comment the actor wrote on this post, v_body is null and the
    -- notification simply carries no snippet.
    select body into v_body
      from post_comments
     where id = p_comment_id
       and post_id = p_post_id
       and author_id = v_actor;

    if v_body is not null then
      v_payload := v_payload || jsonb_build_object(
        'comment_text', substring(v_body from 1 for 280),
        'comment_id',   p_comment_id
      );
    end if;
  end if;

  if p_type = 'like' then
    v_agg_key := 'like:' || p_post_id::text;

    -- The real number of people (other than the author) who like it right now.
    select count(*)::int into v_count
      from post_likes
     where post_id = p_post_id and user_id <> v_author;

    -- Was the owner already pushed about THIS person liking THIS post?
    select coalesce(n.payload -> 'notified' ? v_actor::text, false) into v_seen
      from activity_notifications n
     where n.recipient_id = v_author and n.agg_key = v_agg_key;
    v_seen := coalesce(v_seen, false);

    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, payload, updated_at)
    values
      (v_author, 'like', v_actor, p_post_id, v_agg_key, v_count,
       jsonb_build_object('notified', jsonb_build_array(v_actor::text)), now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = v_count,
          actor_id   = excluded.actor_id,
          payload    = case
                         when v_seen then activity_notifications.payload
                         else jsonb_set(
                                activity_notifications.payload,
                                '{notified}',
                                coalesce(activity_notifications.payload -> 'notified', '[]'::jsonb)
                                  || to_jsonb(v_actor::text))
                       end,
          is_read    = case when v_seen then activity_notifications.is_read else false end,
          updated_at = case when v_seen then activity_notifications.updated_at else now() end
    returning id into v_id;

    return query select v_author, v_id, v_count, v_name, not v_seen;
    return;
  else
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, payload, updated_at)
    values
      (v_author, p_type, v_actor, p_post_id, v_payload, now())
    returning id, 1 into v_id, v_count;
  end if;

  return query select v_author, v_id, v_count, v_name, true;
end;
$function$;


-- ── 2b. activity_notify_comment ─────────────────────────────────────────────
create or replace function public.activity_notify_comment(p_comment_id uuid, p_type text)
returns table(
  recipient_id uuid,
  notification_id uuid,
  agg_count integer,
  actor_display_name text,
  recipient_should_push boolean,
  recipient_is_post_author boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_actor     uuid := auth.uid();
  v_recipient uuid;
  v_post      uuid;
  v_text      text;
  v_parent    uuid;
  v_is_author boolean;
  v_agg_key   text;
  v_id        uuid;
  v_count     int;
  v_name      text;
  v_seen      boolean;
begin
  if v_actor is null then return; end if;
  if p_type not in ('comment_like','comment_reply') then return; end if;

  -- ── AUTHORIZATION: the caller must have actually done it ─────────────────
  if p_type = 'comment_like' then
    select author_id, post_id, body into v_recipient, v_post, v_text
      from post_comments where id = p_comment_id;
    if v_recipient is null then return; end if;
    if not exists (
      select 1 from post_comment_likes where comment_id = p_comment_id and user_id = v_actor
    ) then return; end if;
  else
    -- The reply is the caller's, and its parent is a comment on the SAME post (nothing
    -- else enforces that a parent belongs to its reply's post).
    select r.parent_comment_id, r.post_id, r.body into v_parent, v_post, v_text
      from post_comments r where r.id = p_comment_id and r.author_id = v_actor;
    if v_parent is null then return; end if;
    select author_id into v_recipient
      from post_comments where id = v_parent and post_id = v_post;
    if v_recipient is null then return; end if;
    -- The post author's bar (a block, or "comments from friends only") holds for replies
    -- written before it, too.
    if not can_comment_on_post(v_post) then return; end if;
  end if;

  -- ── VISIBILITY (20261113000000) ──────────────────────────────────────────
  -- THE VISIBILITY PREDICATE IS LOAD-BEARING. SECURITY DEFINER, so the reads above and
  -- below BYPASS RLS: without this, a comment like left on a post the caller can no
  -- longer see still notified, and agg_count handed back the comment's live like count.
  -- For replies can_comment_on_post already asks this (20261111000000); asked here for
  -- both types so neither depends on the other migration. Deliberately the same
  -- predicate as posts_select_authenticated (20261019000000), not a paraphrase of it.
  if not exists (
    select 1 from posts po
     where po.id = v_post
       and (
         po.author_id = v_actor
         or (
           not is_blocked_between(v_actor, po.author_id)
           and (
             po.kind <> 'repost'
             or reposts_public(po.author_id)
             or are_friends(v_actor, po.author_id)
           )
         )
       )
  ) then return; end if;

  if v_recipient = v_actor then return; end if;
  if is_blocked_between(v_actor, v_recipient) then return; end if;

  select (author_id = v_recipient) into v_is_author from posts where id = v_post;
  select coalesce(display_name, '@' || username) into v_name from profiles where id = v_actor;
  v_text := substring(coalesce(v_text, '') from 1 for 280);

  if p_type = 'comment_like' then
    v_agg_key := 'comment_like:' || p_comment_id::text;

    -- The people (other than its author, and anyone they are blocked with) who like the
    -- comment right now.
    select count(*)::int into v_count
      from post_comment_likes l
     where l.comment_id = p_comment_id and l.user_id <> v_recipient
       and not is_blocked_between(l.user_id, v_recipient);

    select coalesce(n.payload -> 'notified' ? v_actor::text, false) into v_seen
      from activity_notifications n
     where n.recipient_id = v_recipient and n.agg_key = v_agg_key;
    v_seen := coalesce(v_seen, false);

    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, payload, updated_at)
    values
      (v_recipient, 'comment_like', v_actor, v_post, v_agg_key, v_count,
       jsonb_build_object(
         'comment_id', p_comment_id,
         'comment_text', v_text,
         'notified', jsonb_build_array(v_actor::text)),
       now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = v_count,
          actor_id   = excluded.actor_id,
          payload    = case
                         when v_seen then activity_notifications.payload
                         else jsonb_set(
                                activity_notifications.payload,
                                '{notified}',
                                coalesce(activity_notifications.payload -> 'notified', '[]'::jsonb)
                                  || to_jsonb(v_actor::text))
                       end,
          is_read    = case when v_seen then activity_notifications.is_read else false end,
          updated_at = case when v_seen then activity_notifications.updated_at else now() end
    returning id into v_id;

    return query select v_recipient, v_id, v_count, v_name, not v_seen, coalesce(v_is_author, false);
    return;
  end if;

  -- Once per reply: a repeat call writes nothing and so pushes nothing.
  insert into activity_notifications
    (recipient_id, type, actor_id, post_id, agg_key, payload, updated_at)
  values
    (v_recipient, 'comment_reply', v_actor, v_post, 'comment_reply:' || p_comment_id::text,
     jsonb_build_object(
       'comment_id', p_comment_id,
       'comment_text', v_text,
       'parent_comment_id', v_parent),
     now())
  on conflict (recipient_id, agg_key) where agg_key is not null do nothing
  returning id into v_id;
  if v_id is null then return; end if;

  return query select v_recipient, v_id, 1, v_name, true, coalesce(v_is_author, false);
end;
$function$;


-- ── 3. activity_record_play ─────────────────────────────────────────────────
create or replace function public.activity_record_play(p_post_id uuid)
returns table (
  views_count         int,
  milestone_recipient uuid,
  milestone_threshold int
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor      uuid := auth.uid();
  v_author     uuid;
  v_kind       text;
  v_count      int;
  v_threshold  int;
  v_thresholds int[] := array[5,25,100,500,1000,5000,10000];
  v_inserted   uuid;
  v_recent     boolean;
begin
  if v_actor is null then return; end if;

  -- ── VISIBILITY (20261113000000) ──────────────────────────────────────────
  -- THE VISIBILITY PREDICATE IS LOAD-BEARING, and it comes FIRST. SECURITY DEFINER, so
  -- the insert below BYPASSES RLS: without this, any post id the caller held got a play
  -- (read back through post_views_select_own) and returned its views_count. A post the
  -- caller cannot see now behaves exactly like one that does not exist: nothing written,
  -- nothing returned. Deliberately the same predicate as posts_select_authenticated
  -- (20261019000000), not a paraphrase of it.
  if not exists (
    select 1 from posts po
     where po.id = p_post_id
       and (
         po.author_id = v_actor
         or (
           not is_blocked_between(v_actor, po.author_id)
           and (
             po.kind <> 'repost'
             or reposts_public(po.author_id)
             or are_friends(v_actor, po.author_id)
           )
         )
       )
  ) then return; end if;

  -- RATE LIMIT (see block comment): 1s per (user, post). Supported by
  -- post_views_user_id_played_at_idx (user_id, played_at desc).
  select exists (
    select 1 from post_views
    where post_id = p_post_id
      and user_id = v_actor
      and played_at > now() - interval '1 second'
  ) into v_recent;

  if not v_recent then
    insert into post_views (post_id, user_id) values (p_post_id, v_actor);
  end if;

  select author_id, kind, posts.views_count
    into v_author, v_kind, v_count
    from posts where id = p_post_id;

  if v_author is null then
    return query select coalesce(v_count, 0), null::uuid, null::int;
    return;
  end if;

  if v_kind = 'upload' and v_author <> v_actor then
    select t into v_threshold from unnest(v_thresholds) t where t = v_count limit 1;
    if v_threshold is not null then
      insert into activity_notifications
        (recipient_id, type, actor_id, post_id, agg_key, payload, updated_at)
      values
        (v_author, 'play_milestone', null, p_post_id,
         'milestone:' || p_post_id::text || ':' || v_threshold::text,
         jsonb_build_object('threshold', v_threshold), now())
      on conflict (recipient_id, agg_key) where agg_key is not null do nothing
      returning id into v_inserted;

      if v_inserted is not null then
        return query select v_count, v_author, v_threshold;
        return;
      end if;
    end if;
  end if;

  return query select v_count, null::uuid, null::int;
end;
$$;

-- Unchanged grants, restated so a replay that starts from a different state still ends in
-- the production shape (signed-in callers only).
revoke all on function public.activity_notify_post(uuid, text, text, uuid) from public;
revoke execute on function public.activity_notify_post(uuid, text, text, uuid) from anon;
grant execute on function public.activity_notify_post(uuid, text, text, uuid) to authenticated;
revoke all on function public.activity_notify_comment(uuid, text) from public;
revoke execute on function public.activity_notify_comment(uuid, text) from anon;
grant execute on function public.activity_notify_comment(uuid, text) to authenticated;
revoke all on function public.activity_record_play(uuid) from public;
revoke execute on function public.activity_record_play(uuid) from anon;
grant execute on function public.activity_record_play(uuid) to authenticated;


-- ── 4. post_comment_likes leaves the Realtime publication ───────────────────
-- Added in 20260607000004 "so the sheet sees" likes; the sheet never subscribed to it
-- (`git log -G"table: *'post_comment_likes"` is empty in every branch). Guarded, like the
-- add, so a database where it is already absent replays cleanly.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'post_comment_likes'
  ) then
    alter publication supabase_realtime drop table public.post_comment_likes;
  end if;
end $$;

alter table public.post_comment_likes replica identity default;


-- ── Self-verification ───────────────────────────────────────────────────────
-- Assert the PROPERTY where it is applied, so drift in the target database fails this
-- migration loudly instead of silently neutering it.
do $$
declare
  v_check text;
  v_fn text;
begin
  -- One permissive INSERT policy on posts: a second would be OR'd in and admit anything.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'posts' and cmd in ('INSERT', 'ALL')
         and permissive = 'PERMISSIVE') <> 1 then
    raise exception 'expected exactly 1 permissive INSERT policy on posts';
  end if;
  -- Exactly the intended expression, after dropping the `public.` prefix and whitespace
  -- that the deparser varies with search_path. Catches a policy that only LOOKS right
  -- (an unqualified original_post_id binding to the inner row, an `or true`).
  select regexp_replace(replace(with_check, 'public.', ''), '\s+', ' ', 'g') into v_check
    from pg_policies
   where schemaname = 'public' and tablename = 'posts' and cmd = 'INSERT'
     and roles::text = '{authenticated}';
  if v_check is distinct from
     '((author_id = auth.uid()) AND ((original_post_id IS NULL) OR (EXISTS ( SELECT 1 FROM posts o WHERE ((o.id = posts.original_post_id) AND (o.kind = ''upload''::text) AND (o.track_id = posts.track_id))))))'
  then
    raise exception 'posts INSERT policy is not the intended one: %', coalesce(v_check, '(missing)');
  end if;

  foreach v_fn in array array[
    'public.activity_notify_post(uuid, text, text, uuid)',
    'public.activity_notify_comment(uuid, text)',
    'public.activity_record_play(uuid)'
  ] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%VISIBILITY (20261113000000)%'
       or pg_get_functiondef(v_fn::regprocedure) not like '%reposts_public(po.author_id)%'
       or pg_get_functiondef(v_fn::regprocedure) not like '%are_friends(v_actor, po.author_id)%'
       or pg_get_functiondef(v_fn::regprocedure) not like '%is_blocked_between(v_actor, po.author_id)%'
       or pg_get_functiondef(v_fn::regprocedure) not like '%SECURITY DEFINER%' then
      raise exception '% lost the visibility predicate', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'anon can execute %', v_fn;
    end if;
  end loop;

  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'post_comment_likes'
  ) then
    raise exception 'post_comment_likes is still in the supabase_realtime publication';
  end if;
end $$;
