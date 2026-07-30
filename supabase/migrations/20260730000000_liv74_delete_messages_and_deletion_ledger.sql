-- LIV-74 — account deletion deletes the user's messages, and records the departure.
--
-- Reverses ADR-0014's attribution-only ruling (maintainer, 2026-07-30): uploads, posts,
-- playlists and albums already go, so messages stop being the exception. Reasoning and
-- the rejected alternatives live in ADR-0015; this file states only what it does.
--
-- Two parts of it are deliberate and were ratified AFTER the objection was put to the
-- maintainer, so do not "fix" either:
--   * a `dm` conversation is deleted WHOLE, including the other participant's own
--     messages — data belonging to someone who did not ask to be deleted;
--   * a `group` loses only the departing user's messages.
--
-- Requires security-reviewer sign-off (autonomy-config.yml: MANDATORY).


-- ============================================================================
-- 1. A reply must not block the delete
-- ============================================================================
-- `messages_reply_to_id_fkey` is NO ACTION, so deleting a message another member
-- replied to aborts with 23503 — and no foreign-key walk from auth.users can see it,
-- because the RPC's DELETE is explicit rather than a cascade. CASCADE here would
-- remove that member's reply, which is the one thing section 3 must not do.

alter table public.messages
  drop constraint if exists messages_reply_to_id_fkey,
  add  constraint messages_reply_to_id_fkey
       foreign key (reply_to_id) references public.messages(id) on delete set null;


-- ============================================================================
-- 2. The deletion ledger
-- ============================================================================
-- A HASH of the email, never the address: retaining plaintext contact data after a
-- deletion request is the thing the deletion promise exists to prevent. The hash still
-- answers "has this address deleted before?" and identifies the one account allowed to
-- reclaim the username (section 3).
--
-- Both payload columns are nullable on purpose. A NOT NULL here would let a user with no
-- email, or no profile row, abort their own deletion — the failure class this schema has
-- already paid for twice (SET NULL onto NOT NULL, 23514 on a relaxed CHECK).

create table if not exists public.deleted_accounts (
  id           bigint generated always as identity primary key,
  email_sha256 text,
  username     text,
  deleted_at   timestamptz not null default now()
);

create index if not exists deleted_accounts_username_idx  on public.deleted_accounts (username);
create index if not exists deleted_accounts_email_idx     on public.deleted_accounts (email_sha256);

-- No client access at all, and RLS with zero policies is what enforces it. The REVOKE is
-- defence in depth only: ci.yml re-grants every table to `authenticated` after migrations,
-- which is why ADR-0014 rejected grant-based controls.
alter table public.deleted_accounts enable row level security;
revoke all on public.deleted_accounts from anon, authenticated;

-- One definition of the normalisation, because a divergence between the hash written at
-- deletion and the hash compared at reclaim would silently deny the rightful owner.
-- Takes the address rather than a user id: hashing a value the caller already holds
-- leaks nothing, whereas `hash_for(user_id)` would be an offline oracle for any user's
-- email and would need a REVOKE that ci.yml undoes.
create or replace function public.account_email_hash(p_email text)
returns text
language sql
immutable
as $$
  select case
           when p_email is null or btrim(p_email) = '' then null
           else encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
         end
$$;


-- ============================================================================
-- 3. The recorded username is reserved, and released only to the same address
-- ============================================================================
-- Enforced by a trigger on `profiles`, not inside claim_username, because
-- `profiles_update_own` lets any account with `username_set = false` write `username`
-- with a plain PATCH — `enforce_username_immutable` only closes the door after it is set.
-- Uniqueness on profiles.username is what actually gates availability today, so the
-- reservation has to sit at the table or it is bypassable.
--
-- NOT enforced with a unique constraint on the ledger: the same address deleting twice
-- would then raise inside delete_my_account and break deletion outright.
--
-- A live account already holding a ledgered username keeps it. Nothing here touches
-- existing rows, and profiles.username remains the authority for live names; the ledger
-- only gates a NEW claim.

create or replace function public.enforce_username_reservation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := lower(btrim(new.username));
  v_hash text;
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
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

  return new;
end $$;

drop trigger if exists trg_enforce_username_reservation on public.profiles;

create trigger trg_enforce_username_reservation
  before insert or update on public.profiles
  for each row
  execute function public.enforce_username_reservation();


