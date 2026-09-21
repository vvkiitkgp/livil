-- The verified badge, and the notice the holder gets.
--
-- Two properties, both of which fail quietly:
--
--   1. VERIFIED IS UNCAPPED. Unlimited holders, no slot numbers, and a NULL remaining count
--      rather than zero — "0 slots left" would be a lie about a badge that has none. If it
--      ever acquired a cap by accident, granting would start refusing at a number nobody
--      chose.
--   2. THE HOLDER IS TOLD, BY LIVIL. An actor-less activity row, the same shape as
--      play_milestone, so the client renders it as Livil speaking and the operator who
--      granted it is not disclosed. And the notice is FAIL-SAFE: it must never be able to
--      roll back the grant it describes.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/badge-verified-and-notice.test.sql

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.assert(label text, actual boolean, expected boolean)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %  (expected %, got %)', label, expected, actual;
  end if;
  raise notice 'ok    %', label;
end $$;

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
  discard plans;
end $$;

create or replace function pg_temp.raises(stmt text, expected text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception
  when others then
    if position(expected in sqlerrm) > 0 then return true; end if;
    raise exception 'raised the WRONG error: expected %, got %', expected, sqlerrm;
end $$;

grant usage on schema auth to authenticated;

insert into auth.users (id, email) values
  ('d3000000-0000-0000-0000-0000000000c1'::uuid, 'ops-v@example.invalid'),
  ('d3000000-0000-0000-0000-00000000000a'::uuid, 'artist-v1@example.invalid'),
  ('d3000000-0000-0000-0000-00000000000b'::uuid, 'artist-v2@example.invalid');
insert into public.profiles (id, username) values
  ('d3000000-0000-0000-0000-0000000000c1'::uuid, 'opsv'),
  ('d3000000-0000-0000-0000-00000000000a'::uuid, 'artistv1'),
  ('d3000000-0000-0000-0000-00000000000b'::uuid, 'artistv2');
insert into public.ops_users (user_id) values ('d3000000-0000-0000-0000-0000000000c1'::uuid);

select pg_temp.set_user('d3000000-0000-0000-0000-0000000000c1'::uuid);

-- ── Uncapped ────────────────────────────────────────────────────────────────
select pg_temp.assert(
  'verified is registered with no cap and no reclaim',
  (select slot_limit is null and reclaim_on_revoke = false and reclaim_on_delete = false
     from public.badge_kinds where badge = 'verified'), true);

select pg_temp.assert(
  'granting verified works',
  (select public.grant_badge('d3000000-0000-0000-0000-00000000000a'::uuid, 'verified')) = 'granted', true);

select pg_temp.assert(
  'and consumes no slot number — there is no such thing as verified #7',
  (select ordinal is null from public.profile_badges
    where badge = 'verified' and user_id = 'd3000000-0000-0000-0000-00000000000a'::uuid), true);

select pg_temp.assert(
  'a second holder is fine',
  (select public.grant_badge('d3000000-0000-0000-0000-00000000000b'::uuid, 'verified')) = 'granted', true);

-- NULL, not 0. A zero here would read as "none left" on a badge that cannot run out.
select pg_temp.assert(
  'remaining is NULL for an uncapped badge, and never zero',
  (select slot_limit is null and remaining is null and live = 2
     from public.badge_status('verified')), true);

select pg_temp.assert(
  'revoking verified frees nothing because there was nothing to free',
  (select public.revoke_badge('d3000000-0000-0000-0000-00000000000b'::uuid, 'verified')) = 'revoked', true);
select pg_temp.assert(
  'and the count simply drops',
  (select live = 1 and remaining is null from public.badge_status('verified')), true);

-- ── Both badges at once ─────────────────────────────────────────────────────
-- The rail was built to stack them; the reader must actually return both.
select pg_temp.assert(
  'the same person can hold First 100 and verified together',
  (select public.grant_badge('d3000000-0000-0000-0000-00000000000a'::uuid, 'first_100')) = 'granted', true);

select pg_temp.assert(
  'and the reader returns both for them',
  (select count(*) = 2 from public.badges_for_profiles(array['d3000000-0000-0000-0000-00000000000a'::uuid])), true);

-- ── The notice ──────────────────────────────────────────────────────────────
select pg_temp.assert(
  'each grant wrote exactly one notice to the holder',
  (select count(*) = 2 from public.activity_notifications
    where recipient_id = 'd3000000-0000-0000-0000-00000000000a'::uuid
      and type = 'badge_granted'), true);

-- NO ACTOR. This is the property that keeps the granting operator out of the recipient's
-- inbox; awarded_by on the badge row is where that lives, ops-only.
select pg_temp.assert(
  'the notice names no actor — it is Livil speaking, not a staff account',
  (select bool_and(actor_id is null) from public.activity_notifications
    where recipient_id = 'd3000000-0000-0000-0000-00000000000a'::uuid
      and type = 'badge_granted'), true);

select pg_temp.assert(
  'and it says which badge, so the client can render the right copy',
  (select array_agg(payload->>'badge' order by payload->>'badge') = array['first_100','verified']
     from public.activity_notifications
    where recipient_id = 'd3000000-0000-0000-0000-00000000000a'::uuid
      and type = 'badge_granted'), true);

-- Re-granting is an operator clicking twice. It must not notify again.
select pg_temp.assert(
  're-granting returns already',
  (select public.grant_badge('d3000000-0000-0000-0000-00000000000a'::uuid, 'verified')) = 'already', true);
select pg_temp.assert(
  'and sends no second notice',
  (select count(*) = 2 from public.activity_notifications
    where recipient_id = 'd3000000-0000-0000-0000-00000000000a'::uuid
      and type = 'badge_granted'), true);

-- A refused grant is not news either.
select pg_temp.assert(
  'a grant refused for a missing profile notifies nobody',
  pg_temp.raises($$select public.grant_badge('d3000000-0000-0000-0000-0000000000ff'::uuid, 'verified')$$,
                 'no_such_profile'), true);
-- SCOPED TO ONE RECIPIENT. Counting every badge_granted row sees artistv2's notice as well
-- and expects 2 where there are 3 — an assertion that fails on correct code.
select pg_temp.assert(
  'still two notices for this artist',
  (select count(*) = 2 from public.activity_notifications
    where recipient_id = 'd3000000-0000-0000-0000-00000000000a'::uuid
      and type = 'badge_granted'), true);

-- Revoking is deliberately silent: being told you lost something is a product decision
-- nobody has made, and guessing at it in a migration is how features acquire opinions.
select pg_temp.assert(
  'revoking sends no notice',
  (select public.revoke_badge('d3000000-0000-0000-0000-00000000000a'::uuid, 'verified')) = 'revoked'
   and (select count(*) = 2 from public.activity_notifications
         where recipient_id = 'd3000000-0000-0000-0000-00000000000a'::uuid
           and type = 'badge_granted'), true);

-- ── FAIL-SAFE, which is the whole reason notify_badge_granted is its own function ──
--
-- Break the notification at the constraint level, then grant. The badge must still land.
-- Without the exception handler the insert would abort the grant, and the dashboard would
-- have reported success for a badge nobody holds.
alter table public.activity_notifications
  drop constraint if exists activity_notifications_type_check;
-- NOT VALID is what makes this work. A plain ADD CONSTRAINT validates the rows already in
-- the table — three badge_granted notices exist by now — so it raises immediately and the
-- transaction dies before reaching the grant below. The suite then fails HERE, at a
-- confusing place, with assertions 18-20 never run — a red build that looks like a
-- constraint problem rather than a missing test. (Measured: exit 3, 17 ok, no warning.)
-- NOT VALID applies the constraint to NEW rows only, which is exactly the trap we want.
alter table public.activity_notifications
  add constraint activity_notifications_type_check check (type <> 'badge_granted') not valid;

select pg_temp.assert(
  'a grant still succeeds when the notice cannot be written',
  (select public.grant_badge('d3000000-0000-0000-0000-00000000000b'::uuid, 'first_100')) = 'granted', true);

select pg_temp.assert(
  'and the badge is really there',
  (select count(*) = 1 from public.badges_for_profiles(array['d3000000-0000-0000-0000-00000000000b'::uuid])
    where badge = 'first_100'), true);

-- ── Who may write a notice ──────────────────────────────────────────────────
-- WEAK BY CONSTRUCTION, and recorded as such. Bare Postgres carries no Supabase default
-- privilege for anon, so `revoke all ... from public` alone already satisfies this —
-- deleting the anon revoke leaves it passing. The real control is
-- scripts/check-definer-anon-grants.mjs, which reads the migration text.
select pg_temp.assert(
  'anon cannot execute notify_badge_granted',
  has_function_privilege('anon', 'public.notify_badge_granted(uuid, text)', 'execute'), false);

-- THERE IS DELIBERATELY NO `authenticated` ASSERTION HERE. CI runs
-- `grant execute on all functions in schema public to authenticated` AFTER every migration
-- (ci.yml), so at this point the answer is `true` in CI and `false` in production — the
-- assertion would fail on correct code. The migration's own DO block checks it at apply
-- time, before any harness grant, and the text lint checks the revoke still exists. Those
-- are the coverage; a runtime check here would only be a check that cannot fail correctly.

rollback;
