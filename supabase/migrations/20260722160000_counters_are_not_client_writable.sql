-- ============================================================================
-- Counters are derived state, not user input
-- ============================================================================
--
-- THE DEFECT — verified by execution, not inferred.
--
--   update posts set views_count = 2000000000, reposts_count = 999999 where id = <mine>
--   update profiles set followers_count = 500000 where id = <me>
--
-- Both succeed today as `authenticated`. Measured on a replay:
--   before: views=0 reposts=0 followers=0
--   after : views=2000000000 reposts=999999 followers=500000
--
-- posts_update_own is `using (author_id = auth.uid()) with check (author_id = auth.uid())`.
-- It constrains WHICH ROWS you may write. Nothing constrains WHICH COLUMNS — there are no
-- column-level grants in this schema, and 20260722000000:186-190 records why adding them
-- would not survive: the CI harness re-runs `grant all on all tables to authenticated`
-- after migrations, so a column grant is silently undone and the test passes for the
-- wrong reason. A trigger is the mechanism that holds.
--
-- fetch_home_feed is SECURITY INVOKER and reads the score straight off the row —
-- `likes_count*2.0 + reposts_count*3.0 + comments_count + views_count/10.0`
-- (20260707000000_home_feed_single_call.sql:89-92). So one PATCH pins your own post to
-- the top of every feed in the product. No UUID guessing, no race, one request.
--
-- WHY 20260722140000 DID NOT CLOSE THIS. That migration froze the columns that decide
-- WHICH ROW a counter trigger increments, which stops you moving a count between posts —
-- the cross-user half. It said nothing about writing the count directly, because the
-- attack it was built from moved counts rather than setting them. Same target, shorter
-- path. Naming that plainly because "we fixed the counter bug" is exactly the kind of
-- claim that let D-02 and D-55 sit half-closed.
--
-- ── THE MECHANISM, and why the obvious two do not work ──────────────────────
--
-- The hard part is separating a client PATCH from the counter triggers' own writes,
-- which must keep working.
--
--   `current_user` — DOES NOT WORK. posts_freeze_counter_identity is SECURITY DEFINER
--   (made so in 20260722140000 because its carve-out is fail-open), so current_user
--   inside it is the function owner for EVERY caller. It cannot see who asked.
--
--   Column-level REVOKE — DOES NOT WORK here. See the CI harness note above.
--
--   `pg_trigger_depth()` — WORKS, and is verified rather than assumed:
--     direct client UPDATE          -> the freeze trigger observes depth = 1
--     counter trigger's own UPDATE  -> the freeze trigger observes depth = 2
--   A statement issued from outside any trigger is at depth 1 when its own BEFORE
--   trigger runs; one issued from inside a trigger is at 2. The five counter triggers
--   are the only things that legitimately write these columns, and all of them are
--   nested by construction.
--
-- The depth test is paired with `auth.uid() is not null` so that migrations and
-- operator repair work — which run with no JWT and at depth 1 — are not locked out of
-- their own tables. That branch cannot be abused: `anon` has no UPDATE policy on any of
-- these tables, and posts_update_own/profiles_update_own/post_comments_update_self all
-- require `= auth.uid()`, so with a null uid no row is visible to update in the first
-- place. The bypass is only reachable by someone who already holds a privileged
-- connection.
-- ============================================================================


-- ============================================================================
-- 1. posts — views/likes/reposts/comments
-- ============================================================================
-- Extends the existing freeze rather than adding a second BEFORE UPDATE trigger on the
-- same table: two triggers on one event fire in name order, which is a needless ordering
-- dependency for checks that belong together. Body up to the counter block is VERBATIM
-- from 20260722140000.

create or replace function public.posts_freeze_counter_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

-- INSERT is a separate door. posts_insert_own's WITH CHECK constrains author_id and
-- cannot constrain a column value it does not name, so `insert ... reposts_count=999999`
-- would sail through the UPDATE guard above by never being an update.
--
-- Clamped to zero rather than raised: the client's insert (src/services/posts.ts:478-487)
-- does not send these columns at all, so a raise would only ever fire on an attack — but
-- clamping is the behaviour that stays correct if a future client sends a full row it
-- read back from the API.
create or replace function public.posts_clamp_counters_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    new.views_count    := 0;
    new.likes_count    := 0;
    new.reposts_count  := 0;
    new.comments_count := 0;
  end if;
  return new;
end $$;

drop trigger if exists trg_posts_clamp_counters_on_insert on public.posts;
create trigger trg_posts_clamp_counters_on_insert
  before insert on public.posts
  for each row
  execute function public.posts_clamp_counters_on_insert();


-- ============================================================================
-- 2. profiles — followers_count / following_count
-- ============================================================================
-- A separate trigger from trg_enforce_username_immutable (20260628000000), deliberately:
-- that one guards identity and is referenced by its own tests, and folding an unrelated
-- check into a security function is how the next reader stops being able to tell what
-- either is for. Two BEFORE UPDATE triggers on profiles now fire in name order; neither
-- depends on the other's outcome.

