-- ============================================================================
-- Capture the counter triggers that exist only in production
-- ============================================================================
--
-- FOUND BY the schema-parity check on its first run, 2026-07-22. Production had 179
-- security-relevant objects; this repository declared 166.
--
-- WHAT WAS MISSING, and why it matters more than it looks
--
-- Five triggers maintain every denormalized counter in the product, and NONE of them
-- exists in any migration. The baseline creates the counter COLUMNS —
-- posts.likes_count / comments_count / reposts_count / views_count (:113-116) and
-- profiles.followers_count / following_count (:55-56) — and nothing that ever
-- increments them.
--
--   A database rebuilt from this repository has every counter permanently at zero.
--   Likes, comments, reposts, plays, followers.
--
-- That is not a cosmetic gap. posts.views_count is a term in the feed ranking score
-- (20260707000000_home_feed_single_call.sql:92), so a rebuilt database also ranks every
-- post identically. And 20260722000000_liv10_authorization_guards.sql reasons at length
-- about trg_post_views_count inflating views_count — arguing about a trigger absent from
-- the repository it ships in, which means CI could never have exercised that path.
--
-- D-08 IS THEREFORE NOT CLOSED. It was closed on the evidence "31 tables / 99 policies":
-- tables and policies were compared and matched, and nobody counted functions or
-- triggers. The claim "the database can be rebuilt from source" was false for a
-- different object class than the one that got fixed.
--
-- DIRECTION OF CAPTURE, and the check that made it safe
--
-- These bodies are transcribed FROM PRODUCTION via pg_get_functiondef, because
-- production is the running system and its behaviour is the one users have. The
-- opposite direction — writing what we think they should say and applying it — would be
-- a behavioural change wearing a documentation change's clothes.
--
-- THE TRIGGER WRAPPERS WERE DUMPED TOO, via pg_get_triggerdef — not reconstructed.
-- That distinction matters and the security review was right to demand it:
-- pg_get_functiondef returns the FUNCTION only and says nothing about a trigger's
-- timing, event list, row-vs-statement, column list or WHEN clause. Since every
-- `create trigger` below is preceded by `drop trigger if exists`, applying this file
-- REPLACES the live trigger — so a wrapper reconstructed from memory would silently
-- change production, and (until this branch added pg_get_triggerdef to the fingerprint)
-- the parity check could not have seen it.
--
-- Verified against production 2026-07-22, all five identical, none carrying a WHEN
-- clause or a column list:
--   trg_post_likes_count        AFTER INSERT OR DELETE ON public.post_likes    FOR EACH ROW
--   trg_post_comments_count     AFTER INSERT OR DELETE ON public.post_comments FOR EACH ROW
--   trg_post_reposts_count      AFTER INSERT OR DELETE ON public.posts         FOR EACH ROW
--   trg_post_views_count        AFTER INSERT           ON public.post_views    FOR EACH ROW
--   trg_follows_profile_counts  AFTER INSERT OR DELETE ON public.follows       FOR EACH ROW
--
-- Before transcribing, the guards were checked rather than assumed, because capturing
-- production blindly is exactly how a security fix gets silently reverted (the D-53
-- lesson). Verified 2026-07-22: production's create_jam_room and get_jam_snapshot both
-- still contain is_conversation_member, so 20260720192310's membership fix is intact and
-- nothing here rolls it back.
--
-- Forward-only and idempotent: `create or replace` plus `drop trigger if exists` before
-- each `create trigger`, so re-applying is a no-op.
-- ============================================================================


-- ============================================================================
-- 1. posts.likes_count
-- ============================================================================

