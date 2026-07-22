-- ============================================================================
-- Two defects found while reviewing the counter work
-- ============================================================================
--
-- Both were surfaced by the security-reviewer while it was checking something else, and
-- both are pre-existing. Neither was introduced by the counter migrations.
-- ============================================================================


-- ============================================================================
-- 1. Comment like counts have never worked for anyone but the comment's author
-- ============================================================================
--
-- tg_post_comment_likes_count (20260607000004:29) is SECURITY INVOKER — alone among the
-- six counter trigger functions; the five captured in 20260722120000 are all DEFINER. Its
-- body runs `update public.post_comments set like_count = ...`, which therefore executes
-- as the CALLER under RLS. The only UPDATE policy on that table is post_comments_update_self
-- (`author_id = auth.uid()`, baseline:335).
--
-- So when you like someone else's comment, the trigger's UPDATE matches ZERO ROWS and
-- like_count does not move. No error is raised — an RLS-filtered UPDATE is not an error,
-- it is an update of nothing — so the insert succeeds, the client shows the like, and the
-- count silently stays put.
--
-- REPRODUCED, with a control, rather than inferred from the policy:
--   liker likes the AUTHOR's comment  -> like_count = 0   (silently lost)
--   author likes their OWN comment    -> like_count = 1   (works)
--
-- Which means: in production, essentially every real comment like has been dropped, and
-- the only counts that ever incremented are self-likes. This is why the defect survived —
-- it fails in exactly the direction nobody reports, and it fails silently.
--
-- THE FIX is what the other five already are: SECURITY DEFINER, so the counter write is
-- performed by the table owner rather than by whoever happened to click. That is safe
-- against direct abuse because 20260722160000 froze like_count against any write at
-- pg_trigger_depth() = 1 — this trigger runs at depth 2, so it passes the guard while a
-- client PATCH still does not.
--
-- search_path is pinned at the same time; it had none, so it was in the group of DEFINER
-- functions carrying no pin.

create or replace function public.tg_post_comment_likes_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (tg_op = 'INSERT') then
    update public.post_comments set like_count = like_count + 1 where id = new.comment_id;
  elsif (tg_op = 'DELETE') then
    update public.post_comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end;
$function$;

-- Nothing calls this by name; the trigger machinery invokes it as the table owner.
revoke execute on function public.tg_post_comment_likes_count() from public, anon, authenticated;

-- ── Repair the data the defect corrupted ────────────────────────────────────
-- Every like of someone else's comment since 20260607000004 was dropped, so stored counts
-- are an undercount of unknown size. Recomputed from the source of truth rather than
-- adjusted, following 20260607000006_sync_post_counters.sql, which set the precedent for
-- resyncing a denormalized counter from its rows.
--
-- Runs at trigger depth 0 with a null auth.uid(), so 20260722160000's guard permits it —
-- that is the migration-and-operator-repair branch working as designed.
update public.post_comments c
   set like_count = coalesce(l.n, 0)
  from (select comment_id, count(*)::int as n
          from public.post_comment_likes group by comment_id) l
 where l.comment_id = c.id
   and c.like_count is distinct from coalesce(l.n, 0);

-- Comments whose every like was lost have no row in the subquery above.
update public.post_comments c
   set like_count = 0
 where c.like_count <> 0
   and not exists (select 1 from public.post_comment_likes l where l.comment_id = c.id);


-- ============================================================================
-- 2. conversations — derived and identity columns are writable by any admin
-- ============================================================================
--
-- conv_update (20260528000000:214-219) is a bare `using (caller is an admin of this
-- conversation)` with NO `WITH CHECK` and no `TO` clause. Nothing constrains which
-- columns an admin may write, so an admin can set:
--
--   last_message_preview — free text, shown to every member in their inbox list
--   last_message_at      — which is what that list SORTS by (20260528000000:419)
--   kind                 — 'dm' <-> 'group'
--   created_by           — reassign authorship of the conversation
--
-- Both message columns are maintained by update_conversation_last_message
-- (20260528000000:167-193), a trigger on `messages`. So an admin can display an arbitrary
-- "last message" that nobody sent. Bounded to conversations you already administer, and
-- not anon-reachable — content spoofing, not privilege escalation.
--
-- WHAT THIS DOES **NOT** CLOSE, corrected after review because the first draft implied it
-- did: inbox PINNING is still reachable, by any member rather than only an admin, and by
-- a different route. msg_insert (20260528000000:268-275) constrains sender_id and
-- membership but NOT created_at, and PostgREST writes whatever columns the body names. So
-- inserting a message dated ten years out passes the policy, and the trigger then writes
-- that timestamp to last_message_at at depth 2 — which the guard below correctly permits,
-- because that IS the legitimate path. list_my_conversations orders by last_message_at
-- desc (:419). Closing it means clamping messages.created_at on insert, which is its own
-- change on the hottest write path in the product and is not bundled here.
--
-- THE LEGITIMATE PATH IS PRESERVED: the only client update is updateGroupName
-- (src/services/conversations.ts:217-225), which sends `{ name }` and nothing else.
-- `name` and `avatar_url` stay editable.

