-- ============================================================================
-- Likes and comments follow the post's visibility (ADR-0028 follow-up)
-- ============================================================================
--
-- THE GAP. posts_select_authenticated (20261019000000) hides a friends-only repost from
-- everyone but the reposter's accepted friends, and a blocked pair's posts from each
-- other. The tables hanging off a post never asked that question:
--
--   post_comments_select_authenticated   using (true)
--   post_likes_select_authenticated      using (true)
--   post_likes_insert_self               with check (user_id = auth.uid())
--   post_comment_likes_select            using (true)
--   post_comment_likes_insert_self       with check (user_id = auth.uid())
--   can_comment_on_post(post)            DEFINER: blocks + comments-friends-only, nothing
--                                        about whether the caller can see the post
--
-- So anyone holding a hidden post's id could, through the REST API, read its comments,
-- list who liked it, like it (which also notifies the reposter: activity_notify_post only
-- checks that the like row exists), and comment on it unless the reposter had comments
-- set to friends only. ADR-0028 recorded this as a known follow-up; sharing reposts in
-- chat (kb/architecture/post-sharing.md) now hands such ids to non-friends of the
-- reposter, so it is closed here.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- A row of a child table is visible / writable only if its post is visible to the
-- caller:
--
--   exists (select 1 from public.posts p where p.id = <child>.post_id)
--
-- That subquery runs as the CALLER, so posts_select_authenticated applies to it: the
-- child policies inherit the posts rule instead of restating it, and cannot drift from
-- it. post_comment_likes asks the same of its comment (whose read policy asks it of the
-- post), one hop further.
--
-- can_comment_on_post is SECURITY DEFINER, so its join to posts BYPASSES RLS and the
-- subquery trick does not work there. Same treatment as record_post_impressions
-- (20261019000000): the visibility predicate is repeated BY HAND, identical to
-- posts_select_authenticated, beside the checks it already had (block, friends-only
-- comments) — which are unchanged. Its other callers (activity_notify_comment for
-- replies, activity_notify_mentions for comments) inherit the new clause, correctly: a
-- reply on a post its writer can no longer see notifies nobody.
--
-- ── DELIBERATELY UNCHANGED ──────────────────────────────────────────────────
--  * DELETE policies. But a filtered delete (every PostgREST delete) must also pass the
--    read policy, so a like or comment left on a post you can NO LONGER see cannot be
--    removed by you. Deliberate: it stays visible only to people who can see the post,
--    and no screen reaches it — the post itself no longer loads for you.
--  * post_comments_insert_self. It already calls can_comment_on_post, which now carries
--    the visibility clause.
--  * Counts. likes_count / comments_count / like_count are kept by DEFINER triggers and
--    count every row, so the numbers on a post do not change.
--  * DEFINER readers — activity_notify_post / _comment / _mentions, music_score_points,
--    my_chat_vibes — and the send-push edge function (service role) bypass RLS, as before.
--  * post_reports / post_comment_reports. Insert-only, no read policy: a report tells the
--    reporter nothing, and a safety report must not fail because the reporter blocked
--    the author first.
--
-- ── COST ────────────────────────────────────────────────────────────────────
-- One primary-key probe of posts per row. Once a single post's likes approach ~1/16 of
-- all posts the planner may prefer a hashed subplan over the whole posts table (measured
-- locally: a 5,000-like likers page went 0.9 → 155 ms at 40k posts). Far off at today's
-- scale; `explain analyze` the likers query as `authenticated` if a post ever gets there.
--
-- ── OLD APPS ────────────────────────────────────────────────────────────────
-- The app (2.1.3 and main) reads and writes these rows only for posts it has already
-- loaded through posts_select_authenticated: the comment sheet, the like button, the
-- likers list, the "liked by me" lookup for posts on screen, the liked-songs list (embeds
-- the post) and its count. The only visible difference: 2.1.3's liked-songs COUNT (a bare
-- count of post_likes) stops including likes on posts the viewer can no longer see — the
-- list below it already left those out. No column, function signature or return shape
-- changes.
-- ============================================================================

-- ── post_likes ──────────────────────────────────────────────────────────────
-- Replaced, never added alongside: permissive policies are OR'd, so a second SELECT or
-- INSERT policy would put the old `true` back.
drop policy if exists "post_likes_select_authenticated" on public.post_likes;
create policy "post_likes_select_authenticated" on public.post_likes
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_likes.post_id));

drop policy if exists "post_likes_insert_self" on public.post_likes;
create policy "post_likes_insert_self" on public.post_likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_likes.post_id)
  );

-- ── post_comments ───────────────────────────────────────────────────────────
drop policy if exists "post_comments_select_authenticated" on public.post_comments;
create policy "post_comments_select_authenticated" on public.post_comments
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_comments.post_id));

-- ── post_comment_likes: through the comment, so through the post ────────────
drop policy if exists "post_comment_likes_select" on public.post_comment_likes;
create policy "post_comment_likes_select" on public.post_comment_likes
  for select to authenticated
  using (exists (select 1 from public.post_comments c where c.id = post_comment_likes.comment_id));

drop policy if exists "post_comment_likes_insert_self" on public.post_comment_likes;
create policy "post_comment_likes_insert_self" on public.post_comment_likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.post_comments c where c.id = post_comment_likes.comment_id)
  );

