-- ============================================================================
-- Mentions: "Sam tagged you in a post" / "Sam mentioned you in a comment"
-- ============================================================================
--
-- An @username in a post's caption or in a comment now tells that person (owner,
-- 2026-10-19: a friend tagged him in a caption and nothing happened). One new activity
-- type, 'mention', and one function, activity_notify_mentions, which the app calls after
-- it has written the post or the comment — the pattern of activity_notify_comment
-- (20261031000000), and send-push's authorize() finds the row this writes before it will
-- send the push.
--
-- ── Who is told ─────────────────────────────────────────────────────────────
-- Read from the STORED text (posts.caption / post_comments.body), never from a parameter:
-- the caller can only announce what they really wrote. The caller must be its author.
-- The tag rule is the app's (src/utils/mentions.ts MENTION_REGEX): `@` at the start or
-- after a character that cannot be part of a username, then 2–30 of [a-z0-9_], not
-- followed by another — so "riya@gmail.com" tags nobody. Then, for each distinct name in
-- order of first appearance, AT MOST FIVE:
--   * a real profile (usernames are lower-case and permanent, so a stored tag always
--     points at the same person);
--   * not the author themself;
--   * not blocked either way;
--   * able to SEE the post — the posts_select_authenticated predicate (20261019000000),
--     verbatim: a friends-only repost does not reach a stranger through a tag, and the
--     caption snippet in the notification would otherwise leak it;
--   * for a comment: not the post's author, nor (for a reply) the parent comment's author
--     — they are told about this comment already ("commented on your post", "replied to
--     your comment"); twice would be noise. And the post author's bar (block,
--     friends-only comments) must still let the commenter comment, as for replies.
-- ONCE per post or comment per person: agg_key 'mention:post:<id>' / 'mention:comment:<id>'
-- under the (recipient_id, agg_key) unique index, so calling again — or editing a caption
-- to repeat a tag — writes nothing and pushes nothing.
--
-- ── The switch ──────────────────────────────────────────────────────────────
-- notification_preferences.mentions (default on): send-push skips the push when it is
-- off. The row is still written — like every other category, the switch governs pushes,
-- not the Activity list.
--
-- ── Old apps ────────────────────────────────────────────────────────────────
-- 2.0.7 and older crash their Activity screen on an unknown type, so activity_list (what
-- every shipped app reads) never returns 'mention'; activity_list_v2 (new apps) does, and
-- 2.1.x skip a type they do not know. A deleted comment takes its mention notifications
-- with it; a deleted post already does (activity_notifications.post_id cascades).
--
-- ADDITIVE for shipped apps: a nullable-with-default column, a widened type check, a new
-- function no build calls yet, a new trigger that only deletes rows of the new type, and
-- activity_list returning exactly what it did (no 'mention' rows exist yet). Re-runnable.
-- ============================================================================

-- ── 1. The switch ───────────────────────────────────────────────────────────
alter table public.notification_preferences
  add column if not exists mentions boolean not null default true;

-- ── 2. The type ─────────────────────────────────────────────────────────────
alter table public.activity_notifications
  drop constraint if exists activity_notifications_type_check;

alter table public.activity_notifications
  add constraint activity_notifications_type_check check (type in (
    'like','comment','repost','play_milestone',
    'new_fan','friend_accepted','friend_rejected',
    'credited','credit_accepted','credit_declined',
    'badge_granted',
    'content_removed',
    'comment_like',
    'comment_reply',
    -- payload: {"where": "post"|"comment", "text": <the caption or comment, ≤280>,
    --           "comment_id": <for a comment>}. agg_key 'mention:post:<id>' or
    --           'mention:comment:<id>'.
    'mention'
  ));

-- ── 3. The usernames tagged in a text ───────────────────────────────────────
-- Distinct, lower-cased, in order of first appearance, at most p_max. IMMUTABLE and
-- unprivileged: a pure string function, so it is exercised directly by the tests.
create or replace function public.mentioned_usernames(p_text text, p_max integer default 5)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(u order by first_at), '{}')
    from (
      select lower(m[2]) as u, min(ord) as first_at
        from regexp_matches(coalesce(p_text, ''),
                            '(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{2,30})(?![A-Za-z0-9_])', 'g')
             with ordinality as r(m, ord)
       group by lower(m[2])
       order by min(ord)
       limit greatest(0, least(coalesce(p_max, 5), 5))
    ) s;
$$;