create or replace function public.conversations_freeze_derived()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Identity: no legitimate path changes either, at any depth.
  if new.kind is distinct from old.kind then
    raise exception 'conversations.kind is immutable'
      using errcode = '42501';
  end if;
  -- created_by needs the same carve-out posts.original_post_id has, and an earlier
  -- version of this file omitted it — caught in review. conversations.created_by is
  -- `references profiles(id) on delete set null`, and profiles.id cascades from
  -- auth.users, so deleting a user issues `update conversations set created_by = null`.
  -- An unconditional freeze raises inside that cascade and aborts the delete, for anyone
  -- who ever started a DM (get_or_create_dm sets created_by on every one).
  --
  -- Distinguished the same way as 20260722140000: during the RI action the parent row is
  -- already gone, so the EXISTS is false; a hand-written null leaves the profile alive.
  if new.created_by is distinct from old.created_by then
    if not (new.created_by is null
            and old.created_by is not null
            and not exists (select 1 from public.profiles where id = old.created_by)) then
      raise exception 'conversations.created_by is immutable'
        using errcode = '42501';
    end if;
  end if;

  -- Derived: owned by update_conversation_last_message, which runs nested on a message
  -- insert and therefore at depth 2. Same mechanism as 20260722160000; see that file for
  -- why current_user and column grants do not work here.
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    if new.last_message_at is distinct from old.last_message_at
    or new.last_message_preview is distinct from old.last_message_preview then
      raise exception 'conversations last-message fields are derived and cannot be set directly'
        using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_conversations_freeze_derived on public.conversations;
create trigger trg_conversations_freeze_derived
  before update on public.conversations
  for each row
  execute function public.conversations_freeze_derived();

revoke execute on function public.conversations_freeze_derived() from public, anon, authenticated;

-- The missing WITH CHECK. The freeze above is what actually stops the column abuse; this
-- closes the separate gap that an admin could write a row they would not be allowed to
-- write, and makes the policy say what every other UPDATE policy in this schema says.
drop policy if exists "conv_update" on public.conversations;
create policy "conv_update" on public.conversations
  for update to authenticated
  using (exists (
    select 1 from conversation_members
    where conversation_id = conversations.id
      and user_id = auth.uid() and role = 'admin'
  ))
  with check (exists (
    select 1 from conversation_members
    where conversation_id = conversations.id
      and user_id = auth.uid() and role = 'admin'
  ));


-- ============================================================================
-- 3. Verify
-- ============================================================================

do $$
declare v_problem text;
begin
  if not exists (
    select 1 from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and not g.tgisinternal
       and g.tgname='trg_conversations_freeze_derived' and c.relname='conversations'
  ) then
    raise exception 'trg_conversations_freeze_derived did not attach';
  end if;

  -- The whole point of section 1 is that the function was the wrong security mode, so
  -- assert the mode rather than the function's existence.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='tg_post_comment_likes_count' and p.prosecdef
  ) then
    raise exception 'tg_post_comment_likes_count is still SECURITY INVOKER';
  end if;

  -- conv_update must have both halves; a USING-only policy is what this fixes.
  select string_agg(polname, ', ') into v_problem
    from pg_policy
   where polrelid = 'public.conversations'::regclass
     and polname = 'conv_update'
     and polwithcheck is null;

  if v_problem is not null then
    raise exception 'conv_update still has no WITH CHECK';
  end if;

  -- And the repair must have converged.
  select count(*)::text into v_problem
    from public.post_comments c
    left join (select comment_id, count(*)::int n from public.post_comment_likes group by comment_id) l
      on l.comment_id = c.id
   where c.like_count is distinct from coalesce(l.n, 0);

  if v_problem <> '0' then
    raise exception 'like_count resync left % comment(s) disagreeing with post_comment_likes', v_problem;
  end if;
end $$;
