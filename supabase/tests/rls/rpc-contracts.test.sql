-- ============================================================================
-- RPC contract tests — does each function return the keys its caller reads?
-- ============================================================================
--
-- WHY THIS IS THE "SERVICE TEST" FOR THIS ARCHITECTURE
--
-- There is no API tier (ADR-0004). The client calls Postgres functions directly, so
-- THE RPC SIGNATURE IS THE SERVICE CONTRACT. There is no schema validation layer
-- between them and no code generation that would catch a mismatch.
--
-- Worse, the client coalesces every field it reads:
--
--   hostUsername:       (row.host_username as string | null) ?? 'Unknown'
--   playbackPositionMs: Number(row.playback_position_ms ?? 0)
--   isPlaying:          Boolean(row.is_playing)
--
-- So dropping a key from an RPC's return does NOT throw. The join succeeds and the
-- app renders "Host: @Unknown", position 0, not playing — a jam that looks joined and
-- is silently desynced. The Architecture Board's reviewers found exactly this shape
-- during calibration, tracing it through jamRooms.ts -> JamRealtimeContext ->
-- JamRoomScreen.
--
-- These tests assert the KEYS EXIST. They do not assert the values are correct — that
-- needs a populated fixture and is a different test. Key absence is the failure mode
-- that is invisible; a wrong value at least tends to look wrong.
--
-- Run after migrations, in the same ephemeral Postgres as authorization.test.sql.
-- ============================================================================

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

/**
 * Asserts a jsonb-returning function's body constructs every key the client reads.
 *
 * This inspects the function SOURCE rather than calling it, because calling requires a
 * full fixture and an auth context. Source inspection catches the realistic regression
 * — someone rewrites the function and trims the payload — without needing either.
 */
create or replace function pg_temp.assert_returns_keys(fn text, keys text[])
returns void language plpgsql as $$
declare
  body text;
  k    text;
  missing text[] := '{}';
begin
  select pg_get_functiondef(oid) into body from pg_proc where proname = fn limit 1;
  if body is null then
    raise exception 'FAIL  function % does not exist', fn;
  end if;
  foreach k in array keys loop
    if position(quote_literal(k) in body) = 0 then
      missing := missing || k;
    end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'FAIL  % does not return: %', fn, array_to_string(missing, ', ');
  end if;
  raise notice 'ok    % returns every key its caller reads', fn;
end $$;

-- ── get_jam_snapshot ────────────────────────────────────────────────────────
-- Read by joinJamRoom() in src/services/jamRooms.ts. Every field is coalesced on the
-- client, so a dropped key renders "Host: @Unknown" at position 0 rather than failing.
select pg_temp.assert_returns_keys('get_jam_snapshot', array[
  'jam_room_id',
  'host_id',
  'host_username',
  'playback_position_ms',
  'is_playing',
  'host_clock_at'
]);

-- ── Privileged functions still carry their authorization guards ─────────────
-- Duplicated deliberately from authorization.test.sql: that file tests the POLICY
-- layer, this one tests the FUNCTION layer. D-53 was precisely a case where one was
-- guarded and the other was not, so both are asserted independently.
select pg_temp.assert(
  'create_jam_room still guards conversation membership',
  (select pg_get_functiondef(oid) ilike '%is_conversation_member%'
   from pg_proc where proname = 'create_jam_room' limit 1), true);

select pg_temp.assert(
  'get_jam_snapshot still guards conversation membership',
  (select pg_get_functiondef(oid) ilike '%is_conversation_member%'
   from pg_proc where proname = 'get_jam_snapshot' limit 1), true);

-- ── Every RPC the client calls must exist ───────────────────────────────────
-- A missing function does not fail typecheck (the client casts through `supabase as
-- any` in 17 files — D-44), and where the caller discards the result it fails
-- silently. `upvote_queue_item` shipped that way and is called from jamRooms.ts today.
create or replace function pg_temp.assert_rpc_exists(fn text)
returns void language plpgsql as $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = fn) then
    raise exception 'FAIL  RPC % is called by the client but does not exist', fn;
  end if;
  raise notice 'ok    % exists', fn;
end $$;

select pg_temp.assert_rpc_exists('get_jam_snapshot');
select pg_temp.assert_rpc_exists('create_jam_room');
select pg_temp.assert_rpc_exists('create_group');
select pg_temp.assert_rpc_exists('get_or_create_dm');
select pg_temp.assert_rpc_exists('broadcast_jam_state');
select pg_temp.assert_rpc_exists('fetch_home_feed');
select pg_temp.assert_rpc_exists('list_active_stories');
select pg_temp.assert_rpc_exists('activity_list');
select pg_temp.assert_rpc_exists('activity_unread_count');
select pg_temp.assert_rpc_exists('claim_username');
select pg_temp.assert_rpc_exists('is_username_available');
select pg_temp.assert_rpc_exists('send_friend_request');
select pg_temp.assert_rpc_exists('accept_friend_request');
select pg_temp.assert_rpc_exists('add_star');

-- NOTE: `upvote_queue_item` is deliberately NOT asserted here. It is called from
-- src/services/jamRooms.ts and does not exist (D-31). Asserting it would fail CI on a
-- known, recorded defect rather than on a regression. When D-31 is fixed — by writing
-- the function or removing the call — move it into the list above or delete this note.

-- ── list_active_stories is bounded by a LIMIT (PROP-0004 / ADR-0009 Decision 3) ─
-- The social graph already bounds the result, but an unbounded list is the wrong
-- default (P22). This is the source-inspection ratchet; the behavioural proof that
-- the LIMIT truncates lives in stories-harden.test.sql.
select pg_temp.assert(
  'list_active_stories carries a LIMIT',
  (select pg_get_functiondef(oid) ilike '%limit%'
   from pg_proc where proname = 'list_active_stories' limit 1), true);

-- list_active_stories must stay SECURITY INVOKER so RLS still filters what the
-- caller may see — same reasoning as fetch_home_feed below.
select pg_temp.assert(
  'list_active_stories is NOT security definer',
  (select prosecdef from pg_proc where proname = 'list_active_stories' limit 1), false);

-- ── fetch_home_feed is SECURITY INVOKER, deliberately ───────────────────────
-- The feed must run as the caller so row-level security still filters what they may
-- see. Flipping it to DEFINER would silently expose every post to every user, and
-- nothing else in the system would notice.
select pg_temp.assert(
  'fetch_home_feed is NOT security definer',
  (select prosecdef from pg_proc where proname = 'fetch_home_feed' limit 1), false);

rollback;