-- ── 4. Creating them ────────────────────────────────────────────────────────
-- Exactly one of p_post_id (a post's caption) or p_comment_id (a comment). Returns one row
-- per person newly told, for the app to push to.
create or replace function public.activity_notify_mentions(
  p_post_id uuid default null,
  p_comment_id uuid default null
)
returns table(recipient_id uuid, notification_id uuid, actor_display_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  v_actor    uuid := auth.uid();
  v_post     uuid;
  v_text     text;
  v_where    text;
  v_agg_key  text;
  v_skip     uuid[] := '{}';
  v_parent   uuid;
  v_name     text;
  v_user     record;
  v_id       uuid;
begin
  if v_actor is null then return; end if;
  if (p_post_id is null) = (p_comment_id is null) then return; end if;

  -- ── AUTHORIZATION: the caller wrote it, and the text comes from the row ────
  if p_post_id is not null then
    select p.id, p.caption into v_post, v_text
      from posts p where p.id = p_post_id and p.author_id = v_actor;
    if v_post is null then return; end if;
    v_where := 'post';
    v_agg_key := 'mention:post:' || v_post::text;
  else
    select c.post_id, c.body, c.parent_comment_id into v_post, v_text, v_parent
      from post_comments c where c.id = p_comment_id and c.author_id = v_actor;
    if v_post is null then return; end if;
    -- The post author's bar (a block, or friends-only comments) holds here too.
    if not can_comment_on_post(v_post) then return; end if;
    v_where := 'comment';
    v_agg_key := 'mention:comment:' || p_comment_id::text;
    -- Already told about this comment by another notification.
    select array_agg(x) into v_skip from (
      select author_id as x from posts where id = v_post
      union all
      select author_id from post_comments where id = v_parent
    ) s where x is not null;
    v_skip := coalesce(v_skip, '{}');
  end if;

  if v_text is null or position('@' in v_text) = 0 then return; end if;

  select coalesce(display_name, '@' || username) into v_name from profiles where id = v_actor;

  for v_user in
    select pr.id
      from unnest(mentioned_usernames(v_text, 5)) with ordinality as t(u, ord)
      join profiles pr on lower(pr.username) = t.u
      join posts p on p.id = v_post
     where pr.id <> v_actor
       and not (pr.id = any (v_skip))
       and not is_blocked_between(v_actor, pr.id)
       -- posts_select_authenticated (20261019000000), for the RECIPIENT as viewer.
       and (
         p.author_id = pr.id
         or (
           not is_blocked_between(pr.id, p.author_id)
           and (
             p.kind <> 'repost'
             or reposts_public(p.author_id)
             or are_friends(pr.id, p.author_id)
           )
         )
       )
     order by t.ord
  loop
    insert into activity_notifications
      (recipient_id, type, actor_id, post_id, agg_key, payload, updated_at)
    values
      (v_user.id, 'mention', v_actor, v_post, v_agg_key,
       jsonb_strip_nulls(jsonb_build_object(
         'where', v_where,
         'text', substring(v_text from 1 for 280),
         'comment_id', p_comment_id)),
       now())
    on conflict (recipient_id, agg_key) where agg_key is not null do nothing
    returning id into v_id;
    if v_id is not null then
      recipient_id := v_user.id;
      notification_id := v_id;
      actor_display_name := v_name;
      return next;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.activity_notify_mentions(uuid, uuid) from public, anon;
grant execute on function public.activity_notify_mentions(uuid, uuid) to authenticated;

comment on function public.activity_notify_mentions(uuid, uuid) is
  'Tell the people @-tagged in the caller''s own post caption or comment (read from the '
  'stored row): at most 5, once each, never across a block, never someone who cannot see '
  'the post. Returns who was newly told, for the app to push to.';

-- ── 5. A deleted comment takes its mentions with it ─────────────────────────
-- "Sam mentioned you in a comment: …" must not outlive the comment. (A deleted post's
-- rows already go: activity_notifications.post_id is ON DELETE CASCADE.)
create or replace function public.activity_mention_comment_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from activity_notifications
   where type = 'mention'
     and agg_key = 'mention:comment:' || old.id::text;
  return old;
end;
$$;

revoke execute on function public.activity_mention_comment_deleted() from public, anon, authenticated;

drop trigger if exists trg_post_comments_mentions_deleted on public.post_comments;
create trigger trg_post_comments_mentions_deleted
  after delete on public.post_comments
  for each row execute function public.activity_mention_comment_deleted();

-- ── 6. Shipped apps never see the new type ──────────────────────────────────
-- activity_list as in 20261031000000, plus `n.type <> 'mention'`.
create or replace function public.activity_list(
  p_limit int default 50,
  p_before timestamptz default null
) returns table (
  id                 uuid,
  type               text,
  actor_id           uuid,
  post_id            uuid,
  agg_count          int,
  is_read            boolean,
  created_at         timestamptz,
  updated_at         timestamptz,
  payload            jsonb,
  actor_username     text,
  actor_display_name text,
  actor_avatar_url   text,
  post_title         text,
  post_cover_art_url text
) language sql security definer set search_path = public, pg_temp as $$
  select
    n.id,
    case when n.type = 'comment_reply' then 'comment' else n.type end,
    n.actor_id, n.post_id, n.agg_count, n.is_read,
    n.created_at, n.updated_at, n.payload,
    a.username, a.display_name, a.avatar_url,
    t.title, t.cover_art_url
  from activity_notifications n
  left join profiles a on a.id = n.actor_id
  left join posts p on p.id = n.post_id
  left join tracks t on t.id = p.track_id
  where n.recipient_id = auth.uid()
    and (p_before is null or n.updated_at < p_before)
    and not (n.type = 'like' and n.agg_count <= 0)
    and n.type <> 'comment_like'
    and n.type <> 'mention'
    and (n.type <> 'comment_reply' or p.author_id = n.recipient_id)
  order by n.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;
