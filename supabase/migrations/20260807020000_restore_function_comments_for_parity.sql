-- ============================================================================
-- Restore the function COMMENTS production lost, so schema-parity means something again
-- ============================================================================
--
-- `schema-parity` has been red on main for weeks. Nothing was ever wrong with production:
-- all 14 functions below are behaviourally IDENTICAL on both sides. Strip `--` comments and
-- normalize whitespace and every one of the 14 hashes the same. Production has been
-- enforcing exactly what this repository declares the entire time.
--
-- What differs is commentary. The fingerprint hashes `prosrc`, which stores a body verbatim
-- INCLUDING its comments, so an edit to a comment inside an already-applied migration puts
-- the repo permanently out of parity with production. That is what happened: these
-- migrations were improved after they were applied. `enforce_username_reservation` proves
-- the direction is not even consistent — production carries MORE comment there than the repo
-- does, so at least one edit went the other way.
--
-- ── Why this is a true positive, not a broken check ──────────────────────────
--
-- The tempting fix is to strip comments in `schema-fingerprint.sql` and compare only code.
-- Rejected, for two reasons:
--
--   · It puts a regex SQL-comment parser inside a security check. `--` can appear inside a
--     string literal, where stripping deletes real code — and then two genuinely different
--     bodies hash the same. A check that can produce a false MATCH is worse than one that
--     produces a false alarm, because nothing downstream ever questions a pass.
--   · The check is right. An applied migration is a log entry, not a document. If the file
--     no longer reproduces what was installed, the replay is lying about history, and that
--     is worth knowing whether the divergence is a comment or a predicate.
--
-- So production is brought to the repo instead, which is the direction that keeps the
-- fingerprint strict: after this, ANY body difference — comment or code — still fails.
--
-- ── How these definitions were produced ──────────────────────────────────────
--
-- MECHANICALLY, via `pg_get_functiondef()` against a database with every migration in this
-- repository replayed in order — never retyped. `20260806200708_credit_functions_verbatim_
-- for_parity` exists because hand-copying a function body has already gone wrong here once,
-- and doing it fourteen times by hand to fix a cosmetic difference would be a good way to
-- introduce a real one.
--
-- Verified before generating: `search_path`, `prosecdef`, volatility and return type are
-- already identical on both sides for all 14, so CREATE OR REPLACE carries no hidden change.
-- It also preserves each function's OID and its grants, so nothing downstream is disturbed.
--
-- The bodies below are therefore the repo's own current text, and re-applying them is a
-- no-op for behaviour by construction.

