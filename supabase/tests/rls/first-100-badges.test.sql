-- First 100 — the cap, and the order nobody may recover.
--
-- Three product rules are load-bearing here, and each one fails SILENTLY if it breaks:
--
--   1. AT MOST 100 GRANTS, EVER. A cap enforced in the dashboard instead of the database
--      does not fail loudly — it produces a 101st badge that nobody notices until a user
--      does the counting.
--   2. AWARD ORDER IS UNRECOVERABLE. `ordinal` and `awarded_at` exist on the row because
--      the cap needs something to count, and they must never reach a client. A policy
--      added to `profile_badges` in good faith — "let people read their own badge" —
--      would publish the ordering, and every screen would still look correct.
--   3. A SLOT IS SPENT, NOT LENT. Revoking a badge, or the holder deleting their account,
--      must not put the slot back. Under ON DELETE CASCADE it silently does, and the
--      only symptom is that "first 100" eventually means something else.
--
-- These assert the properties, not the statements.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/first-100-badges.test.sql
--
-- Runs after every migration, in the same ephemeral Postgres as authorization.test.sql.

\set ON_ERROR_STOP on
begin;

-- ── Harness ─────────────────────────────────────────────────────────────────
create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

-- DISCARD PLANS is not optional here, and this is the one place these tests differ from
-- their siblings. `is_ops()` is STABLE SQL, so Postgres INLINES it into the cached plan
-- for every `if not public.is_ops()` in this migration's functions — baking in whichever
-- auth.uid() body existed at first call. CREATE OR REPLACE does not invalidate through an
-- inline, so without this the first non-ops call poisons the session and every later
-- ops call returns empty, failing assertions about behaviour that is actually correct.
create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  discard plans;
end $$;

