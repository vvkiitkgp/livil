-- ============================================================================
-- Account deletion — make the thing we already promise publicly actually possible
-- ============================================================================
--
-- `docs/delete-account.html` is live and gives step-by-step instructions:
-- "Open Livil → Profile tab → Settings → Delete Account". **None of that exists.**
-- There is no Settings screen in `src/screens/main/`, and `grep -rniE "delete.?account"
-- src/ lib/` returns nothing. The page also offers an email fallback and promises
-- deletion "within 30 days" — a commitment made to users and to Google Play, which
-- requires an in-app deletion path for accounts created in-app.
--
-- And the email fallback could not have been honoured either, because **the database
-- refused to delete a profile at all**:
--
--   messages.sender_id         -> profiles(id)  NO ACTION
--   jam_rooms.host_id          -> profiles(id)  NO ACTION
--   jam_queue.suggested_by     -> profiles(id)  NO ACTION
--   jam_rooms.current_track_id -> tracks(id)    NO ACTION   <- one level deeper
--   jam_queue.track_id         -> tracks(id)    NO ACTION   <- one level deeper
--
-- FIVE, not three. The last two are reached via profiles -> tracks and were missed by the
-- first version of this migration; see section 1. Deleting anyone who had ever sent a
-- message, or uploaded a track that was ever queued in a jam, failed with 23503. The
-- promise was unimplementable, not merely unimplemented.
--
-- ── WHAT HAPPENS TO MESSAGES YOU SENT — the one real decision here ──────────
--
-- SET NULL, not CASCADE. Both are available (the columns are nullable), so this is a
-- choice and it should be argued rather than defaulted.
--
-- The argument that stands: CASCADE means deleting your account punches holes in *other
-- people's* conversation history — their record of a conversation they took part in,
-- altered without their involvement. Anonymizing rather than erasing is also what
-- docs/privacy-policy.html:489-491 describes ("delete **or anonymize**").
--
-- AN EARLIER VERSION OF THIS COMMENT CLAIMED THE DELETION PAGE SETTLES IT. It does not,
-- and the security review was right to push back. Section 3 lists what is deleted and
-- sent messages are absent — but it also lists "comments", which are equally content
-- shared with others, as deleted. Section 4's "content you shared that has been saved or
-- re-shared by other users" reads as being about reposts, not DMs. The page's categories
-- are not self-consistent, so it is evidence, not a decision.
--
-- **STILL OPEN, and it is a product decision rather than a security one:** once
-- sender_id is NULL, `msg_update`'s `sender_id = auth.uid()` is NULL for every caller,
-- and it is the only write policy on `messages` — there is no delete policy at all. So a
-- surviving message becomes permanently uneditable and undeletable BY ANYONE, including
-- the recipient. If someone harasses a user and then deletes their account, it is frozen
-- in that inbox with no moderation path (threat model §7). Recorded against D-62; the
-- likely remedies are widening msg_update to admit `sender_id is null and <caller is a
-- member>`, and saying plainly on the deletion page what happens to sent messages.
--
-- CONSEQUENCE FOR THE CLIENT, and it is not optional: `messages.sender_id` becomes
-- nullable in practice, so every read path must render a deleted author rather than
-- assuming a profile join succeeds. Same for jam_rooms.host_id and jam_queue.suggested_by.
-- `src/**` is propose-only for agents, so that work is proposed alongside this migration
-- and is NOT delivered by it. Until it lands, this migration is safe but the UI may show
-- a blank name where a deleted user's message sits.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
--
-- The underlying storage BYTES are not guaranteed erased. `delete_my_account` removes the
-- rows from `storage.objects`, which makes the files unreachable through the storage API
-- and unlisted — but Supabase's storage service owns the S3 objects, and deleting metadata
-- directly can leave orphaned bytes behind. Honouring "we permanently remove your uploaded
-- media" to the letter needs a `storage.from(bucket).remove([...])` call, which is client
-- or edge work. Stated here rather than glossed: the page's claim is not fully satisfied
-- by this migration alone, and that gap is recorded in the debt register.
-- ============================================================================


-- ============================================================================
-- 1. The three foreign keys that made deletion impossible
-- ============================================================================
-- All three columns are already nullable, so no data is rewritten and no column type
-- changes — only the referential action.

alter table public.messages
  drop constraint if exists messages_sender_id_fkey,
  add  constraint messages_sender_id_fkey
       foreign key (sender_id) references public.profiles(id) on delete set null;

alter table public.jam_rooms
  drop constraint if exists jam_rooms_host_id_fkey,
  add  constraint jam_rooms_host_id_fkey
       foreign key (host_id) references public.profiles(id) on delete set null;

alter table public.jam_queue
  drop constraint if exists jam_queue_suggested_by_fkey,
  add  constraint jam_queue_suggested_by_fkey
       foreign key (suggested_by) references public.profiles(id) on delete set null;

-- ── And two more, ONE LEVEL DEEPER, which the first version of this file missed ──
--
-- Fixing the three FKs into `profiles` is not sufficient, and believing it was is the
-- mistake this migration originally shipped with. The cascade continues:
--
--   auth.users -> profiles (cascade) -> tracks.uploader_id (cascade) -> ???
--
-- and lands on two references to `tracks` that are also NO ACTION:
--
--   jam_rooms.current_track_id -> tracks   (20260528000000_chat_jam.sql:67)
--   jam_queue.track_id         -> tracks   (:94)
--
-- So ANY user who uploaded a track that was ever queued or played in a jam still could
-- not be deleted — the same 23503, one level down. Confirmed against production.
--
-- Found by the security-reviewer, NOT by this file's own verification, which walked only
-- foreign keys whose parent is `profiles`. That check proved "nothing referencing profiles
-- blocks" while claiming "deletion is now possible" — a narrower measurement than the
-- sentence it supported. That is the identical error recorded the same day against D-08's
-- closure ("31 tables / 99 policies" vs "matches exactly"). Section 3 is now written to
-- prove the actual property; see the note there.
--
-- No manual clearing of current_track_id is needed: ON DELETE SET NULL nulls it as the
-- track is removed. The `update ... set status='ended'` below remains, because ending a
-- jam is about the HOST leaving, not about the track.