create or replace function public.tg_post_likes_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (tg_op = 'INSERT') then
    update public.posts set likes_count = likes_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts set likes_count = greatest(likes_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_post_likes_count on public.post_likes;
create trigger trg_post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.tg_post_likes_count();


-- ============================================================================
-- 2. posts.comments_count
-- ============================================================================

create or replace function public.tg_post_comments_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (tg_op = 'INSERT') then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts set comments_count = greatest(comments_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_post_comments_count on public.post_comments;
create trigger trg_post_comments_count
  after insert or delete on public.post_comments
  for each row execute function public.tg_post_comments_count();


-- ============================================================================
-- 3. posts.reposts_count
-- ============================================================================
--
-- Note this one fires on `posts`, not on a join table: a repost IS a post, identified by
-- kind = 'repost' with original_post_id set. The counter it maintains lives on a
-- DIFFERENT row of the same table — the original. Both branches guard on kind and on
-- original_post_id being non-null, so an ordinary upload never touches a counter.

create or replace function public.tg_post_reposts_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (tg_op = 'INSERT') then
    if new.kind = 'repost' and new.original_post_id is not null then
      update public.posts set reposts_count = reposts_count + 1 where id = new.original_post_id;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.kind = 'repost' and old.original_post_id is not null then
      update public.posts set reposts_count = greatest(reposts_count - 1, 0) where id = old.original_post_id;
    end if;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_post_reposts_count on public.posts;
create trigger trg_post_reposts_count
  after insert or delete on public.posts
  for each row execute function public.tg_post_reposts_count();


-- ============================================================================
-- 4. posts.views_count
-- ============================================================================
--
-- INSERT only, with no decrement and no DELETE branch — plays are append-only, and
-- 20260607000005 made the absence of dedup deliberate so that looping a track keeps
-- counting. LIV-10 bounded the funnel with a 1s per-(user, post) cooldown in
-- activity_record_play rather than by changing this trigger; note the cooldown lives in
-- the RPC, so this trigger still counts every row that reaches post_views by any path.
-- With post_views_insert_self dropped by LIV-10, the RPC is now the only such path.

create or replace function public.tg_post_views_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.posts set views_count = views_count + 1 where id = new.post_id;
  return null;
end;
$function$;

drop trigger if exists trg_post_views_count on public.post_views;
create trigger trg_post_views_count
  after insert on public.post_views
  for each row execute function public.tg_post_views_count();


-- ============================================================================
-- 5. profiles.followers_count / following_count
-- ============================================================================
--
-- One trigger maintains BOTH sides of the edge: the followed user's followers_count and
-- the follower's following_count.
--
-- It does not filter on follows.kind, and that is correct rather than an oversight —
-- an earlier version of this comment claimed a 'star' edge "counts the same as a plain
-- follow", which describes a state the schema cannot reach. `follows_kind_check`
-- (00000000000000_baseline_schema.sql:170) constrains kind to 'star' and the column
-- defaults to 'star', so THERE IS NO PLAIN FOLLOW. A `where kind = 'star'` filter here
-- would be dead code.
--
-- The coupling is worth stating because it is remote and silent: src/services/follows.ts
-- :22,27 DOES filter `.eq('kind','star')` when counting. Trigger and client agree today
-- only because the CHECK constraint forces them to. If a migration ever relaxes
-- follows_kind_check to admit a second kind, this trigger starts over-counting
-- followers_count while the client's own count query does not — a divergence with no
-- test behind it. Relaxing that constraint means revisiting this function.

create or replace function public.tg_follows_profile_counts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (tg_op = 'INSERT') then
    update public.profiles
       set followers_count = coalesce(followers_count, 0) + 1
     where id = new.following_id;
    update public.profiles
       set following_count = coalesce(following_count, 0) + 1
     where id = new.follower_id;
  elsif (tg_op = 'DELETE') then
    update public.profiles
       set followers_count = greatest(coalesce(followers_count, 0) - 1, 0)
     where id = old.following_id;
    update public.profiles
       set following_count = greatest(coalesce(following_count, 0) - 1, 0)
     where id = old.follower_id;
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_follows_profile_counts on public.follows;
create trigger trg_follows_profile_counts
  after insert or delete on public.follows
  for each row execute function public.tg_follows_profile_counts();


-- ============================================================================
-- 6. Re-issue a drop that was merged in June and never applied
-- ============================================================================
--
-- 20260608000001_drop_new_fans_summary.sql drops these two. They are still live in
-- production, so that migration never reached the database — a second instance of
-- merged-but-not-applied, and one that predates D-55 by six weeks. It is the evidence
-- that the merge->apply gap was not a one-off.
--
-- Repeated here rather than assumed: this migration's job is to make applying it produce
-- agreement, and the earlier drop cannot be relied upon to have run.

drop function if exists public.get_new_fans_summary();
drop function if exists public.mark_fans_seen();

-- The COLUMN from that same migration, which an earlier draft of this file forgot.
-- Caught by the security review, and the omission is instructive: after the two function
-- drops, functions would agree while profiles.fans_seen_at still existed in production
-- and not in a replay — and scripts/schema-fingerprint.sql compares policies, RLS,
-- functions and triggers but NOT COLUMNS, so parity would have reported green over a
-- real remaining divergence. On a branch whose entire premise is that unmeasured object
-- classes are where drift hides, that is the mistake to avoid twice.
--
-- Safe: no reference in src/ or lib/ except the generated database.types.ts, and the
-- NewFansBanner that used it was removed in June.
alter table public.profiles drop column if exists fans_seen_at;


-- ============================================================================
-- 7. Verify, rather than assert
-- ============================================================================
--
-- The whole point of this file is that nobody counted. So it counts, and refuses to
-- report success if a trigger did not attach. A silent partial apply here would restore
-- the exact condition being fixed.

do $$
declare
  v_missing text;
begin
  select string_agg(t.name, ', ')
    into v_missing
  from (values
    ('trg_post_likes_count',       'post_likes'),
    ('trg_post_comments_count',    'post_comments'),
    ('trg_post_reposts_count',     'posts'),
    ('trg_post_views_count',       'post_views'),
    ('trg_follows_profile_counts', 'follows')
  ) as t(name, tbl)
  where not exists (
    select 1
      from pg_trigger g
      join pg_class   c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and not g.tgisinternal
       and g.tgname  = t.name
       and c.relname = t.tbl
  );

  if v_missing is not null then
    raise exception
      'counter-trigger capture incomplete: % did not attach', v_missing;
  end if;
end $$;
