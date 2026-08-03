-- Enforce profiles.comments_friends_only, which has been recording intent since
-- 20260803000000 while restricting nothing.
--
-- THE DEFECT THIS CLOSES. post_comments_insert_self checked only
-- `author_id = auth.uid()` — that you are who you say you are, not that the post's
-- author will have you. So the "Comments from friends only" switch in Settings has
-- shipped (1.1.14, 1.1.15) as a control that looks like protection and is not one.
-- A user could enable it and a stranger could still comment.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
-- A comment may be inserted when the author is the caller AND at least one of:
--   * the caller IS the post's author  — you can always comment on your own post,
--     including when you have restricted everyone else;
--   * the post's author has comments_friends_only = false (the default) — open to
--     everyone, which is Livil's stated model for likes and comments;
--   * an accepted friendship exists between the caller and the post's author.
--
-- Note the preference is read from the POST'S author, not the track's uploader. A
-- repost is its own posts row with its own author_id, so a reposter's setting governs
-- comments on their repost and the original author's governs theirs. That is the
-- intended reading: you control the audience of the thing you posted.
--
-- ── WHY A SECURITY DEFINER HELPER AND NOT AN INLINE SUBQUERY ────────────────
-- A policy expression referencing another table has THAT table's RLS applied. The
-- caller can currently see the friendship row (friendships_select_participants admits
-- participants, and the caller is one), so an inline subquery would work today. But if
-- friendships' read policy is ever tightened, the subquery would silently return no
-- rows and the policy would start REFUSING comments between real friends — a
-- fail-closed break with no error to trace. A DEFINER helper does not depend on the
-- caller's view of friendships, and can be tested on its own.
--
-- auth.uid() inside a DEFINER body still resolves to the CALLER (it reads the request's
-- JWT claim, not the function owner), which is what makes it safe to take no caller
-- parameter — there is nothing for a caller to lie about.
--
-- search_path is pinned WITH pg_temp listed, per LIV-16: unlisted, Postgres searches the
-- session temp schema first and an attacker-created pg_temp.posts would shadow the real
-- table inside this DEFINER body. The definer-search-path lint in CI asserts this.
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
  'Whether auth.uid() may comment on this post: own post, or the post author allows everyone (comments_friends_only = false), or an accepted friendship exists. Used by post_comments_insert_self.';

-- ── The policy ──────────────────────────────────────────────────────────────
-- REPLACED IN PLACE, under the same name, and this matters. Multiple PERMISSIVE
-- policies for the same command are OR'd together, so adding a second, stricter
-- INSERT policy alongside the existing one would enforce nothing at all — every
-- insert that satisfied the old `author_id = auth.uid()` would still pass. The
-- assertion below proves exactly one INSERT policy survives.
drop policy if exists "post_comments_insert_self" on public.post_comments;
create policy "post_comments_insert_self" on public.post_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_comment_on_post(post_id)
  );

-- ── Self-verification ───────────────────────────────────────────────────────
-- Asserts the PROPERTY, not that the statements ran. A stray second permissive
-- INSERT policy — from a hand-applied fix, or a future migration that adds rather
-- than replaces — silently reopens the hole, and nothing else would catch it.
do $$
declare
  v_count int;
  v_check text;
begin
  select count(*) into v_count
  from pg_policy
  where polrelid = 'public.post_comments'::regclass and polcmd = 'a';

  if v_count <> 1 then
    raise exception
      'post_comments has % permissive INSERT policies; expected exactly 1. Permissive policies are OR-ed, so more than one reopens the bypass.', v_count;
  end if;

  select pg_get_expr(polwithcheck, polrelid) into v_check
  from pg_policy
  where polrelid = 'public.post_comments'::regclass and polcmd = 'a';

  if v_check not like '%can_comment_on_post%' then
    raise exception
      'post_comments_insert_self does not consult can_comment_on_post; WITH CHECK is: %', v_check;
  end if;
end $$;