alter table public.jam_rooms
  drop constraint if exists jam_rooms_current_track_id_fkey,
  add  constraint jam_rooms_current_track_id_fkey
       foreign key (current_track_id) references public.tracks(id) on delete set null;

alter table public.jam_queue
  drop constraint if exists jam_queue_track_id_fkey,
  add  constraint jam_queue_track_id_fkey
       foreign key (track_id) references public.tracks(id) on delete set null;


-- ============================================================================
-- 2. delete_my_account()
-- ============================================================================
--
-- WHY AN RPC AND NOT AN EDGE FUNCTION: deleting from `auth.users` needs privilege the
-- mobile client does not have and must never have. The alternative is a function holding
-- `service_role`, which ADR-0008 decision #4 rules out ("nothing may hold a service_role
-- key" — it is a bearer JWT bypassing RLS on every table). Verified that `postgres` holds
-- DELETE on `auth.users` (owner is `supabase_auth_admin`, but the grant exists), so a
-- SECURITY DEFINER function owned by `postgres` can do exactly this one thing and nothing
-- else. It is also the only option that works today: `list_edge_functions` returns `[]`
-- for this project — see D-54.
--
-- WHY IT TAKES NO PARAMETER: the account deleted is always `auth.uid()`. ADR-0008
-- decision #1 applied to a far more dangerous verb than a notification — a caller-supplied
-- user id here would be account deletion as a service. The parameter is not validated, it
-- is absent, so the defect is unrepresentable.
--
-- Deleting the `auth.users` row is sufficient for everything else: `profiles.id`
-- references `auth.users(id) on delete cascade`, and all 29 foreign keys into `profiles`
-- now either CASCADE or SET NULL. Verified by enumeration, not assumed.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- End any jam this user is hosting first. host_id is about to become null, and a live
  -- room with no host is unusable but still advertised: broadcast_jam_state gates on
  -- `host_id = auth.uid()`, so nobody could ever drive it again.
  update public.jam_rooms
     set status = 'ended', ended_at = now()
   where host_id = v_me
     and status = 'active';

  -- Storage metadata. Both buckets namespace by uploader as the first path segment —
  -- `${userId}/avatar_...` (src/services/profileService.ts:195) and
  -- `${userId}/${trackId}/${kind}.${ext}` (src/services/uploads.ts:204). `owner` is NULL
  -- on every existing object, so it cannot be used and the path prefix is the only
  -- reliable key. Anchored on the FIRST SEGMENT rather than a LIKE prefix so that a
  -- crafted path cannot match another user's namespace.
  delete from storage.objects
   where (string_to_array(name, '/'))[1] = v_me::text;

  -- The cascade does the rest.
  delete from auth.users where id = v_me;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;


-- ============================================================================
-- 3. Verify
-- ============================================================================
-- Asserts the PROPERTY — that a row can actually be deleted from auth.users — rather than
-- the change, and rather than a proxy for the property.
--
-- THE FIRST VERSION OF THIS BLOCK CHECKED ONLY FOREIGN KEYS WHOSE PARENT IS `profiles`.
-- That is a real check, but it proves "nothing referencing profiles blocks", not "deletion
-- is possible" — and the gap between those two sentences is exactly where the
-- tracks -> jam_rooms/jam_queue blockers were hiding. It passed while deletion remained
-- broken for any user whose upload had been played in a jam.
--
-- So this now walks the TRANSITIVE CLOSURE from auth.users: start there, follow every
-- foreign key that CASCADES (those propagate the delete to the child table), and flag any
-- NO ACTION / RESTRICT reference into anything reachable. SET NULL edges neither block nor
-- propagate, so they correctly terminate a branch. `union` (not `union all`) terminates
-- the recursion on the schema's self-references.
--
-- Verified before adoption: run against production BEFORE this migration, it returns all
-- five real blockers — the three into `profiles` and the two into `tracks`. A check that
-- only finds what you already knew is not evidence.

do $$
declare
  v_blocking text;
begin
  with recursive deleted_tables(oid) as (
    select 'auth.users'::regclass::oid
    union
    select c.conrelid
      from pg_constraint c
      join deleted_tables d on c.confrelid = d.oid
     where c.contype = 'f'
       and c.confdeltype = 'c'        -- CASCADE: the delete reaches this table too
  )
  select string_agg(
           format('%s.%s -> %s', c.conrelid::regclass, c.conname, c.confrelid::regclass),
           ', ' order by c.conrelid::regclass::text)
    into v_blocking
    from pg_constraint c
    join deleted_tables d on c.confrelid = d.oid
   where c.contype = 'f'
     and c.confdeltype in ('a', 'r');   -- NO ACTION / RESTRICT

  if v_blocking is not null then
    raise exception
      'account deletion still blocked by foreign key(s): %', v_blocking;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_my_account' and p.prosecdef
  ) then
    raise exception 'delete_my_account missing or not SECURITY DEFINER';
  end if;

  -- anon must not be able to call this. Checked explicitly because the default is
  -- EXECUTE TO PUBLIC and 20260722000000 section 7 was the first revoke in 38 migrations.
  if has_function_privilege('anon', 'public.delete_my_account()', 'execute') then
    raise exception 'delete_my_account is executable by anon';
  end if;
end $$;
