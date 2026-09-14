-- ============================================================================
-- post_impressions — the feed learns what it has already shown you
-- ============================================================================
--
-- PROP-0010 phase 1. Two defects, one root cause:
--
--   1. Pull-to-refresh changes nothing on screen.
--   2. The same posts open the feed every session.
--
-- `fetch_home_feed` is a pure function of (viewer graph, posts table, wall-clock
-- hour). Buckets 1 and 2 sort on `EXTRACT(EPOCH FROM created_at)` — pure reverse
-- chronological — so position 1 stays position 1 until somebody uploads. Nothing
-- anywhere records that a post has already been in front of this viewer, so
-- nothing can demote it.
--
-- This migration supplies the missing fact. Phase 2 (sessions, seeded jitter,
-- exponential decay, author diversity) is what makes REFRESH visibly re-rank;
-- this file is what stops the feed repeating itself.
--
-- ── Why a row per (viewer, post) and not an event log ────────────────────────
--
-- `post_views` is an event log — one row per play, growing without bound, which is
-- right for a counter that must survive a post being replayed. Impressions are the
-- opposite question: not "how many times was this played" but "have I shown you
-- this already, and how insistently". The answer is one number per pair, so the
-- table is keyed on the pair and the number is updated in place. It is bounded by
-- catalogue size rather than by scrolling, which matters because every viewer
-- scrolling past every card is precisely the write pattern here.
--
-- ── Why the client cannot write it directly ─────────────────────────────────
--
-- `search_result_taps` lets clients insert their own rows under a `with check`
-- policy, and that is fine for an append-only observation. This table needs
-- increment-in-place semantics and a rate limit, and neither survives being
-- expressed as an RLS policy: a client that can UPDATE its own row can also set
-- `seen_count` to zero and make its own feed repeat forever, or set it to 1000 on
-- somebody else's behalf if the predicate is ever loosened. So there is no client
-- write policy at all — `record_post_impressions()` below is the only writer.
--
-- ── Why there IS a read policy, unlike post_views ────────────────────────────
--
-- `fetch_home_feed` is SECURITY INVOKER (deliberately — 20260809000000 depends on
-- that, so posts/tracks/profiles RLS gates feed visibility). An invoker function
-- reading a table with RLS enabled and no SELECT policy silently gets ZERO ROWS.
-- The suppression would then be a no-op that looks like it works: the feed still
-- renders, the tests still pass if they only assert the shape, and the defect this
-- migration exists to fix would remain. The own-row policy is load-bearing, not
-- convenience.
--
-- ── A note on now() vs timezone('utc', now()) ───────────────────────────────
--
-- The surrounding migrations reach for `timezone('utc', now())`, and these four feed
-- migrations deliberately do not. That expression returns `timestamp WITHOUT time
-- zone` — the UTC wall clock as a naive value — so comparing it against a
-- `timestamptz` column re-interprets it in the SESSION's zone. On a UTC session (CI,
-- and Supabase's own) the two agree and nothing shows. On any other session it is
-- silently off by the offset, and `p.created_at <= origin` starts excluding posts
-- that were created seconds ago.
--
-- That is not hypothetical: it is how it was found. The candidate filter in
-- 20260816030000 dropped every recent post on an Asia/Kolkata session — 5.5 hours of
-- skew — while passing in CI. `now()` is already timestamptz and is the instant these
-- comparisons actually mean.
-- ============================================================================

create table if not exists public.post_impressions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  -- Distinct OCCASIONS the post has been shown, not raw callback fires. The RPC's
  -- rate limit is what makes that true; see the interval there.
  seen_count int not null default 1,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- The primary key already serves the only read this table has: "the rows for THIS
-- viewer" (a prefix scan) and "this viewer's row for this post" (a point lookup).
-- No further index for reads.
--
-- This one is for the write side, and specifically for a prune job that does not
-- exist yet. Once a pair is older than the suppression window it carries no signal
-- — a nightly `delete where last_seen_at < now() - interval '90 days'` keeps the
-- table proportional to recent activity rather than to all history, and without
-- this index that delete is a full scan.
create index if not exists post_impressions_last_seen_idx
  on public.post_impressions (last_seen_at);

alter table public.post_impressions enable row level security;