create or replace function public.profiles_freeze_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    if new.followers_count is distinct from old.followers_count
    or new.following_count is distinct from old.following_count then
      raise exception 'profiles counters are derived and cannot be set directly'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_freeze_counters on public.profiles;
create trigger trg_profiles_freeze_counters
  before update on public.profiles
  for each row
  execute function public.profiles_freeze_counters();

-- No INSERT clamp on profiles: rows are created only by handle_new_user(), a SECURITY
-- DEFINER trigger on auth.users, and profiles_insert_self exists for the OAuth path.
-- Both start from the column defaults of 0. Left alone rather than guarded speculatively.


-- ============================================================================
-- 3. post_comments — like_count
-- ============================================================================
-- Extends the existing post_id freeze, same reasoning as posts.
--
-- PROMOTED TO SECURITY DEFINER, and the reason is worth recording because the first
-- version of this file got it wrong. 20260722140000 left this function SECURITY INVOKER
-- on the argument that, unlike the posts trigger, it has no fail-open lookup and only
-- compares OLD to NEW. True — but the counter check below calls auth.uid(), and as
-- INVOKER that runs as `authenticated`, which has no USAGE on schema `auth` in a bare
-- Postgres. The test suite caught it immediately:
--
--   ERROR:  permission denied for schema auth
--   CONTEXT: PL/pgSQL function post_comments_freeze_post_id() line 8 at IF
--
-- It fails CLOSED, so it was never a security hole — it simply made every comment edit
-- impossible. Note it would have worked in production, where Supabase grants
-- `authenticated` usage on `auth`, and broken only in CI. A guard whose behaviour
-- depends on which environment it runs in is worth eliminating even when the divergence
-- happens to favour production.

create or replace function public.post_comments_freeze_post_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.post_id is distinct from old.post_id then
    raise exception 'post_comments.post_id is immutable'
      using errcode = '42501';
  end if;

  if auth.uid() is not null and pg_trigger_depth() = 1 then
    if new.like_count is distinct from old.like_count then
      raise exception 'post_comments.like_count is derived and cannot be set directly'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;


-- ============================================================================
-- 4. EXECUTE privileges
-- ============================================================================

revoke execute on function public.posts_clamp_counters_on_insert() from public, anon, authenticated;
revoke execute on function public.profiles_freeze_counters()       from public, anon, authenticated;

-- Re-issued for the two functions this file REPLACES rather than creates. `create or
-- replace` preserves an existing ACL, so these are already revoked — but relying on that
-- makes the privilege depend on apply order, and 20260722120000:262-279 records this repo
-- being bitten by exactly the reverse (production kept a revoke a fresh replay did not
-- have). Two lines removes the dependency.
revoke execute on function public.posts_freeze_counter_identity() from public, anon, authenticated;
revoke execute on function public.post_comments_freeze_post_id()  from public, anon, authenticated;


-- ============================================================================
-- 5. Verify
-- ============================================================================

do $$
declare v_missing text;
begin
  select string_agg(t.name, ', ') into v_missing
  from (values
    ('trg_posts_clamp_counters_on_insert', 'posts'),
    ('trg_profiles_freeze_counters',       'profiles'),
    -- The two this file REPLACES the function of but does not create. Without these rows
    -- the check has a silent-no-op hole that is this branch's own subject: if
    -- 20260722140000 never reached the database, applying this file creates two orphan
    -- functions nothing invokes, prints nothing, passes its own verify — and
    -- `update posts set views_count = 2000000000` still succeeds. Only the profiles guard
    -- and the INSERT clamp would be live. Given this repo has TWO recorded
    -- merged-but-never-applied migrations, that is not hypothetical.
    ('trg_posts_freeze_counter_identity',  'posts'),
    ('trg_post_comments_freeze_post_id',   'post_comments')
  ) as t(name, tbl)
  where not exists (
    select 1 from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not g.tgisinternal
       and g.tgname = t.name and c.relname = t.tbl
  );

  if v_missing is not null then
    raise exception 'counter-write guards did not attach: %', v_missing;
  end if;

  -- Existence is not enough: a trigger left over from 20260722140000 would satisfy the
  -- check above while calling a function body that has never heard of a counter. Assert
  -- the guard is actually IN there.
  select string_agg(t.fn, ', ') into v_missing
  from (values
    ('posts_freeze_counter_identity'), ('post_comments_freeze_post_id'),
    ('profiles_freeze_counters'),      ('posts_clamp_counters_on_insert')
  ) as t(fn)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = t.fn
       and pg_get_functiondef(p.oid) like '%pg_trigger_depth%'
  );

  if v_missing is not null then
    raise exception
      'counter guard missing from function body (stale definition?): %', v_missing;
  end if;
end $$;
