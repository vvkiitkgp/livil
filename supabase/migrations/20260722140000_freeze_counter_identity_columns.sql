-- ============================================================================
-- Freeze the columns that decide which row a counter trigger increments
-- ============================================================================
--
-- THE DEFECT, found by the security-reviewer on 20260722120000 and verified here.
--
-- tg_post_reposts_count and tg_post_comments_count are `after insert or delete`. Neither
-- has an UPDATE branch. Meanwhile posts_update_own and post_comments_update_self permit
-- an owner to UPDATE ANY COLUMN of their own row — there are no column-level grants
-- anywhere in this schema. So the column that decides WHICH row gets counted can be moved
-- in between the increment and the decrement, and the two no longer cancel.
--
-- EXECUTED against a replay WITHOUT this migration, rather than reasoned about. What
-- actually succeeds, and what an existing constraint already stopped — the distinction
-- matters, because overstating a vulnerability costs as much credibility as missing one.
--
-- posts_kind_shape_check is `((kind='upload' AND original_post_id IS NULL) OR
-- kind='repost')`. It does NOT constrain the repost branch at all, but it does forbid
-- kind='upload' while original_post_id is set. So:
--
--   CONFIRMED exploitable (all three ran clean against a pre-fix replay):
--     a. Retarget a repost: update original_post_id from V to W, kind untouched. No
--        trigger fires, so V keeps the +1 it was given and W never receives one.
--        Deleting the repost then decrements W — which never gained a count — while V
--        keeps its phantom +1. One statement inflates V and floors W at once.
--     b. Orphan by hand: update original_post_id to null while V still exists. Deleting
--        the repost afterwards decrements nothing, so V's +1 is permanent with no repost
--        row behind it.
--     c. Move a comment: update post_comments.post_id from V to W. V's comments_count
--        keeps the +1; deleting the comment decrements W instead.
--
--   ALREADY BLOCKED, by posts_kind_shape_check rather than by anything intentional:
--     the single-statement `kind='upload', original_post_id` still set. Note this is a
--     speed bump, not a defence — (b) then (a) reaches the same place in two statements,
--     and the constraint exists to keep uploads well-formed, not to protect a counter.
--
-- The victim sees a count move with nothing to report: no repost under their post, no
-- comment on it, nothing to point at.
--
-- WHY THIS IS NOT COSMETIC: reposts_count carries weight 3.0 in the feed ranking score
-- (20260707000000_home_feed_single_call.sql:89-92) — the highest of the four terms,
-- ahead of comments_count at 1.0 and views_count at /10. It is a stronger ranking lever
-- than the views funnel LIV-10 bounded with a cooldown, and unlike repost-spam it leaves
-- NO VISIBLE ROWS: the victim watches their count fall with nothing to report, and the
-- attacker's inflated post shows no reposts underneath it.
--
-- WHY A TRIGGER AND NOT A POLICY: RLS cannot compare OLD to NEW. WITH CHECK sees only the
-- new row, and both policies already have one (`author_id = auth.uid()`, so reassigning a
-- post to someone else is already blocked). Only a trigger can say "this column may not
-- change". Same reasoning, and the same shape, as conversation_members_freeze_identity in
-- 20260722000000_liv10_authorization_guards.sql:199.
--
-- WHY NOT AN UPDATE BRANCH ON THE COUNTER TRIGGERS: two traps. The branch's own
-- `update posts` would re-enter the trigger; and because original_post_id is
-- ON DELETE SET NULL, deleting an original issues an UPDATE against every repost of it,
-- so an UPDATE branch would decrement rows that are being orphaned rather than removed.
-- Freezing the columns avoids both.
--
-- WHY NOT JUST DROP THE UPDATE POLICIES: they are currently dead — `grep -rn "\.update("
-- src/` finds no update of posts or post_comments anywhere in the client. Dropping them
-- would work today and silently break the first caption-edit or comment-edit feature
-- someone ships. Freezing two columns leaves the rest of the row editable.
-- ============================================================================


-- ============================================================================
-- posts — kind and original_post_id
-- ============================================================================
--
-- THE ON DELETE SET NULL CARVE-OUT, which is the whole difficulty here.
--
-- posts_original_post_id_fkey is ON DELETE SET NULL. Deleting an original therefore
-- issues an UPDATE setting original_post_id = null on EVERY repost of it. A naive freeze
-- would raise inside that cascade and make any reposted post undeletable — turning a
-- security fix into a data-integrity outage.
--
-- The transition is distinguishable without a flag: during the cascade the parent row is
-- already gone, so `not exists (select 1 from posts where id = old.original_post_id)` is
-- true. A user nulling the column by hand leaves the parent very much alive, so the same
-- test is false. That closes the inflate path (step 2 above) while letting the cascade
-- through, and it needs no session GUC and no trigger-depth inspection.

create or replace function public.posts_freeze_counter_identity()
returns trigger
language plpgsql
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
            and not exists (select 1 from posts where id = old.original_post_id)) then
      raise exception 'posts.original_post_id is immutable'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_posts_freeze_counter_identity on public.posts;

-- BEFORE UPDATE, so it rejects before the row is written. Note this fires for EVERY
-- caller including SECURITY DEFINER functions and the counter triggers themselves —
-- which is fine, because none of them touches kind or original_post_id. If a future
-- feature genuinely needs to, give it a named exemption rather than deleting this
-- trigger; deleting it reopens the counter-manipulation above for every authenticated
-- user.
create trigger trg_posts_freeze_counter_identity
  before update on public.posts
  for each row
  execute function public.posts_freeze_counter_identity();


-- ============================================================================
-- post_comments — post_id
-- ============================================================================
--
-- No carve-out needed: post_comments_post_id_fkey is ON DELETE CASCADE, so deleting a
-- post removes its comments rather than updating them. Nothing legitimately moves a
-- comment between posts.

create or replace function public.post_comments_freeze_post_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.post_id is distinct from old.post_id then
    raise exception 'post_comments.post_id is immutable'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_post_comments_freeze_post_id on public.post_comments;

create trigger trg_post_comments_freeze_post_id
  before update on public.post_comments
  for each row
  execute function public.post_comments_freeze_post_id();


-- ============================================================================
-- EXECUTE privileges
-- ============================================================================
-- Trigger functions, invoked by the trigger machinery as the table owner. Nothing calls
-- these by name. Verified in 20260722120000 that revoking EXECUTE does not stop a trigger
-- firing — PostgreSQL does not check EXECUTE for trigger-invoked functions.

revoke execute on function public.posts_freeze_counter_identity()  from public, anon, authenticated;
revoke execute on function public.post_comments_freeze_post_id()   from public, anon, authenticated;


-- ============================================================================
-- Verify
-- ============================================================================

do $$
declare v_missing text;
begin
  select string_agg(t.name, ', ') into v_missing
  from (values
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
    raise exception 'freeze triggers did not attach: %', v_missing;
  end if;
end $$;