-- OWN ROWS ONLY. This is the viewer's own record of what they were shown; it is
-- never aggregated across people and never exposed to another account. See the
-- header for why the policy has to exist at all.
drop policy if exists post_impressions_select_own on public.post_impressions;
create policy post_impressions_select_own on public.post_impressions
  for select to authenticated
  using (user_id = auth.uid());

-- NO INSERT, UPDATE OR DELETE POLICY, ON PURPOSE. Writes go through
-- `record_post_impressions()`, which is SECURITY DEFINER and therefore not subject
-- to RLS. A client that could UPDATE this table could reset its own suppression,
-- which is the one thing the table exists to prevent.

comment on table public.post_impressions is
  'One row per (viewer, post): how many separate occasions the home feed has shown '
  'it to them. Read own-rows-only; written solely by record_post_impressions().';

-- ── The writer ──────────────────────────────────────────────────────────────
--
-- Batched: the client buffers ids while the viewer scrolls and flushes a handful at
-- a time, so this is one round-trip per ten-ish cards rather than one per card.
--
-- SECURITY DEFINER for the reason above — there is no write policy to satisfy. The
-- actor comes from auth.uid() inside the body and is never a parameter, so there is
-- nothing a caller can forge. `search_path = public, pg_temp` with pg_temp LAST is
-- the LIV-16 rule: leading pg_temp lets a caller shadow `post_impressions` with a
-- temp table of the same name and redirect the write.
create or replace function public.record_post_impressions(p_post_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_post_ids is null then
    return;
  end if;

  insert into public.post_impressions as pi (user_id, post_id)
  -- Bounded rather than trusted: an unbounded array is an unbounded write, and the
  -- client never has more than a screenful buffered. DISTINCT because the same card
  -- can be reported twice in one flush and the rate limit below should be what
  -- decides that, not the accident of how the batch was assembled.
  --
  -- Bounded via unnest+limit rather than `p_post_ids[1:100]`: a slice assumes a
  -- 1-based array, and one built with a different lower bound slices to nothing. That
  -- fails closed and PostgREST always sends 1-based arrays, so it was only ever a
  -- footnote — but "silently writes nothing" is a bad failure to leave lying around.
  select distinct v_actor, p.id
    from public.posts p
   where p.id in (select x from unnest(p_post_ids) x limit 100)
     -- THE VISIBILITY PREDICATE IS LOAD-BEARING, and was missing in the first draft.
     -- This function is SECURITY DEFINER, so the join above BYPASSES
     -- posts_select_authenticated: without this, a row was written for any post id
     -- that merely EXISTS, and the caller could then read it back through
     -- post_impressions_select_own. That is an existence oracle for posts RLS hides —
     -- demonstrated in security review by a blocked user confirming which of the
     -- blocker's posts still existed.
     --
     -- Deliberately the same predicate as posts_select_authenticated
     -- (20260809000000) rather than a paraphrase of it, so the two cannot drift into
     -- disagreeing about who can see what. Both helpers are existing DEFINER
     -- functions with pinned search_path.
     and (
       p.author_id = v_actor
       or (
         not public.is_blocked_between(v_actor, p.author_id)
         and (p.kind <> 'repost' or public.are_friends(v_actor, p.author_id))
       )
     )
  on conflict (user_id, post_id) do update
     set seen_count   = pi.seen_count + 1,
         last_seen_at = now()
   -- RATE LIMIT, and the definition of "an occasion". Scrolling a card off screen
   -- and back is one exposure, not two; a browsing session is roughly ten minutes.
   -- Without this, `seen_count` counts thumb movements, and the suppression
   -- threshold in fetch_home_feed would burn a post inside a single sitting.
   where pi.last_seen_at < now() - interval '10 minutes';
end;
$$;

-- REVOKE FROM anon BY NAME, not only from PUBLIC. Supabase's default privileges
-- issue a DIRECT execute grant to `anon` on every new function in `public`, and a
-- direct grant survives revoking from the PUBLIC pseudo-role — the trap that
-- 20260806040000_revoke_stale_anon_function_grants.sql was written to clean up.
revoke all on function public.record_post_impressions(uuid[]) from public;
revoke execute on function public.record_post_impressions(uuid[]) from anon;
grant execute on function public.record_post_impressions(uuid[]) to authenticated;

comment on function public.record_post_impressions(uuid[]) is
  'Batched upsert of home-feed impressions for the CALLER (auth.uid(), never a '
  'parameter). Rate-limited to one increment per pair per 10 minutes.';

-- ── post_views: the viewer may read their OWN plays ─────────────────────────
--
-- 20260804050000_close_post_views_read.sql dropped the blanket
-- `using (true)` policy that let any signed-in account reconstruct any named user's
-- complete listening history. That decision stands; nothing here reopens it. That
-- migration also named this exact follow-up:
--
--   "A listener-facing 'your listening history' feature can add
--    `using (user_id = auth.uid())` the day it exists."
--
-- That day is today, for a smaller reason than a history screen. The suppression
-- below must not demote something the viewer has actually PLAYED — a track you keep
-- returning to should not vanish from your feed because you did not also tap like.
-- `fetch_home_feed` runs as invoker, so with no SELECT policy the play check reads
-- zero rows and silently never fires.
--
-- The exposure this adds is: you can read your own plays. Cross-user reads stay
-- denied by default, which is the property 20260804050000 was protecting.
drop policy if exists post_views_select_own on public.post_views;
create policy post_views_select_own on public.post_views
  for select to authenticated
  using (user_id = auth.uid());

-- ── fetch_home_feed: a fourth bucket for "you have seen enough of this" ─────
--
-- Redefines the function from 20260707000000_home_feed_single_call.sql. Signature,
-- return shape, cursor semantics, SECURITY INVOKER and the trending sort_key are
-- all unchanged; the ONLY change is the `suppressed` CTE and the new leading branch
-- of the bucket CASE.
--
-- DEMOTION, NOT EXCLUSION, and this is the important design choice. A filter would
-- risk the failure mode the proposal's risk table names: an active viewer exhausts
-- the candidate pool and gets an EMPTY feed, which is far worse than a repetitive
-- one. Ordering is `feed_bucket ASC`, so bucket 4 sorts after everything else and
-- surfaces only when nothing fresher is left. Same query shape, same keyset
-- pagination, no fallback branch to get wrong.
--
-- Bucket 4 needs no arm in the sort_key CASE: that CASE is `WHEN feed_bucket IN
-- (1,2) THEN <recency> ELSE <trending>`, so 4 already scores like 3 and the best of
-- the already-seen comes back first.
create or replace function public.fetch_home_feed(
  p_limit integer DEFAULT 15,
  p_cursor_bucket integer DEFAULT NULL,
  p_cursor_sort_key double precision DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  feed_bucket integer,
  sort_key double precision,
  post_id uuid,
  post jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  -- The viewer's accepted friends → their author ids (bucket 1).
  friend_authors AS (
    SELECT CASE WHEN f.user_a_id = m.uid THEN f.user_b_id ELSE f.user_a_id END AS author_id
    FROM public.friendships f
    CROSS JOIN me m
    WHERE f.status = 'accepted'
      AND (f.user_a_id = m.uid OR f.user_b_id = m.uid)
  ),
  -- The viewer's starred follows → their author ids (bucket 2).
  star_authors AS (
    SELECT fo.following_id AS author_id
    FROM public.follows fo
    CROSS JOIN me m
    WHERE fo.follower_id = m.uid
      AND fo.kind = 'star'
  ),
  -- Shown at least 3 times, on separate occasions, in the last week, and never
  -- acted on (bucket 4).
  --
  -- Scoped to the viewer's OWN impression rows first, so the two engagement probes
  -- run over a handful of rows rather than once per post in the table. That
  -- ordering is the whole reason this can be correlated subqueries at all — the
  -- per-post EXISTS probes are exactly what 20260707000000 removed from the
  -- bucketing path, and reintroducing them there would undo that work.
  --
  -- 3, and 7 days: three separate sittings is enough to conclude the viewer is not
  -- interested, and a week later the same post is a different proposition — the
  -- window lets genuinely good content resurface instead of being burned forever.
  suppressed AS (
    SELECT pi.post_id
    FROM public.post_impressions pi
    CROSS JOIN me m
    WHERE pi.user_id = m.uid
      AND pi.seen_count >= 3
      AND pi.last_seen_at > now() - interval '7 days'
      -- Engagement of ANY kind exempts a post. Liking it is the explicit signal;
      -- playing it is the honest one, and the more common.
      AND NOT EXISTS (
        SELECT 1 FROM public.post_likes pl
        WHERE pl.post_id = pi.post_id AND pl.user_id = m.uid
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.post_views pv
        WHERE pv.post_id = pi.post_id AND pv.user_id = m.uid
      )
  ),
  -- Score every visible post: bucket by set membership, then time-decayed sort.
  scored AS (
    SELECT
      b.post_id,
      b.feed_bucket,
      CASE
        WHEN b.feed_bucket IN (1, 2)
          THEN EXTRACT(EPOCH FROM b.created_at)::double precision
        ELSE (
          (b.likes_count::double precision * 2.0
            + b.reposts_count::double precision * 3.0
            + b.comments_count::double precision
            + b.views_count::double precision / 10.0)
          / POWER(
            GREATEST(EXTRACT(EPOCH FROM (now() - b.created_at)) / 3600.0, 0.0) + 2.0,
            1.3
          )
        )
      END AS sort_key
    FROM (
      SELECT
        p.id AS post_id,
        p.created_at,
        p.likes_count,
        p.reposts_count,
        p.comments_count,
        p.views_count,
        CASE
          -- FIRST, deliberately: a friend's post the viewer has scrolled past three
          -- times is still a post they are done with. Affinity does not exempt it.
          WHEN p.id IN (SELECT post_id FROM suppressed) THEN 4
          WHEN p.author_id IN (SELECT author_id FROM friend_authors) THEN 1
          WHEN p.author_id IN (SELECT author_id FROM star_authors) THEN 2
          ELSE 3
        END AS feed_bucket
      FROM public.posts p
      WHERE (SELECT uid FROM me) IS NOT NULL
    ) b
  ),
  -- Apply the keyset cursor + ordering + limit BEFORE hydrating, so the jsonb
  -- build and joins below run for only the page's rows.
  page AS (
    SELECT s.post_id, s.feed_bucket, s.sort_key
    FROM scored s
    WHERE
      p_cursor_bucket IS NULL
      OR (
        s.feed_bucket > p_cursor_bucket
        OR (s.feed_bucket = p_cursor_bucket AND s.sort_key < p_cursor_sort_key)
        OR (
          s.feed_bucket = p_cursor_bucket
          AND s.sort_key = p_cursor_sort_key
          AND s.post_id < p_cursor_id
        )
      )
    ORDER BY s.feed_bucket ASC, s.sort_key DESC, s.post_id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50)
  )
  SELECT
    pg.feed_bucket,
    pg.sort_key,
    pg.post_id,
    jsonb_build_object(
      'id', p.id,
      'kind', p.kind,
      'caption', p.caption,
      'created_at', p.created_at,
      'views_count', p.views_count,
      'likes_count', p.likes_count,
      'reposts_count', p.reposts_count,
      'comments_count', p.comments_count,
      'author_id', p.author_id,
      'original_post_id', p.original_post_id,
      'clip_start_sec', p.clip_start_sec,
      'clip_end_sec', p.clip_end_sec,
      'track', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'media_kind', t.media_kind,
        'audio_url', t.audio_url,
        'video_url', t.video_url,
        'cover_art_url', t.cover_art_url,
        'thumbnail_url', t.thumbnail_url,
        'duration_seconds', t.duration_seconds
      ) END,
      'author', jsonb_build_object(
        'id', a.id,
        'username', a.username,
        'display_name', a.display_name,
        'avatar_url', a.avatar_url
      ),
      'original_author', orig.author,
      'viewer_has_liked', (pl.post_id IS NOT NULL)
    ) AS post
  FROM page pg
  JOIN public.posts p ON p.id = pg.post_id
  JOIN public.profiles a ON a.id = p.author_id
  LEFT JOIN public.tracks t ON t.id = p.track_id
  -- Resolve the original uploader for reposts (NULL for uploads, or if the
  -- original is gone / RLS-hidden — matching the old client behaviour).
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'id', oa.id,
      'username', oa.username,
      'display_name', oa.display_name,
      'avatar_url', oa.avatar_url
    ) AS author
    FROM public.posts op
    JOIN public.profiles oa ON oa.id = op.author_id
    WHERE op.id = p.original_post_id
  ) orig ON true
  LEFT JOIN public.post_likes pl
    ON pl.post_id = p.id AND pl.user_id = (SELECT uid FROM me)
  ORDER BY pg.feed_bucket ASC, pg.sort_key DESC, pg.post_id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_home_feed(integer, integer, double precision, uuid) TO authenticated;