-- ── can_comment_on_post: the visibility predicate, by hand ──────────────────
-- Body identical to 20260808100000 plus the marked clause, which must stay the same
-- predicate as posts_select_authenticated (20261019000000) — not a paraphrase of it, so
-- the two cannot drift into disagreeing about who can see what.
create or replace function public.can_comment_on_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.posts po
    join public.profiles pr on pr.id = po.author_id
    where po.id = p_post_id
      -- THE VISIBILITY PREDICATE IS LOAD-BEARING. This function is SECURITY DEFINER, so
      -- the read of posts above BYPASSES posts_select_authenticated: without this, a
      -- caller could comment on any post whose id they hold, friends-only reposts
      -- included.
      and (
        po.author_id = auth.uid()
        or (
          not public.is_blocked_between(auth.uid(), po.author_id)
          and (
            po.kind <> 'repost'
            or public.reposts_public(po.author_id)
            or public.are_friends(auth.uid(), po.author_id)
          )
        )
      )
      and not public.is_blocked_between(auth.uid(), po.author_id)
      and (
        po.author_id = auth.uid()
        or coalesce(pr.comments_friends_only, false) = false
        or exists (
          select 1
          from public.friendships f
          where f.status = 'accepted'
            and (
              (f.user_a_id = auth.uid() and f.user_b_id = po.author_id)
              or (f.user_b_id = auth.uid() and f.user_a_id = po.author_id)
            )
        )
      )
  );
$$;

comment on function public.can_comment_on_post(uuid) is
  'Whether auth.uid() may comment on this post: the post is visible to them (the posts_select_authenticated predicate, repeated by hand because this is DEFINER), not blocked either way, AND (own post, or the post author allows everyone (comments_friends_only = false), or an accepted friendship exists). Used by post_comments_insert_self, activity_notify_comment and activity_notify_mentions.';

-- Unchanged grants, restated so a replay that starts from a different state still ends
-- in the production shape (20260803190000 revoked anon).
revoke all on function public.can_comment_on_post(uuid) from public;
revoke execute on function public.can_comment_on_post(uuid) from anon;
grant execute on function public.can_comment_on_post(uuid) to authenticated;

-- ── Self-verification ───────────────────────────────────────────────────────
-- Assert the PROPERTY where it is applied, so drift in the target database fails this
-- migration loudly instead of silently neutering it. Two ways it could be undone:
--   * a leftover second permissive policy for the same command is OR'd in (count = 1);
--   * a policy that only LOOKS right ("true or exists (…)", an uncorrelated subquery) —
--     so each expression must equal the intended one exactly, after dropping the
--     `public.` prefix and whitespace that the deparser varies with search_path.
-- post_comments INSERT is included although this migration does not touch it: it is the
-- one comment write path, and only can_comment_on_post stands behind it.
do $$
declare
  r record;
  v_actual text;
  v_def text;
begin
  for r in
    select * from (values
      ('post_likes', 'SELECT',
       '(EXISTS ( SELECT 1 FROM posts p WHERE (p.id = post_likes.post_id)))'),
      ('post_likes', 'INSERT',
       '((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM posts p WHERE (p.id = post_likes.post_id))))'),
      ('post_comments', 'SELECT',
       '(EXISTS ( SELECT 1 FROM posts p WHERE (p.id = post_comments.post_id)))'),
      ('post_comments', 'INSERT',
       '((author_id = auth.uid()) AND can_comment_on_post(post_id))'),
      ('post_comment_likes', 'SELECT',
       '(EXISTS ( SELECT 1 FROM post_comments c WHERE (c.id = post_comment_likes.comment_id)))'),
      ('post_comment_likes', 'INSERT',
       '((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM post_comments c WHERE (c.id = post_comment_likes.comment_id))))')
    ) as t(tbl, cmd, expected)
  loop
    if (select count(*) from pg_policies
         where schemaname = 'public' and tablename = r.tbl and cmd in (r.cmd, 'ALL')
           and permissive = 'PERMISSIVE') <> 1 then
      raise exception 'expected exactly 1 permissive % policy on %: a second one would OR the visibility check away',
        r.cmd, r.tbl;
    end if;
    select regexp_replace(replace(coalesce(qual, with_check), 'public.', ''), '\s+', ' ', 'g')
      into v_actual
      from pg_policies
     where schemaname = 'public' and tablename = r.tbl and cmd = r.cmd
       and roles::text = '{authenticated}';
    if v_actual is distinct from r.expected then
      raise exception '% policy on % is not the intended one: %', r.cmd, r.tbl, coalesce(v_actual, '(missing)');
    end if;
  end loop;

  v_def := pg_get_functiondef('public.can_comment_on_post(uuid)'::regprocedure);
  if v_def not like '%reposts_public%' or v_def not like '%are_friends%'
     or v_def not like '%SECURITY DEFINER%' then
    raise exception 'can_comment_on_post lost the visibility predicate';
  end if;
  if has_function_privilege('anon', 'public.can_comment_on_post(uuid)', 'execute') then
    raise exception 'anon can execute public.can_comment_on_post(uuid)';
  end if;
end $$;
