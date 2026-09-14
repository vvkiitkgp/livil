-- ─────────────────────────────────────────────────────────────────────────────
-- PROP-0004 / ADR-0009 — Harden the existing Stories draft in place
--
-- The Stories feature (20260530000001_repost_and_stories.sql) shipped with one
-- genuine, ship-relevant authorization defect and one query-bounding gap:
--
--   1. stories_insert was `with check (author_id = auth.uid())` ONLY. It did not
--      constrain expires_at, track_id or original_post_id. The expires_at DEFAULT
--      fires only when the column is OMITTED — a raw PostgREST client can send
--      `expires_at: '2099-01-01'`, and because stories_select gates visibility on
--      `expires_at > now()`, that yields a PERMANENTLY visible story. The linkage
--      and kind='upload' checks live only in the client (stories.ts) and are
--      bypassed by hitting PostgREST directly. This is the D-53 "client validation
--      is not RLS" shape — it defeats the read perimeter (ADR-0004: RLS is the
--      ENTIRE perimeter).
--
--   2. list_active_stories() had no LIMIT — an unbounded list by default (P22).
--
-- This migration implements ADR-0009 Decisions 1 and 3 (Decision 2 — a pg_cron
-- reaper — is REJECTED there and is deliberately NOT included; nor is any
-- moderation table, playback change, or push).
--
-- The fix is entirely declarative: an expires_at pin TRIGGER + a tightened
-- stories_insert WITH CHECK, both SECURITY INVOKER. ADR-0009 explicitly rejects
-- both a CHECK bound (non-immutable now() in a constraint; still lets the client
-- pick any in-window value) and a SECURITY DEFINER create_story RPC (adds a
-- privileged surface and bypasses posts' RLS for no authorization gain, because
-- posts_select is `using (true)`).
--
-- Requires security-reviewer sign-off (autonomy-config.yml: MANDATORY).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: pin expires_at server-side ───────────────────────────────────────
-- A BEFORE INSERT OR UPDATE trigger that OVERWRITES expires_at removes client
-- control entirely — stronger than a CHECK bound, which would still let a client
-- choose any value inside the 24h window and would put a non-immutable now() in a
-- constraint (ADR-0009 Alternatives). SECURITY INVOKER (default): it touches only
-- NEW and needs no privilege. now() resolves to pg_catalog.now() unqualified, so
-- there is no search_path exposure (and INVOKER functions are outside the DEFINER
-- search_path lint regardless).
create or replace function public.stories_pin_expiry()
returns trigger
language plpgsql
as $$
begin
  new.expires_at := now() + interval '24 hours';
  return new;
end;
$$;

drop trigger if exists stories_pin_expiry_trg on public.stories;
create trigger stories_pin_expiry_trg
  before insert or update on public.stories
  for each row
  execute function public.stories_pin_expiry();

-- ── Step 2: tighten stories_insert linkage ───────────────────────────────────
-- Drop-then-recreate so a leftover permissive definition cannot survive and OR
-- with the scoped one (policies OR together). SECURITY INVOKER (policy default):
-- the posts subquery is evaluated as the caller and inherits posts' own RLS — so
-- it enforces post-visibility for free if/when posts_select is ever tightened from
-- its current `using (true)` (ADR-0009 note-to-future).
-- NOTE ON QUALIFICATION — load-bearing, do not "simplify". Both references to the
-- new story row inside the subquery are qualified `stories.<col>`. `public.posts`
-- has its OWN `original_post_id` and `track_id` columns, so an UNQUALIFIED
-- `original_post_id` / `track_id` inside `from public.posts p` binds to the posts row
-- (inner scope wins), NOT to the story being inserted. Unqualified, `p.id =
-- original_post_id` silently becomes `p.id = p.original_post_id` (NULL for an upload)
-- → the subquery is always empty → EVERY insert is rejected and stories becomes
-- unwritable. Verified in supabase/tests/rls/stories-harden.test.sql (step 2c must
-- pass, not just 2a/2b fail).
drop policy if exists "stories_insert" on public.stories;
create policy "stories_insert" on public.stories for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = stories.original_post_id
        and p.track_id = stories.track_id
        and p.kind = 'upload'
    )
  );

-- ── Step 3: bound list_active_stories() ──────────────────────────────────────
-- Cheap, harmless, correct default (P22) — belt-and-suspenders on top of the
-- social-graph bound. Body is unchanged except for the LIMIT. Stays SECURITY
-- INVOKER so RLS still filters what the caller may see.
create or replace function public.list_active_stories()
returns table (
  story_id         uuid,
  author_id        uuid,
  username         text,
  display_name     text,
  avatar_url       text,
  track_id         uuid,
  track_title      text,
  track_audio_url  text,
  track_video_url  text,
  track_cover_url  text,
  track_media_kind text,
  original_post_id uuid,
  comment          text,
  clip_start_sec   numeric,
  clip_end_sec     numeric,
  created_at       timestamptz,
  expires_at       timestamptz,
  viewed_at        timestamptz
)
language sql stable security invoker
as $$
  select
    s.id             as story_id,
    s.author_id,
    p.username,
    p.display_name,
    p.avatar_url,
    s.track_id,
    t.title          as track_title,
    t.audio_url      as track_audio_url,
    t.video_url      as track_video_url,
    t.cover_art_url  as track_cover_url,
    t.media_kind     as track_media_kind,
    s.original_post_id,
    s.comment,
    s.clip_start_sec,
    s.clip_end_sec,
    s.created_at,
    s.expires_at,
    sv.viewed_at
  from public.stories s
    join public.profiles p on p.id = s.author_id
    join public.tracks   t on t.id = s.track_id
    left join public.story_views sv
      on sv.story_id = s.id and sv.viewer_id = auth.uid()
  where s.expires_at > now()
  order by (sv.viewed_at is null) desc, s.created_at desc
  limit 200;
$$;

-- ── Drift check: a leftover permissive write policy defeats the scoped one ────
-- Mirrors 20260722000000_liv10_authorization_guards.sql:806-822. A half-applied
-- perimeter that looks applied is worse than a failed apply. If a leftover
-- insert/update/all policy other than stories_insert survives on stories, it ORs
-- with the tightened WITH CHECK and re-opens the hole — abort loudly instead.
--
-- polcmd: 'a' = insert, 'w' = update, '*' = all (grants both). 'd' (delete, i.e.
-- stories_delete) and 'r' (select) are not write-perimeter and are excluded.
do $$
declare
  v_extra text;
  v_norls text;
begin
  -- FIRST: a policy on a table with RLS disabled is inert, so stories_insert would
  -- be decoration and the scan below would find nothing to complain about. Checked
  -- before the policy scan because it invalidates that scan's meaning.
  select string_agg(relname, ', ') into v_norls
    from pg_class
   where oid = 'public.stories'::regclass
     and not relrowsecurity;

  if v_norls is not null then
    raise exception
      'PROP-0004 aborted: row-level security is DISABLED on %, so stories_insert is inert',
      v_norls;
  end if;

  select string_agg(format('%s (%s on %s)', polname, polcmd, polrelid::regclass), ', ')
    into v_extra
  from pg_policy
  where polcmd in ('a', 'w', '*')
    and polrelid = 'public.stories'::regclass
    and polname not in ('stories_insert');

  if v_extra is not null then
    raise exception
      'PROP-0004 aborted: unrecognised write policies survive on stories and will OR with stories_insert: %',
      v_extra;
  end if;
end $$;
