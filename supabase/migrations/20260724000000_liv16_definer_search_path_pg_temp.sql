-- ============================================================================
-- LIV-16 — harden every SECURITY DEFINER function against pg_temp relation-shadowing
-- ============================================================================
--
-- Forward-only. Defence-in-depth follow-up to LIV-11, which pinned
-- `search_path = public` on the DEFINER functions that had nothing pinned, and
-- explicitly deferred THIS ticket (see the SCOPE note in
-- supabase/tests/rls/definer-search-path.test.sql and the tail of
-- 20260723000000_liv11_dm_participant_guard_and_definer_search_path.sql).
--
-- ── THE RESIDUAL THREAT LIV-11 LEFT OPEN ────────────────────────────────────
--
-- `search_path = public` closes the SCHEMA-shadowing form (a caller can no longer
-- prepend a schema to the resolved path — the path is pinned). It does NOT close the
-- pg_temp RELATION-shadowing form: Postgres searches the session temp schema (pg_temp)
-- FIRST for table/view/sequence/type names whenever pg_temp is not itself listed in the
-- path, EVEN BEFORE pg_catalog. Creating relations in pg_temp needs only the database
-- TEMPORARY privilege, which is granted to PUBLIC on this project (verified in LIV-11:
-- has_database_privilege('authenticated'/'anon', current_database(), 'TEMP') = true).
--
-- So any authenticated (or anon) caller could, within their own session, create an
-- empty `pg_temp.<name>` that shadows a `public` table a DEFINER body reads unqualified,
-- and the function — running as its owner (postgres) — would read the attacker's
-- relation instead. Empirically reproduced on the current schema before writing this
-- migration: is_username_available('taken') returns false normally, but returns TRUE
-- after `create temp table profiles(username text)`, because the empty pg_temp relation
-- shadowed public.profiles inside the DEFINER function.
--
-- ── THE FIX, AND WHY THIS SHAPE ─────────────────────────────────────────────
--
-- The PostgreSQL manual's own remedy for exactly this ("Writing SECURITY DEFINER
-- Functions Safely"): "A secure arrangement can be obtained by forcing the temporary
-- schema to be searched last. To do this, write pg_temp as the last entry in
-- search_path." We do precisely that — APPEND `pg_temp` as the final entry to each
-- function's EXISTING path:
--
--   * every function currently pinned `public`        -> `public, pg_temp`
--   * get_email_for_username (pinned `public, auth`)  -> `public, auth, pg_temp`
--
-- This is strictly behaviour-neutral for legitimate calls: every schema a body resolves
-- against today (public, and auth for get_email_for_username) is still searched first,
-- in the same order; pg_temp is only consulted AFTER them, so it can no longer preempt a
-- real relation. The only behaviour that changes is the attack: a pg_temp shadow is now
-- searched last and cannot win.
--
-- WHY NOT `search_path = ''` (the mechanism named in the ticket title). `= ''` is the
-- stricter, belt-and-suspenders target — but it resolves NOTHING unqualified except
-- pg_catalog builtins, so it requires rewriting the body of all 41 functions to
-- schema-qualify every identifier. Postgres does not validate identifier references
-- inside a plpgsql body until the function is CALLED (this is the INC-0003 failure
-- class), and most of these functions have no behavioural test, so a single missed
-- qualification would apply cleanly, pass CI, and break in production on the RLS
-- perimeter. That is an unverifiable change. Appending `pg_temp` closes the SAME named
-- threat (pg_temp relation-shadowing), is the documented fix, and is verifiable. The
-- `= ''` + fully-qualified-identifiers standardisation is left as a PROPOSED follow-up;
-- the tightened lint below still ACCEPTS `= ''`, so it can be adopted per-function later
-- with no further lint change.
--
-- Idempotent / forward-safe: re-applying lands the same pinned value. Each ALTER names
-- the function by its exact identity signature (generated from pg_proc against the fully
-- replayed schema), so a signature that has since changed fails loudly here rather than
-- silently missing a function — and the tightened lint is the backstop for any miss.
-- ============================================================================

alter function public.accept_friend_request(other_user_id uuid) set search_path = public, pg_temp;
alter function public.activity_list(p_limit integer, p_before timestamp with time zone) set search_path = public, pg_temp;
alter function public.activity_mark_all_read() set search_path = public, pg_temp;
alter function public.activity_mark_read(p_id uuid) set search_path = public, pg_temp;
alter function public.activity_notify_friend_outcome(p_other_user uuid, p_accepted boolean) set search_path = public, pg_temp;
alter function public.activity_notify_new_fan(p_target uuid) set search_path = public, pg_temp;
alter function public.activity_notify_post(p_post_id uuid, p_type text, p_comment_text text, p_comment_id uuid) set search_path = public, pg_temp;
alter function public.activity_record_play(p_post_id uuid) set search_path = public, pg_temp;
alter function public.activity_unread_count() set search_path = public, pg_temp;
alter function public.add_star(target_user_id uuid) set search_path = public, pg_temp;
alter function public.assert_friendship(a uuid, b uuid) set search_path = public, pg_temp;
alter function public.broadcast_jam_state(p_jam_room_id uuid, p_payload jsonb) set search_path = public, pg_temp;
alter function public.cancel_friend_request(other_user_id uuid) set search_path = public, pg_temp;
alter function public.claim_username(p_username text, p_display_name text) set search_path = public, pg_temp;
alter function public.conversations_freeze_derived() set search_path = public, pg_temp;
alter function public.create_group(p_name text, p_member_ids uuid[]) set search_path = public, pg_temp;
alter function public.create_jam_room(p_conversation_id uuid) set search_path = public, pg_temp;
alter function public.delete_my_account() set search_path = public, pg_temp;
alter function public.get_email_for_username(p_username text) set search_path = public, auth, pg_temp;
alter function public.get_jam_snapshot(p_jam_room_id uuid) set search_path = public, pg_temp;
alter function public.get_or_create_dm(user_a uuid, user_b uuid) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.is_conversation_member(conv_id uuid) set search_path = public, pg_temp;
alter function public.is_username_available(p_username text) set search_path = public, pg_temp;
alter function public.list_incoming_friend_requests() set search_path = public, pg_temp;
alter function public.list_my_conversations() set search_path = public, pg_temp;
alter function public.post_comments_freeze_post_id() set search_path = public, pg_temp;
alter function public.posts_clamp_counters_on_insert() set search_path = public, pg_temp;
alter function public.posts_freeze_counter_identity() set search_path = public, pg_temp;
alter function public.profiles_freeze_counters() set search_path = public, pg_temp;
alter function public.reject_friend_request(other_user_id uuid) set search_path = public, pg_temp;
alter function public.remove_friend(other_user_id uuid) set search_path = public, pg_temp;
alter function public.remove_star(target_user_id uuid) set search_path = public, pg_temp;
alter function public.send_friend_request(target_user_id uuid) set search_path = public, pg_temp;
alter function public.tg_follows_profile_counts() set search_path = public, pg_temp;
alter function public.tg_post_comment_likes_count() set search_path = public, pg_temp;
alter function public.tg_post_comments_count() set search_path = public, pg_temp;
alter function public.tg_post_likes_count() set search_path = public, pg_temp;
alter function public.tg_post_reposts_count() set search_path = public, pg_temp;
alter function public.tg_post_views_count() set search_path = public, pg_temp;
alter function public.update_conversation_last_message() set search_path = public, pg_temp;
