-- ============================================================================
-- posts.track_id is identity, not content — freeze it
-- ============================================================================
--
-- THE DEFECT — verified by EXECUTION against production on 2026-08-04, in a rolled-back
-- transaction, impersonating a real uploader as `authenticated`:
--
--   update posts set track_id = '<a track uploaded by someone else>' where id = '<my post>';
--   -> ALLOWED
--
-- `posts_update_own` is `using (author_id = auth.uid()) with check (author_id = auth.uid())`
-- (baseline_schema.sql:309-311): it constrains WHICH ROWS, never WHICH COLUMNS. That is the
-- same lesson 20260722160000 recorded for counters. Confirmed in production that no trigger
-- on `posts` mentions `track_id`.
--
-- `tracks_select_authenticated` is `using (true)`, so every track UUID is enumerable by any
-- signed-in account. The attack is one PATCH, no race, no guessing: my post now serves
-- another artist's master, under my name, with my caption — and every play increments MY
-- views_count, which is a term in the feed ranking score
-- (20260707000000_home_feed_single_call.sql).
--
-- WHY NOW. 20260722140000:59-62 declined to drop the wide UPDATE policy on the recorded
-- grounds that it was dead:
--
--   "they are currently dead — `grep -rn "\.update(" src/` finds no update of posts or
--    post_comments anywhere in the client. Dropping them would work today and silently break
--    the first caption-edit or comment-edit feature someone ships."
--
-- `shared/services/editTrack.ts` is that first caption-edit feature, and the only `.update()`
-- against `posts` in the repository. The condition that justified leaving the policy wide has
-- expired, so the column freeze lands with it.
--
-- WHY A TRIGGER. A policy cannot see OLD, so it cannot express "this column may not change".
-- Same conclusion, same reason, as the counter freeze.
--
-- CAUTION FOR THE NEXT PERSON: this function is `posts_freeze_counter_identity`, NOT
-- `tg_posts_freeze_counter_identity` — the trigger is `trg_...` but the function is not. A
-- first draft of this migration replaced the wrong name with a shortened body and would have
-- silently dropped the ON DELETE SET NULL carve-out AND the counter freeze. The body below is
-- the deployed definition, reproduced verbatim, with one block added.

create or replace function public.posts_freeze_counter_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
end $function$;
