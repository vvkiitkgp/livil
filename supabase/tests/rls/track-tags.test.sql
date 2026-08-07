-- Track tags — the shape of the column, and who may set it.
--
-- `tracks.tags` is the only column on the table that decides whether a stranger ever finds
-- the track. Two things can quietly break that, and neither shows up as an error:
--
--   1. A tag stored in a form the search box cannot rebuild — uppercase, spaced, hashed.
--      `searchPosts` matches by containment against a normalized term, so 'LoFi' in the
--      column is a tag that exists and can never be found. The constraint is what keeps the
--      writer and the reader speaking the same language when a client forgets to normalize.
--   2. Somebody tagging a track that is not theirs. Tags are a discovery surface, so an
--      open UPDATE would be a way to file another artist's track under any word at all.
--
-- These assert the properties, not the statements:
--   * the invariants search depends on hold: lowercase, no whitespace, no '#', bounded, unique
--   * "no tags" has exactly one representation — NULL, never '{}'
--   * the constraint stays LOOSER than the client normalizer, deliberately (see the migration)
--   * only the uploader writes tags; everyone signed in can read them
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/rls/track-tags.test.sql
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

create or replace function pg_temp.set_user(uid uuid)
returns void language plpgsql as $$
begin
  execute format('create or replace function auth.uid() returns uuid language sql stable as $f$ select %L::uuid $f$', uid);
end $$;

-- Reports whether the database accepted the statement. Both refusal shapes are caught and
-- reported the same way, because from the caller's side they are the same event: the write
-- did not happen. Everything else propagates, so a test cannot pass on an unrelated error.
create or replace function pg_temp.allows(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return true;
exception
  when insufficient_privilege then return false;
  when check_violation then return false;
end $$;

grant usage on schema auth to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('7a000000-0000-0000-0000-00000000000a'::uuid, 'owner@example.invalid'),
  ('7a000000-0000-0000-0000-00000000000b'::uuid, 'stranger@example.invalid');

insert into public.profiles (id, username) values
  ('7a000000-0000-0000-0000-00000000000a'::uuid, 'tagowner'),
  ('7a000000-0000-0000-0000-00000000000b'::uuid, 'tagstranger');

insert into public.tracks (id, uploader_id, title, media_kind, audio_url) values
  ('7a000000-0000-0000-0000-0000000000f1'::uuid,
   '7a000000-0000-0000-0000-00000000000a'::uuid,
   'Tagged', 'audio', 'https://example.invalid/a.mp3');

-- ── The shape of a stored tag ───────────────────────────────────────────────
--
-- Written as the table owner, so these measure the CHECK constraint alone. Whether the
-- uploader is allowed to write at all is a separate property, asserted further down —
-- mixing them would let an RLS denial pass as constraint enforcement.

select pg_temp.assert(
  'an ordinary lowercase tag list is accepted',
  pg_temp.allows($$update public.tracks set tags = array['lofi','late_night']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), true);

select pg_temp.assert(
  'NULL is how a track carries no tags',
  pg_temp.allows($$update public.tracks set tags = null
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), true);

-- One representation of "none". Two would mean every reader downstream has two cases, and
-- the one nobody tested is the one that ships.
select pg_temp.assert(
  'an empty array is not a second way to say "no tags"',
  pg_temp.allows($$update public.tracks set tags = array[]::text[]
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

-- Each of these is a tag that EXISTS and can never be FOUND: the search box normalizes the
-- typed query, so a stored tag that is not in normalized form matches nothing, forever.
select pg_temp.assert(
  'an uppercase tag is refused — search would never match it',
  pg_temp.allows($$update public.tracks set tags = array['LoFi']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

select pg_temp.assert(
  'a tag with a space is refused',
  pg_temp.allows($$update public.tracks set tags = array['late night']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

select pg_temp.assert(
  'a tag carrying its own hash is refused',
  pg_temp.allows($$update public.tracks set tags = array['#lofi']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

select pg_temp.assert(
  'a one-character tag is refused',
  pg_temp.allows($$update public.tracks set tags = array['a']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

select pg_temp.assert(
  'a tag longer than 30 characters is refused',
  pg_temp.allows($$update public.tracks set tags = array[repeat('a', 31)]
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

select pg_temp.assert(
  'a NULL element is refused — it is not a tag, and containment would read it wrong',
  pg_temp.allows($$update public.tracks set tags = array['lofi', null]
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

select pg_temp.assert(
  'the same tag twice is refused',
  pg_temp.allows($$update public.tracks set tags = array['lofi','lofi']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

-- Twenty, not ten: every upload starts with the ten EMOTION_TAGS already applied, so a
-- tighter cap would be spent before the artist typed anything of their own.
select pg_temp.assert(
  'twenty tags fit',
  pg_temp.allows($$update public.tracks
                      set tags = (select array_agg('t' || i) from generate_series(1, 20) i)
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), true);

select pg_temp.assert(
  'a twenty-first does not — the cap is what stops keyword stuffing',
  pg_temp.allows($$update public.tracks
                      set tags = (select array_agg('t' || i) from generate_series(1, 21) i)
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), false);

-- ── Looser than the client, on purpose ──────────────────────────────────────
--
-- The migration argues this at length: a constraint STRICTER than the normalizer rejects a
-- publish only after the master has uploaded, so anything cosmetic is left to the client.
-- These pin the deliberate gaps, so that tightening one is a decision somebody makes rather
-- than a side effect — each would need a validation pass over existing rows.
select pg_temp.assert(
  'a non-Latin tag is accepted — the app is not English-only',
  pg_temp.allows($$update public.tracks set tags = array['बॉलीवुड']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), true);

select pg_temp.assert(
  'punctuation the normalizer would have stripped still stores',
  pg_temp.allows($$update public.tracks set tags = array['lo-fi']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), true);

-- ── Who may write them ──────────────────────────────────────────────────────
select pg_temp.set_user('7a000000-0000-0000-0000-00000000000a'::uuid);
set local role authenticated;
select pg_temp.assert(
  'the uploader tags their own track',
  pg_temp.allows($$update public.tracks set tags = array['mine']
                    where id = '7a000000-0000-0000-0000-0000000000f1'$$), true);
reset role;

select pg_temp.set_user('7a000000-0000-0000-0000-00000000000b'::uuid);
set local role authenticated;
-- RLS makes the row invisible to the UPDATE rather than raising, so the assertion is on
-- the effect: a stranger's write matches nothing and the owner's tags are untouched.
update public.tracks set tags = array['stolen']
  where id = '7a000000-0000-0000-0000-0000000000f1';
reset role;

select pg_temp.assert(
  'a stranger cannot retag somebody else''s track',
  (select tags = array['mine'] from public.tracks
    where id = '7a000000-0000-0000-0000-0000000000f1'), true);

-- Readable by everyone signed in, which is what "searchable" means. Inherited from
-- `tracks_select_authenticated`; asserted because the feature depends on it and a future
-- narrowing of that policy would silently empty every tag search.
select pg_temp.set_user('7a000000-0000-0000-0000-00000000000b'::uuid);
set local role authenticated;
select pg_temp.assert(
  'anyone signed in can read a track''s tags',
  (select tags = array['mine'] from public.tracks
    where id = '7a000000-0000-0000-0000-0000000000f1'), true);

-- The query the product actually runs. Asserted here because an index or operator change
-- that broke containment would leave every other test in this file passing.
select pg_temp.assert(
  'containment finds the track by one of its tags',
  (select count(*) = 1 from public.tracks
    where tags && array['mine']), true);
reset role;

rollback;