-- The pre-flight must agree with the write, or the UI offers a name the trigger refuses.
-- An anonymous caller has no address to compare, so a reserved name reads as taken for
-- them: reporting it available on a supplied email would turn this into an oracle for
-- whose address once held the username. Consequence, stated because it is a real gap:
-- the anon sign-up pre-flight cannot see a reclaim, so reclaim works from the
-- authenticated onboarding path only.
create or replace function public.is_username_available(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := lower(btrim(p_username));
  v_hash text;
begin
  if p_username is null or length(v_name) = 0 then
    return false;
  end if;

  if exists (select 1 from public.profiles where username = v_name) then
    return false;
  end if;

  select public.account_email_hash(u.email) into v_hash
    from auth.users u
   where u.id = auth.uid();

  return not exists (
    select 1 from public.deleted_accounts d
     where d.username = v_name
       and (v_hash is null or d.email_sha256 is null or d.email_sha256 <> v_hash)
  );
end $$;


-- ============================================================================
-- 4. delete_my_account()
-- ============================================================================
-- Unchanged from 20260724000000's version except for the ledger write and the two
-- deletes. Still no parameter, so the account deleted is always auth.uid() and there is
-- nothing to authorize beyond being signed in.
--
-- The two deletes REQUIRE security definer: `messages` and `conversations` have no DELETE
-- policy at all, so under RLS both statements would match zero rows and raise nothing.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Written before auth.users goes, while the email and username are still readable.
  insert into public.deleted_accounts (email_sha256, username)
  select public.account_email_hash(u.email), lower(btrim(p.username))
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = v_me;

  -- End any jam this user is hosting first. host_id is about to become null, and a live
  -- room with no host is unusable but still advertised: broadcast_jam_state gates on
  -- `host_id = auth.uid()`, so nobody could ever drive it again.
  update public.jam_rooms
     set status = 'ended', ended_at = now()
   where host_id = v_me
     and status = 'active';

  -- A DM goes whole — see the header; this is ratified, not an oversight. Cascades from
  -- conversations take conversation_members, messages, message_reactions, jam_rooms and
  -- jam_queue with it.
  delete from public.conversations c
   where c.kind = 'dm'
     and exists (
       select 1 from public.conversation_members m
        where m.conversation_id = c.id
          and m.user_id = v_me
     );

  -- Groups keep everyone else's messages. Runs after the DM sweep, so this is the
  -- group remainder.
  delete from public.messages where sender_id = v_me;

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
-- 5. Drift check
-- ============================================================================
-- A half-applied perimeter that looks applied is worse than a failed apply.

do $$
declare
  v_bad text;
begin
  if (select not relrowsecurity from pg_class where oid = 'public.deleted_accounts'::regclass) then
    raise exception
      'LIV-74 aborted: row-level security is DISABLED on deleted_accounts, so every client can read it';
  end if;

  -- RLS with no policy is the whole control, so ANY policy on this table is a regression.
  select string_agg(polname, ', ') into v_bad
    from pg_policy where polrelid = 'public.deleted_accounts'::regclass;
  if v_bad is not null then
    raise exception
      'LIV-74 aborted: deleted_accounts must have no policies, found: %', v_bad;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'trg_enforce_username_reservation'
       and not tgisinternal
  ) then
    raise exception
      'LIV-74 aborted: trg_enforce_username_reservation is not installed on profiles';
  end if;

  -- The property section 1 exists to establish, by name-independent means, and widened to
  -- the whole class: nothing may block a delete of the rows this RPC removes directly.
  -- The auth.users cascade walk in 20260722200000 cannot see these — an explicit DELETE
  -- is not a referential action. Deliberately stricter than the DM path strictly needs
  -- (a NO ACTION self-reference resolved inside one statement would be fine); the group
  -- path, which leaves the replier's row behind, is the one that has to hold.
  with recursive reachable(oid) as (
    select unnest(array['public.conversations'::regclass::oid,
                        'public.messages'::regclass::oid])
    union
    select c.conrelid
      from pg_constraint c
      join reachable r on c.confrelid = r.oid
     where c.contype = 'f' and c.confdeltype = 'c'
  )
  select string_agg(
           format('%s.%s -> %s', c.conrelid::regclass, c.conname, c.confrelid::regclass),
           ', ' order by c.conname)
    into v_bad
    from pg_constraint c
    join reachable r on c.confrelid = r.oid
   where c.contype = 'f' and c.confdeltype in ('a', 'r');
  if v_bad is not null then
    raise exception
      'LIV-74 aborted: message/conversation deletion still blocked by foreign key(s): %', v_bad;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_my_account'
       and p.prosecdef and p.pronargs = 0
  ) then
    raise exception
      'LIV-74 aborted: delete_my_account must remain SECURITY DEFINER with no parameter';
  end if;
end $$;