-- Reports whether the statement was refused FOR THE STATED REASON. `when others` would
-- let an assertion pass on an unrelated failure — "granting to a missing profile is
-- refused" passed via a foreign-key violation while the explicit check was deleted.
-- Same discipline as pg_temp.allows() in track-tags.test.sql.
create or replace function pg_temp.raises(stmt text, expected text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception
  when others then
    -- position(), not LIKE: every string these calls expect contains an underscore, and
    -- under LIKE that is a single-character wildcard — so 'notXauthorized' would satisfy
    -- a check for 'not_authorized', undoing the precision this argument exists for.
    if position(expected in sqlerrm) > 0 then
      return true;
    end if;
    raise exception 'raised the WRONG error: expected %, got %', expected, sqlerrm;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- One operator, two ordinary accounts.
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-0000000000c1'::uuid, 'ops@example.invalid'),
  ('b1000000-0000-0000-0000-00000000000a'::uuid, 'artist-a@example.invalid'),
  ('b1000000-0000-0000-0000-00000000000b'::uuid, 'artist-b@example.invalid');

insert into public.profiles (id, username) values
  ('b1000000-0000-0000-0000-0000000000c1'::uuid, 'opsperson'),
  ('b1000000-0000-0000-0000-00000000000a'::uuid, 'artista'),
  ('b1000000-0000-0000-0000-00000000000b'::uuid, 'artistb');

insert into public.ops_users (user_id) values ('b1000000-0000-0000-0000-0000000000c1'::uuid);

-- ── Rule 2: the ordering is structurally unreachable ────────────────────────
--
-- Deny-all is the whole mechanism. RLS is row-level, so no policy can let a client read
-- its own badge row WITHOUT also handing over that row's ordinal and awarded_at.
select pg_temp.assert(
  'profile_badges has RLS enabled',
  (select relrowsecurity from pg_class where oid = 'public.profile_badges'::regclass), true);

select pg_temp.assert(
  'profile_badges has NO policies — a policy here would publish award order',
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profile_badges'), false);

-- The reader returns exactly two columns. A third — ordinal, awarded_at, anything — would
-- be the leak, and would not break a single screen.
select pg_temp.assert(
  'badges_for_profiles returns exactly two columns',
  (select count(*) = 2
     from pg_proc p, lateral unnest(p.proargmodes) m
    where p.oid = 'public.badges_for_profiles(uuid[])'::regprocedure
      and m = 't'), true);

select pg_temp.assert(
  'and neither of them can be used to order the awards',
  (select bool_and(p.proargnames[i] not in ('ordinal', 'awarded_at', 'revoked_at', 'id'))
     from pg_proc p, lateral generate_subscripts(p.proargmodes, 1) i
    where p.oid = 'public.badges_for_profiles(uuid[])'::regprocedure
      and p.proargmodes[i] = 't'), true);

select pg_temp.assert(
  'anon cannot execute badges_for_profiles',
  has_function_privilege('anon', 'public.badges_for_profiles(uuid[])', 'execute'), false);
select pg_temp.assert(
  'anon cannot execute grant_badge',
  has_function_privilege('anon', 'public.grant_badge(uuid, text)', 'execute'), false);
select pg_temp.assert(
  'anon cannot execute badge_status',
  has_function_privilege('anon', 'public.badge_status(text)', 'execute'), false);

-- Catalog assertions say there are no policies; this says what that MEANS to a client.
-- CI grants `all on all tables ... to authenticated`, so RLS is the only thing standing
-- here — exactly the production shape, and nothing else in this file exercised it.
select pg_temp.set_user('b1000000-0000-0000-0000-00000000000a'::uuid);
set local role authenticated;
select pg_temp.assert(
  'a signed-in client reads NOTHING from profile_badges directly',
  (select count(*) = 0 from public.profile_badges), true);
select pg_temp.assert(
  'and nothing from badge_kinds either — slot_limit is scarcity information',
  (select count(*) = 0 from public.badge_kinds), true);

-- READS WERE COVERED; WRITES WERE NOT. CI grants authenticated INSERT/UPDATE/DELETE on
-- every table, so RLS is the only thing standing here — and "a signed-in user cannot grant
-- themselves First 100" is the one sentence an operator would most want pinned.
select pg_temp.assert(
  'a signed-in client cannot insert themselves a badge',
  pg_temp.raises($$insert into public.profile_badges (user_id, badge, ordinal)
                   values ('b1000000-0000-0000-0000-00000000000a'::uuid, 'first_100', 1)$$,
                 'row-level security'), true);
select pg_temp.assert(
  'nor invent a badge kind to grant themselves',
  pg_temp.raises($$insert into public.badge_kinds (badge, slot_limit) values ('mine', null)$$,
                 'row-level security'), true);

-- These two do not raise — RLS makes the rows invisible, so the statement succeeds and
-- affects nothing. Asserted on the effect, which is what the caller actually experiences.
update public.badge_kinds set slot_limit = 999 where badge = 'first_100';
delete from public.profile_badges;
reset role;

select pg_temp.assert(
  'a client UPDATE of badge_kinds silently matches nothing',
  (select slot_limit = 100 from public.badge_kinds where badge = 'first_100'), true);

-- ── Who may grant ───────────────────────────────────────────────────────────
select pg_temp.set_user('b1000000-0000-0000-0000-00000000000a'::uuid);
select pg_temp.assert(
  'an ordinary user cannot grant themselves the badge',
  pg_temp.raises($$select public.grant_badge('b1000000-0000-0000-0000-00000000000a'::uuid, 'first_100')$$,
                 'not_authorized'), true);

-- A write RAISES for a non-ops caller rather than no-opping: an operator who believes they
-- actioned something and did not is worse off than one who sees an error.
select pg_temp.assert(
  'an ordinary user cannot revoke somebody else''s badge',
  pg_temp.raises($$select public.revoke_badge('b1000000-0000-0000-0000-00000000000b'::uuid, 'first_100')$$,
                 'not_authorized'), true);

-- The read side stays quiet instead, matching every other ops read — which is why
-- /studio/ops needs no route guard.
select pg_temp.assert(
  'badge_status is EMPTY for a non-ops caller, not an error',
  (select count(*) = 0 from public.badge_status('first_100')), true);

-- ── Granting ────────────────────────────────────────────────────────────────
select pg_temp.set_user('b1000000-0000-0000-0000-0000000000c1'::uuid);

select pg_temp.assert(
  'ops grants the badge',
  (select public.grant_badge('b1000000-0000-0000-0000-00000000000a'::uuid, 'first_100')) = 'granted', true);

select pg_temp.assert(
  'the badge is visible through the reader',
  (select count(*) = 1 from public.badges_for_profiles(array['b1000000-0000-0000-0000-00000000000a'::uuid])
    where badge = 'first_100'), true);

-- An operator double-clicking must not burn two of a hundred.
select pg_temp.assert(
  'granting twice is idempotent',
  (select public.grant_badge('b1000000-0000-0000-0000-00000000000a'::uuid, 'first_100')) = 'already', true);

select pg_temp.assert(
  'the second grant consumed no slot',
  (select granted_ever = 1 from public.badge_status('first_100')), true);

select pg_temp.assert(
  'granting to a profile that does not exist is refused',
  pg_temp.raises($$select public.grant_badge('b1000000-0000-0000-0000-0000000000ff'::uuid, 'first_100')$$,
                 'no_such_profile'), true);

-- ── Rule 3: a revoked slot does not come back ───────────────────────────────
select pg_temp.assert(
  'ops revokes the badge',
  (select public.revoke_badge('b1000000-0000-0000-0000-00000000000a'::uuid, 'first_100')) = 'revoked', true);

select pg_temp.assert(
  'the badge stops being visible',
  (select count(*) = 0 from public.badges_for_profiles(array['b1000000-0000-0000-0000-00000000000a'::uuid])), true);

-- CHANGED BY 20260920000000. Revoking is an operator undoing their own act, so the slot
-- goes back in the pool; only a departed holder keeps one spent. `granted_ever` still
-- counts the grant — the record survives, the slot does not.
select pg_temp.assert(
  'revoking RELEASES the slot, and the grant stays on the books',
  (select granted_ever = 1 and live = 0 and occupied = 0 and remaining = 100
     from public.badge_status('first_100')), true);

select pg_temp.assert(
  'revoking a badge nobody holds reports that, rather than failing',
  (select public.revoke_badge('b1000000-0000-0000-0000-00000000000b'::uuid, 'first_100')) = 'not_held', true);

-- ── Rule 3: a deleted account does not release its slot ─────────────────────
select pg_temp.assert(
  'ops grants to the second artist',
  (select public.grant_badge('b1000000-0000-0000-0000-00000000000b'::uuid, 'first_100')) = 'granted', true);

-- THE POINT OF 20260920000000, proved without adding a grant: artist-a held ordinal 1 and
-- was revoked, so the slot went back in the pool and artist-b must be handed that same
-- number. Under the old rule they would have got 2 and slot 1 would be dead forever.
select pg_temp.assert(
  'the revoked slot was REISSUED — the second artist gets number 1, not 2',
  (select pb.ordinal = 1 from public.profile_badges pb
    where pb.badge = 'first_100'
      and pb.user_id = 'b1000000-0000-0000-0000-00000000000b'::uuid
      and pb.revoked_at is null), true);

delete from auth.users where id = 'b1000000-0000-0000-0000-00000000000b'::uuid;

-- The row survives with no holder. Under ON DELETE CASCADE it would vanish, the count
-- would drop, and the next grant would quietly reuse the slot.
-- Ordinal 1, not 2: artist-a's revoked slot was released and REISSUED to artist-b above,
-- so the number that survives the deletion is the reused one. That it keeps its ordinal at
-- all is the point — an orphan still occupies a first_100 slot.
select pg_temp.assert(
  'the badge row survives the holder''s deletion, orphaned and still holding its slot',
  (select count(*) = 1 from public.profile_badges
    where badge = 'first_100' and ordinal = 1 and user_id is null), true);

-- THE ASYMMETRY, IN ONE ASSERTION. Two grants made: one revoked (slot returned), one whose
-- holder deleted their account (slot gone for good). So two grants ever, zero live, but
-- exactly ONE slot still occupied — and 99 left, not 98 and not 100.
select pg_temp.assert(
  'a revoked slot came back; a deleted holder''s did not',
  (select granted_ever = 2 and live = 0 and occupied = 1 and remaining = 99
     from public.badge_status('first_100')), true);

-- The reader's own guard, pinned structurally. Asserting this behaviourally is not
-- possible from here: user_id is NULL, so `= any(...)` can never match and the assertion
-- would pass with the guard deleted. Checking the definition is weaker than a behavioural
-- test but it is not a test that cannot fail.
select pg_temp.assert(
  'badges_for_profiles still excludes orphaned rows explicitly',
  pg_get_functiondef('public.badges_for_profiles(uuid[])'::regprocedure)
    like '%user_id is not null%', true);

-- ── Rule 2 again: the ORDER of the rows must not be the order of the awards ─
--
-- This is the assertion that matters most, and the one the first version of this file
-- did not have. Withholding `ordinal` does not withhold the ranking: with no ORDER BY
-- the reader is planned as a sequential scan, which returns rows in physical heap order
-- — and on an append-only table that IS award order. Any signed-in client can enumerate
-- every profile (profiles_select_authenticated is `using (true)`), pass the lot to this
-- function, and read the ranking off the position of each row.
--
-- Three accounts whose uuids sort d1 < d2 < d3, granted in the OPPOSITE order. The reader
-- must return them by uuid. Drop the ORDER BY and it returns them d3, d2, d1 — the order
-- they were awarded — and this assertion goes red.
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-0000000000d1'::uuid, 'ord-1@example.invalid'),
  ('b1000000-0000-0000-0000-0000000000d2'::uuid, 'ord-2@example.invalid'),
  ('b1000000-0000-0000-0000-0000000000d3'::uuid, 'ord-3@example.invalid');
insert into public.profiles (id, username) values
  ('b1000000-0000-0000-0000-0000000000d1'::uuid, 'ordone'),
  ('b1000000-0000-0000-0000-0000000000d2'::uuid, 'ordtwo'),
  ('b1000000-0000-0000-0000-0000000000d3'::uuid, 'ordthree');

select public.grant_badge('b1000000-0000-0000-0000-0000000000d3'::uuid, 'first_100');
select public.grant_badge('b1000000-0000-0000-0000-0000000000d2'::uuid, 'first_100');
select public.grant_badge('b1000000-0000-0000-0000-0000000000d1'::uuid, 'first_100');

select pg_temp.assert(
  'they really were awarded newest-uuid-first, so award order is the reverse of uuid order',
  (select array_agg(pb.user_id order by pb.ordinal) = array[
     'b1000000-0000-0000-0000-0000000000d3'::uuid,
     'b1000000-0000-0000-0000-0000000000d2'::uuid,
     'b1000000-0000-0000-0000-0000000000d1'::uuid]
     from public.profile_badges pb
    where pb.user_id in ('b1000000-0000-0000-0000-0000000000d1'::uuid,
                         'b1000000-0000-0000-0000-0000000000d2'::uuid,
                         'b1000000-0000-0000-0000-0000000000d3'::uuid)), true);

-- The argument is deliberately passed in award order: if the array drove the output this
-- would pass for the wrong reason. It does not — the scan does — so the reader must
-- still hand back uuid order.
select pg_temp.assert(
  'the reader does NOT return rows in award order',
  (select array_agg(b.user_id) = array[
     'b1000000-0000-0000-0000-0000000000d1'::uuid,
     'b1000000-0000-0000-0000-0000000000d2'::uuid,
     'b1000000-0000-0000-0000-0000000000d3'::uuid]
     from public.badges_for_profiles(array[
       'b1000000-0000-0000-0000-0000000000d3'::uuid,
       'b1000000-0000-0000-0000-0000000000d2'::uuid,
       'b1000000-0000-0000-0000-0000000000d1'::uuid]) b), true);

-- ── Rule 1: the cap holds ───────────────────────────────────────────────────
--
-- Fill the remaining 95 slots, then ask for one more. Inserted directly rather than via
-- 95 grant calls: what is under test is the cap, not the loop.
-- 1 occupied (the orphan) + 3 live from the ordering block = 4 occupied, so 96 to fill.
-- Inserted with a NULL user_id, which under reclaim_on_delete = false still occupies.
insert into public.profile_badges (user_id, badge, ordinal)
  select null, 'first_100', g from generate_series(5, 100) g;

select pg_temp.assert(
  'all 100 slots are now spent',
  (select occupied = 100 and remaining = 0 from public.badge_status('first_100')), true);

select pg_temp.assert(
  'the 101st grant is refused',
  (select public.grant_badge('b1000000-0000-0000-0000-00000000000a'::uuid, 'first_100')) = 'full', true);

-- 101 ROWS, 100 SLOTS. The extra row is artist-a's revoked grant: kept for its audit trail,
-- holding no slot. Counting rows would now be counting the wrong thing — occupancy is what
-- the cap governs.
select pg_temp.assert(
  'and it wrote nothing — still exactly 100 slots held',
  (select occupied = 100 from public.badge_status('first_100')), true);
select pg_temp.assert(
  'the refused grant added no row either',
  (select count(*) = 101 from public.profile_badges where badge = 'first_100'), true);

-- The unique index is the backstop if the count check is ever edited away: two grants can
-- race on the count, but they cannot both land on the same ordinal.
select pg_temp.assert(
  'an ordinal cannot be reused',
  pg_temp.raises($$insert into public.profile_badges (user_id, badge, ordinal)
                   values (null, 'first_100', 100)$$, 'profile_badges_badge_ordinal_key'), true);

-- ── The other two slot policies ─────────────────────────────────────────────
--
-- first_100 is capped and permanent. The generic grant path has two more branches, and
-- "verified" / "top 10 artist" are the badges already named for them, so neither is
-- speculative. Both are exercised through the public functions.
insert into public.badge_kinds (badge, slot_limit, reclaim_on_revoke, reclaim_on_delete) values
  ('test_uncapped',    null, false, false),
  -- Reclaims BOTH ways — a genuine rotating badge, and the opposite corner from first_100,
  -- which reclaims on revoke only.
  ('test_rotating',       2,  true,  true);

select pg_temp.set_user('b1000000-0000-0000-0000-0000000000c1'::uuid);

-- UNCAPPED: no slots, so no ordinal and never 'full'. A "verified" badge has no such
-- thing as verified #7, and forcing one would be inventing a rank the product does not have.
select pg_temp.assert(
  'an uncapped badge grants',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d1'::uuid, 'test_uncapped')) = 'granted', true);
select pg_temp.assert(
  'and consumes no slot number',
  (select count(*) = 1 from public.profile_badges
    where badge = 'test_uncapped' and ordinal is null), true);
select pg_temp.assert(
  'a second holder is fine — uncapped means uncapped',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d2'::uuid, 'test_uncapped')) = 'granted', true);
select pg_temp.assert(
  'and its remaining count is NULL, not zero',
  (select slot_limit is null and remaining is null and live = 2
     from public.badge_status('test_uncapped')), true);

-- ROTATING: the OPPOSITE of rule 3, and the reason that rule could not stay hardcoded.
-- A top-10 badge that burned its slots would stop working after ten people, forever.
select pg_temp.assert(
  'a rotating badge fills its two slots',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d1'::uuid, 'test_rotating')) = 'granted'
   and (select public.grant_badge('b1000000-0000-0000-0000-0000000000d2'::uuid, 'test_rotating')) = 'granted', true);
select pg_temp.assert(
  'and then refuses a third while both are held',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d3'::uuid, 'test_rotating')) = 'full', true);

select pg_temp.assert(
  'revoking one frees the slot — this is what first_100 must NEVER do',
  (select public.revoke_badge('b1000000-0000-0000-0000-0000000000d1'::uuid, 'test_rotating')) = 'revoked', true);
select pg_temp.assert(
  'so the third holder now fits',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d3'::uuid, 'test_rotating')) = 'granted', true);
select pg_temp.assert(
  'still exactly two live, and none remaining',
  (select live = 2 and remaining = 0 from public.badge_status('test_rotating')), true);

-- The freed ordinal is REUSED rather than left as a hole, or a rotating badge would run out
-- of numbers after slot_limit rotations even though slots were free.
select pg_temp.assert(
  'the reused slot keeps the numbering inside the cap',
  (select max(ordinal) <= 2 from public.profile_badges
    where badge = 'test_rotating' and revoked_at is null), true);

-- A LIVE ROW WITH A NULL ORDINAL on a capped badge — the state that makes `NOT IN` see a
-- NULL, so min() returns NULL and a grant inserts a NULL ordinal for a capped badge,
-- succeeding rather than failing and quietly ending the slot bookkeeping.
--
-- THE ASSERTION IMMEDIATELY BELOW DOES NOT TEST THAT, and the comment here used to claim it
-- did. This row pushes the live count to 3 on a cap of 2, so grant_badge returns 'full' at
-- the cap check and never reaches the NOT IN at all — it returns 'full' under the mutation
-- too. The fixture is load-bearing for what follows; the coverage is the three-statement
-- block further down, which is what actually kills the missing-filter mutant.
insert into public.profile_badges (user_id, badge, ordinal)
values ('b1000000-0000-0000-0000-00000000000a'::uuid, 'test_rotating', null);

-- `…000b` would be the obvious choice and is NOT usable: its auth row is deleted above and
-- profiles_id_fkey cascades, so grant_badge raises no_such_profile and ON_ERROR_STOP takes
-- the whole file down. `…d1` is revoked but still exists.
select pg_temp.assert(
  'a live NULL-ordinal row does not poison the next slot assignment',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d1'::uuid, 'test_rotating')) = 'full', true);

delete from public.profile_badges
 where badge = 'test_rotating' and user_id = 'b1000000-0000-0000-0000-00000000000a'::uuid
   and ordinal is null;

-- Revoking frees a slot, and the grant that follows must get a REAL ordinal. This is the
-- only assertion in the file that kills the missing-`ordinal is not null` mutant.
--
-- THREE STATEMENTS, NOT ONE. Folded together, the read-back runs in the same statement as
-- the grant and therefore against that statement's own snapshot — the row grant_badge just
-- inserted is invisible, the subquery yields no rows, and the whole expression collapses to
-- NULL. It does not fail loudly; it can simply never pass.
select pg_temp.assert(
  'freeing a slot for the third time',
  (select public.revoke_badge('b1000000-0000-0000-0000-0000000000d2'::uuid, 'test_rotating')) = 'revoked', true);

select pg_temp.assert(
  'and granting into it',
  (select public.grant_badge('b1000000-0000-0000-0000-00000000000a'::uuid, 'test_rotating')) = 'granted', true);

select pg_temp.assert(
  'assigns a REAL ordinal inside the cap, not a null one',
  (select pb.ordinal is not null and pb.ordinal between 1 and 2
     from public.profile_badges pb
    where pb.badge = 'test_rotating' and pb.revoked_at is null
      and pb.user_id = 'b1000000-0000-0000-0000-00000000000a'::uuid), true);

-- Soft free, not delete: the revoked grant is still on the books with its audit trail.
select pg_temp.assert(
  'a rotating badge keeps its revoked grants — only the slot number is released',
  -- Two by now: d1 revoked earlier, d2 revoked just above. Both kept, both slot-freed.
  (select count(*) = 2 from public.profile_badges pb
    where pb.badge = 'test_rotating' and pb.revoked_at is not null
      and pb.ordinal is null and pb.revoked_by is not null), true);

-- MUTANT COVERAGE THE SOFT FREE TOOK AWAY. Under the old destructive DELETE, a sweep that
-- lost `badge = p_badge` wiped other badges' rows outright and first_100's granted_ever
-- collapsed, so the count assertion caught it. Nulling ordinals instead is invisible to a
-- count — first_100's occupied grants are counted regardless of ordinal. The
-- damage is real though: the permanent branch assigns `max(ordinal) + 1`, so nulled
-- ordinals make it hand out numbers that are already spent.
-- Not "no null ordinals" any more: since 20260920000000 a REVOKED first_100 grant releases
-- its number, so nulls are expected there. The invariant is that a grant still OCCUPYING a
-- slot keeps its number — and a sweep that lost `badge = p_badge` would null exactly those,
-- because first_100's orphans do not occupy under test_rotating's flags.
select pg_temp.assert(
  'a rotating grant did not null the ordinal of any OCCUPYING first_100 grant',
  (select count(*) = 0
     from public.profile_badges pb
     join public.badge_kinds bk on bk.badge = pb.badge
    where pb.badge = 'first_100'
      and public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, bk.reclaim_on_revoke, bk.reclaim_on_delete)
      and pb.ordinal is null), true);

-- And the sweep must free only DEAD rows. Freeing live ones leaves live holders of a capped
-- badge with no slot number — the exact poison the NOT IN filter above defends against.
select pg_temp.assert(
  'every grant occupying a capped slot still has its slot number',
  (select count(*) = 0 from public.profile_badges pb
     join public.badge_kinds bk on bk.badge = pb.badge
    where bk.slot_limit is not null
      and public.badge_grant_occupies_slot(pb.revoked_at, pb.user_id, bk.reclaim_on_revoke, bk.reclaim_on_delete)
      and pb.ordinal is null), true);

-- THE MIRROR OF THE first_100 DELETION ABOVE. There, deleting an account proves the slot
-- stays spent. Here it must prove the opposite: a rotating badge reclaims from a holder who
-- deleted their account, or it leaks capacity until it silently stops granting. `on delete
-- set null` makes an orphaned-but-not-revoked grant the NORMAL path, not an exotic one.
delete from auth.users where id = 'b1000000-0000-0000-0000-0000000000d3'::uuid;

select pg_temp.assert(
  'a departed holder frees a ROTATING slot — first_100 is the opposite',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000d2'::uuid, 'test_rotating')) = 'granted', true);

-- The policy flip that would sweep a permanent badge's ledger on the next grant.
-- The flip that would retroactively hand back slots spent by people who deleted their
-- accounts — the one promise in this design that cannot be un-broken, since those holders
-- cannot be asked.
select pg_temp.assert(
  'first_100 cannot be made to reclaim on delete after the fact',
  pg_temp.raises($$update public.badge_kinds set reclaim_on_delete = true where badge = 'first_100'$$,
                 'cannot be consulted'), true);

-- AND THE OTHER DIRECTION, which the first version of this file waved through as harmless.
-- It is not: turning reclaim_on_revoke OFF re-promotes grants whose ordinals the sweep
-- already nulled, so they become occupants holding no slot number and `occupied` climbs
-- past the cap. Measured at 101 occupied and -1 remaining on a cap of 100 — inside this
-- very file, between two assertions, with nothing looking.
select pg_temp.assert(
  'reclaim rules cannot be changed at all once grants exist',
  pg_temp.raises($$update public.badge_kinds set reclaim_on_revoke = false where badge = 'first_100'$$,
                 'grant(s) already exist'), true);

-- A badge nobody holds yet can still be configured freely — the guard is about grants
-- already numbered under the old rules, not about the columns being frozen.
insert into public.badge_kinds (badge, slot_limit, reclaim_on_revoke, reclaim_on_delete)
values ('test_unused', 5, false, false);
select pg_temp.assert(
  'but a badge with no grants can still be reconfigured',
  pg_temp.raises($$update public.badge_kinds set reclaim_on_revoke = true where badge = 'test_unused'$$,
                 'grant(s) already exist'), false);

-- A departed holder's slot cannot be handed back by hand either. revoke_badge already
-- cannot reach these rows; this is the table-level half of the same promise.
select pg_temp.assert(
  'an orphaned grant cannot be revoked by a direct UPDATE',
  pg_temp.raises($$update public.profile_badges set revoked_at = now()
                    where badge = 'first_100' and user_id is null and revoked_at is null$$,
                 'holder deleted their account'), true);

-- first_100 is unaffected by any of that — the branches are per badge, not global.
select pg_temp.assert(
  'first_100 slots stayed spent throughout',
  (select occupied = 100 and remaining = 0 from public.badge_status('first_100')), true);

select pg_temp.assert(
  'granting a badge that does not exist is refused',
  pg_temp.raises($$select public.grant_badge('b1000000-0000-0000-0000-0000000000d1'::uuid, 'nope')$$,
                 'no_such_badge'), true);

-- An uncapped badge must not be able to claim reclaimable slots — there are none to reclaim,
-- and a setting that reads as if it did something is worse than no setting.
-- BOTH conjuncts of the constraint, not just the first. Asserting only reclaim_on_revoke
-- left the reclaim_on_delete half unexercised, so dropping it from the CHECK survived.
select pg_temp.assert(
  'an uncapped badge cannot reclaim on revoke — there are no slots to reclaim',
  pg_temp.raises($$insert into public.badge_kinds (badge, slot_limit, reclaim_on_revoke)
                   values ('test_bad_a', null, true)$$, 'badge_kinds_reclaim_needs_a_cap'), true);
select pg_temp.assert(
  'nor on delete',
  pg_temp.raises($$insert into public.badge_kinds (badge, slot_limit, reclaim_on_delete)
                   values ('test_bad_b', null, true)$$, 'badge_kinds_reclaim_needs_a_cap'), true);

-- ── The guards, and the two states nothing reached ──────────────────────────
--
-- Appended at the END deliberately: everything below adds grants under NEW badges, so no
-- assertion above it moves. Getting that wrong is how this file broke twice.
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-0000000000e1'::uuid, 'sweep@example.invalid'),
  ('b1000000-0000-0000-0000-0000000000e2'::uuid, 'dormant@example.invalid');
insert into public.profiles (id, username) values
  ('b1000000-0000-0000-0000-0000000000e1'::uuid, 'sweepuser'),
  ('b1000000-0000-0000-0000-0000000000e2'::uuid, 'dormantuser');

-- (a) A SWEEP OVER A REVOKED-THEN-ORPHANED GRANT. The `old.revoked_at is null` clause in
-- the orphan trigger looks defensive and is not: the sweep updates exactly these rows, so
-- without that clause the trigger fires on its own maintenance and granting the badge
-- becomes IMPOSSIBLE. Nothing reached this state, because it needs a revoke followed by an
-- account deletion, in that order, with the ordinal still attached.
insert into public.badge_kinds (badge, slot_limit, reclaim_on_revoke, reclaim_on_delete)
values ('test_sweep', 2, true, true);

select pg_temp.assert(
  'grant, then revoke — the row keeps its ordinal until the next sweep',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000e1'::uuid, 'test_sweep')) = 'granted'
   and (select public.revoke_badge('b1000000-0000-0000-0000-0000000000e1'::uuid, 'test_sweep')) = 'revoked', true);

select pg_temp.assert(
  'and it is still numbered, so the sweep will have to touch it',
  (select count(*) = 1 from public.profile_badges
    where badge = 'test_sweep' and revoked_at is not null and ordinal is not null), true);

-- Orphan it AFTER the revoke. The FK action sets user_id to NULL; the trigger reads
-- old.user_id, which is still non-null at that moment, so the deletion itself is fine.
delete from auth.users where id = 'b1000000-0000-0000-0000-0000000000e1'::uuid;

select pg_temp.assert(
  'granting still works with a revoked-and-orphaned grant in the way',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000e2'::uuid, 'test_sweep')) = 'granted', true);

-- (b) A RECLAIM FLIP ON A BADGE WITH GRANTS BUT NONE LIVE. This is the state the guard
-- exists for — swept ordinals with nobody holding them — and the one the file never built.
-- Counting only LIVE grants would let this through.
insert into public.badge_kinds (badge, slot_limit, reclaim_on_revoke, reclaim_on_delete)
values ('test_dormant', 2, true, false);

select pg_temp.assert(
  'a badge whose only grant has been revoked still has a grant',
  (select public.grant_badge('b1000000-0000-0000-0000-0000000000e2'::uuid, 'test_dormant')) = 'granted'
   and (select public.revoke_badge('b1000000-0000-0000-0000-0000000000e2'::uuid, 'test_dormant')) = 'revoked', true);

select pg_temp.assert(
  'and its reclaim rules are frozen even with nothing live',
  pg_temp.raises($$update public.badge_kinds set reclaim_on_revoke = false where badge = 'test_dormant'$$,
                 'grant(s) already exist'), true);

-- (c) The two routes around the orphan trigger that stamping alone left open.
-- ONE ROW, scoped by ordinal. Re-attaching every orphan to the same account would trip the
-- live-holder unique index first, so with the guard removed this would still "fail" — for
-- the wrong reason, which is the shape of a test that cannot tell you anything.
select pg_temp.assert(
  'an orphaned grant cannot be re-attached to a live account',
  pg_temp.raises($$update public.profile_badges
                      set user_id = 'b1000000-0000-0000-0000-0000000000e2'::uuid
                    where badge = 'first_100' and user_id is null and ordinal = 1$$,
                 'refusing to re-attach'), true);

select pg_temp.assert(
  'nor simply deleted',
  pg_temp.raises($$delete from public.profile_badges
                    where badge = 'first_100' and user_id is null$$,
                 'refusing to delete'), true);

select pg_temp.assert(
  'and the table cannot be truncated past the row guards',
  pg_temp.raises($$truncate public.profile_badges$$, 'refusing to truncate'), true);

select pg_temp.assert(
  'while a grant that still has a holder can be deleted normally',
  pg_temp.raises($$delete from public.profile_badges
                    where badge = 'test_dormant'
                      and user_id = 'b1000000-0000-0000-0000-0000000000e2'::uuid$$,
                 'refusing to delete'), false);

rollback;