CREATE OR REPLACE FUNCTION public.accept_friend_request(other_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi
   for update;

  if not found then raise exception 'no_pending_request'; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by = me then raise exception 'cannot_accept_own_request'; end if;

  update friendships
     set status = 'accepted', accepted_at = now()
   where user_a_id = v_lo and user_b_id = v_hi;

  delete from follows
   where kind = 'star'
     and ((follower_id = me and following_id = other_user_id)
       or (follower_id = other_user_id and following_id = me));

  -- Emission, in the transaction that proved the request existed and was pending and
  -- was not the caller's own. The recipient is the requester, derived here rather
  -- than taken from a parameter (ADR-0008 decision #1).
  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (other_user_id, 'friend_accepted', me, now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.activity_notify_friend_outcome(p_other_user uuid, p_accepted boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- DELIBERATELY EMPTY. friend_accepted / friend_rejected rows are emitted by
  -- accept_friend_request / reject_friend_request, which are the only contexts that
  -- can prove the outcome happened. This function cannot prove it and therefore must
  -- not write. Do not "restore" the insert.
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.activity_notify_new_fan(p_target uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null or p_target = v_me then return null; end if;

  -- AUTHORIZATION: you may only announce a star you actually placed.
  if not exists (
    select 1 from follows
    where follower_id = v_me and following_id = p_target and kind = 'star'
  ) then
    return null;
  end if;

  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (p_target, 'new_fan', v_me, now())
  returning id into v_id;
  return v_id;
end;
$function$
;

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
begin
  if v_actor is null then return; end if;
  if p_type not in ('like','comment','repost') then return; end if;

  select author_id into v_author from posts where id = p_post_id;
  if v_author is null or v_author = v_actor then return; end if;

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
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, agg_count, updated_at)
    values
      (v_author, 'like', v_actor, p_post_id, v_agg_key, 1, now())
    on conflict (recipient_id, agg_key) where agg_key is not null do update
      set agg_count  = activity_notifications.agg_count + 1,
          actor_id   = excluded.actor_id,
          is_read    = false,
          updated_at = now()
    returning id, agg_count into v_id, v_count;
  else
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, payload, updated_at)
    values
      (v_author, p_type, v_actor, p_post_id, v_payload, now())
    returning id, 1 into v_id, v_count;
  end if;

  return query select v_author, v_id, v_count, v_name, true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.activity_record_play(p_post_id uuid)
 RETURNS TABLE(views_count integer, milestone_recipient uuid, milestone_threshold integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.conversation_members_freeze_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- last_read_at is the only column the client updates (markAsRead). Membership
  -- identity and role are granted by an admin or by a SECURITY DEFINER RPC; they are
  -- never self-service. Raising insufficient_privilege rather than silently ignoring
  -- the change: a rejected privilege escalation should be visible.
  --
  -- IF YOU ARE HERE BECAUSE A PROMOTE-TO-ADMIN FEATURE HIT THIS EXCEPTION: this fires
  -- for EVERY caller, including a future SECURITY DEFINER RPC, because triggers run
  -- regardless of who is executing. Nothing does that today. When something does, give
  -- it a named exemption (a session GUC set by that RPC, or an explicit condition
  -- here) rather than deleting the trigger — deleting it reopens self-promotion for
  -- every member of every conversation.
  if new.role is distinct from old.role
     or new.user_id is distinct from old.user_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'conversation_member_identity_is_immutable'
      using errcode = '42501';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_member_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id   uuid;
  v_me   uuid := auth.uid();
  v_uid  uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  -- AUTHORIZATION: a member list containing nobody but the caller means the loop
  -- below checks nothing, and the caller would still be written in as admin.
  if (select count(*) from unnest(coalesce(p_member_ids, '{}'::uuid[])) u
       where u <> v_me) < 1 then
    raise exception 'group_requires_members';
  end if;

  -- AUTHORIZATION: validate every member BEFORE creating anything, so a rejected
  -- member cannot leave a half-built group behind.
  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      perform assert_friendship(v_me, v_uid);
    end if;
  end loop;

  insert into conversations (kind, name, created_by)
  values ('group', p_name, v_me)
  returning id into v_id;

  insert into conversation_members (conversation_id, user_id, role)
  values (v_id, v_me, 'admin');

  foreach v_uid in array p_member_ids loop
    if v_uid <> v_me then
      insert into conversation_members (conversation_id, user_id, role)
      values (v_id, v_uid, 'member')
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end loop;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_username_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name text := lower(btrim(new.username));
  v_hash text;
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if v_name !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Username must be 3-30 characters: letters, numbers, underscore'
      using errcode = '22023';
  end if;

  select public.account_email_hash(u.email) into v_hash
    from auth.users u
   where u.id = new.id;

  if exists (
    select 1 from public.deleted_accounts d
     where d.username = v_name
       and (v_hash is null or d.email_sha256 is null or d.email_sha256 <> v_hash)
  ) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;

  -- NEW. Everything above validated v_name; this is what makes the stored value match what
  -- was validated.
  new.username := v_name;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.ops_team_messages()
 RETURNS TABLE(id uuid, body text, created_at timestamp with time zone, sender_name text, sender_username text, sender_email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_ops() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, m.body, m.created_at, p.display_name, p.username, u.email::text
      FROM public.team_messages m
      JOIN public.profiles p ON p.id = m.sender_id
      -- LEFT JOIN: `profiles` cascades from `auth.users`, so an orphan should be impossible.
      -- Joining inner anyway would mean a single inconsistent row silently removing a message
      -- from the inbox, which is the wrong failure for a support queue.
      LEFT JOIN auth.users u ON u.id = m.sender_id
     ORDER BY m.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ops_users_overview()
 RETURNS TABLE(id uuid, display_name text, username text, email text, created_at timestamp with time zone, last_seen_at timestamp with time zone, tracks_count bigint, posts_count bigint, stars_count bigint, friends_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_ops() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      p.display_name,
      p.username,
      u.email::text,
      p.created_at,
      p.last_seen_at,
      -- Songs uploaded: tracks, not posts. A repost creates a post but no track, so counting
      -- posts would credit an artist for someone else's work.
      (SELECT count(*) FROM public.tracks t  WHERE t.uploader_id = p.id),
      (SELECT count(*) FROM public.posts  po WHERE po.author_id  = p.id),
      -- Stars received. `follows_kind_check` permits only kind='star', so a star IS a follow.
      (SELECT count(*) FROM public.follows f WHERE f.following_id = p.id),
      -- Friendship is symmetric and stored once, so both sides must be checked. Pending
      -- requests are excluded: a request nobody accepted is not a friend.
      (SELECT count(*) FROM public.friendships fr
        WHERE fr.status = 'accepted' AND (fr.user_a_id = p.id OR fr.user_b_id = p.id))
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY p.created_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.posts_freeze_counter_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- kind is never editable. An upload does not become a repost, or the reverse.
  if new.kind is distinct from old.kind then
    raise exception 'posts.kind is immutable'
      using errcode = '42501';
  end if;

  if new.original_post_id is distinct from old.original_post_id then
    -- Allowed only when this is the FK's ON DELETE SET NULL firing: the column is being
    -- cleared, and the post it pointed at no longer exists.
    if not (new.original_post_id is null
            and old.original_post_id is not null
            and not exists (select 1 from public.posts where id = old.original_post_id)) then
      raise exception 'posts.original_post_id is immutable'
        using errcode = '42501';
    end if;
  end if;

  -- NEW — which track a post serves is its identity. Repointing it makes the post a wrapper
  -- around someone else's work while keeping this author's name, caption and play counter.
  -- Unconditional, like `kind`: there is no legitimate writer. `track_id` is NOT NULL with
  -- ON DELETE CASCADE, so unlike original_post_id there is no SET NULL path to carve out.
  if new.track_id is distinct from old.track_id then
    raise exception 'posts.track_id is immutable'
      using errcode = '42501';
  end if;

  -- Counters are maintained by the five counter triggers and by nothing else.
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    if new.views_count    is distinct from old.views_count
    or new.likes_count    is distinct from old.likes_count
    or new.reposts_count  is distinct from old.reposts_count
    or new.comments_count is distinct from old.comments_count then
      raise exception 'posts counters are derived and cannot be set directly'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.profile_links_ok(p_links text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- bool_and over an empty set is NULL, which a CHECK treats as passing; coalesce anyway so
  -- the intent is explicit rather than incidental.
  select coalesce(
    -- Length is checked separately from the pattern because Postgres caps regex
    -- repetition counts at 255 — `{1,480}` is rejected as an invalid repetition count.
    bool_and(l ~ '^https?://[^[:space:]]+$' and char_length(l) <= 500),
    true
  )
  from unnest(coalesce(p_links, '{}'::text[])) as l;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_friend_request(other_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me uuid := auth.uid();
  v_lo uuid;
  v_hi uuid;
  v_existing record;
begin
  if me is null then raise exception 'not_authenticated'; end if;

  select lo, hi into v_lo, v_hi from _friendship_pair(me, other_user_id);

  select * into v_existing from friendships
   where user_a_id = v_lo and user_b_id = v_hi;

  if not found then return; end if;
  if v_existing.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_existing.requested_by = me then raise exception 'cannot_reject_own_request'; end if;

  delete from friendships where user_a_id = v_lo and user_b_id = v_hi;

  -- Emitted immediately after the delete, in the same transaction that proved the
  -- request was pending and was not the caller's own. Same reasoning as accept: this
  -- is the last point at which the proof existed.
  insert into activity_notifications (recipient_id, type, actor_id, updated_at)
  values (other_user_id, 'friend_rejected', me, now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.waitlist_request(p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email text := lower(btrim(p_email));
  v_id    uuid;
BEGIN
  -- Cheap sanity only. The edge function does the real validation; this exists so the
  -- function cannot be used to write junk directly through PostgREST.
  IF v_email IS NULL
     OR length(v_email) < 3
     OR length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+(\.[^@[:space:].]+)+$'
  THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.waitlist (email)
  VALUES (v_email)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL when the address was already present
END;
$function$
;
