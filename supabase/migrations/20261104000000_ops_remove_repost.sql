-- ============================================================================
-- A reported repost — Spotify or Livil — can be seen, and removed on its own
-- ============================================================================
--
-- The first report on a Spotify repost (2026-10-17, a cover-art complaint) exposed two
-- gaps in the moderation queue, and fixing the second exposed a third:
--
--   * WHAT was reported. `ops_reports_overview` joins posts → tracks, and a Spotify repost
--     (ADR-0027) has no track, so every track column came back null and the queue called
--     it "(track unavailable)". It now also returns `spotify_track_id`, which the web
--     console resolves to title, artists and artwork live through the `spotify` edge
--     function — never stored here (Spotify's Developer Terms; ADR-0027) — `post_kind`,
--     so the console can tell a repost from an upload, and `post_caption`: a repost is
--     usually reported for what its reposter WROTE, and the queue showed only the song.
--
--   * No way to act on a Spotify repost. ADR-0027 recorded it: "Ops has no tool to remove a
--     Spotify repost yet (`ops_take_down_track` acts on a track) … removal is by SQL".
--
--   * No PROPORTIONATE way to act on a Livil repost. Its only button was the track
--     takedown, which removes the uploader's post and every other repost too. A repost is
--     reported for what its reposter added — usually the caption — and the takedown
--     punished the uploader and every other reposter for it.
--
-- `ops_remove_repost` deletes ONE repost of either kind, records the decision in
-- `moderation_actions`, and tells its author why. The original upload, and everyone else's
-- reposts, stay.
--
-- ── WHY A NEW FUNCTION, NOT A WIDER `ops_take_down_track` ──────────────────
--
-- A takedown acts on a TRACK: it tombstones it, removes every post serving it, and can be
-- restored. This acts on one POST. Folding it in would give the takedown a second meaning
-- keyed on which argument happened to be passed. It refuses uploads for the same reason:
-- removing an upload's post alone would leave the track serving through every repost of
-- it, which is exactly what the takedown exists to prevent.
--
-- No other POST depends on a repost: the app only ever reposts an UPLOAD
-- (`original_post_id` always names one), and a story can only share an upload.
--
-- PLAYLISTS do. A listener who adds the song while playing it from a repost saves THAT
-- post's id (`FullScreenPlayer` → `addPostToPlaylist(nowPlaying.postId)`), and
-- `playlist_posts.post_id` is ON DELETE CASCADE — so removing @riya's repost for her
-- caption would silently take the song out of @sam's playlist. Those entries are moved to
-- the original upload first, keeping their `added_at`; the listener keeps the song and
-- only the caption goes. Jam suggestions of the repost are not moved: their identity is
-- immutable by design (`jam_suggestions_guard`) and they are a live room's queue, cleared
-- when the jam ends; they go with the post and are counted in the ledger (security review,
-- 2026-10-17). Spotify reposts can be in neither (`reject_spotify_post`).
--
-- ── WHY THE DELETE IS NOT REVERSIBLE ───────────────────────────────────────
--
-- Same posture as ADR-0017 §C: posts are deleted, not hidden, so no privileged reader can
-- leak them. A repost is one row — a caption, a clip, a pointer — and its author can
-- repost again in seconds if the removal was wrong. The ledger keeps the caption, so the
-- operator can tell them exactly what came down.
--
-- ── THE REPORT ROWS GO WITH THE POST ───────────────────────────────────────
--
-- `post_reports.post_id` is ON DELETE CASCADE, as it already is for a takedown. The
-- reports are therefore summarised into the ledger snapshot first, so "how many people
-- reported it, under which category, and when" survives the decision it led to.
--
-- The CATEGORY only (a fixed vocabulary), never `reporter_id` or the free-text `details`.
-- The ledger has no foreign keys and is append-only even for the table owner, so anything
-- copied into it outlives the reporter's account — and today deleting that account erases
-- what they wrote (`post_reports.reporter_id` is ON DELETE CASCADE). Bounded as well:
-- anyone can file any number of reports with unbounded `details`, and an unbounded
-- `jsonb_agg` of them could make the post impossible to remove (security review,
-- 2026-10-17). The operator's own reason, which is what the author is told, is kept whole.
--
-- ── THE CAPTION AS REPORTED ────────────────────────────────────────────────
--
-- `posts_update_own` lets the author rewrite the caption at any time, so a queue reading
-- the live caption could show "great song" for a report of harassment, edited after the
-- fact. `post_reports.caption_excerpt` is snapshotted from the stored post when the report
-- is filed — never from the client — the same fix `post_comment_reports` got
-- (20261102000000). The same trigger pins `created_at`, `reviewed_at` and `reviewed_by`:
-- a reporter could file a report pre-marked "reviewed" (out of the open queue) or
-- backdated, and those values now reach the append-only ledger.
--
-- ── NO post_removals ROW ───────────────────────────────────────────────────
--
-- The shipped app's card for a removed repost says "The original track is no longer
-- available on Livil, so your repost of it was removed too" — false for both kinds here —
-- and `post_removals.track_id` is NOT NULL, which a Spotify repost cannot fill. The author
-- is told through the `content_removed` notification instead.
--
-- ── Old app versions (production compatibility) ─────────────────────────────
--
-- ADDITIVE. New columns on an ops-only function the mobile app never calls, a wider CHECK
-- on an ops-only ledger, a new ops-only function, and a nullable `post_reports` column
-- with a trigger that fills it: 2.1.x files a report as {post_id, reporter_id, reason,
-- details}, which the trigger completes and never refuses. The one thing a shipped app
-- reads is the `content_removed` notification. 2.1.x words it from `kind` and
-- `track_title`, and only one combination is true here:
--
--   kind 'repost'          → "Your repost of … was removed — the original is no longer on
--                             Livil"   FALSE: the original is still there (or on Spotify)
--   a title, other kind    → "“<title>” was removed from Livil"   FALSE: reads as the song
--   NO title, other kind   → "one of your posts was removed from Livil."   TRUE
--
-- So the notice carries no title and kind 'spotify_repost' or 'livil_repost', followed by
-- the operator's reason. A later app can word those two kinds more specifically.
-- ============================================================================

-- ── 1. The ledger learns a fourth action ────────────────────────────────────
-- Wider, not tighter: every existing row still satisfies it. Strikes are untouched —
-- `ops_takedown_counts` counts 'takedown' minus 'restore' only, and a removed repost is
-- not a rights strike against the person who shared it.
alter table public.moderation_actions
  drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions
  add constraint moderation_actions_action_check
  check (action in ('takedown', 'restore', 'purge_media', 'remove_post'));

-- ── 2. A post report keeps the caption as it was reported ──────────────────
alter table public.post_reports
  add column if not exists caption_excerpt text;

comment on column public.post_reports.caption_excerpt is
  'The reported post''s caption when the report was filed, copied from the stored post by '
  'trg_post_reports_snapshot — never from the client. NULL when it had none.';

-- Mirrors `post_comment_reports_snapshot` (20261102000000). DEFINER: it reads the post
-- whatever the reporter may see, and writes only into the reporter's own new row.
create or replace function public.post_reports_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- Overwrites anything the client sent; no row (a post deleted meanwhile) leaves NULL.
  select left(nullif(btrim(p.caption), ''), 500)
    into new.caption_excerpt
    from posts p
   where p.id = new.post_id;
  -- A report starts unreviewed and is dated now — a reporter cannot file one pre-marked
  -- "reviewed by" an operator, or backdated out of the open queue.
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.created_at  := now();
  return new;
end;
$function$;

revoke execute on function public.post_reports_snapshot() from public, anon, authenticated;

drop trigger if exists trg_post_reports_snapshot on public.post_reports;
create trigger trg_post_reports_snapshot
  before insert on public.post_reports
  for each row execute function public.post_reports_snapshot();

-- Reports filed before this: the caption now is the best record there is.
update public.post_reports r
   set caption_excerpt = left(nullif(btrim(p.caption), ''), 500)
  from public.posts p
 where p.id = r.post_id
   and r.caption_excerpt is null;

-- ── 3. The queue says what kind of post was reported ────────────────────────
-- Body as in 20261102000000 plus `spotify_track_id` and `post_kind` (posts, and the post a
-- comment sits under), `post_caption` (reported posts only) and an excerpt that names a
-- Spotify repost rather than calling it unavailable. `drop` first because the return type
-- changes.
drop function if exists public.ops_reports_overview(boolean);

create or replace function public.ops_reports_overview(p_include_reviewed boolean default false)
returns table (
  kind              text,
  id                uuid,
  created_at        timestamptz,
  reason            text,
  details           text,
  reporter_id       uuid,
  reporter_username text,
  reported_user_id  uuid,
  reported_username text,
  target_id         uuid,
  target_excerpt    text,
  target_exists     boolean,
  track_id            uuid,
  track_title         text,
  media_kind          text,
  media_url           text,
  cover_url           text,
  track_taken_down_at timestamptz,
  -- ── new: the Spotify track behind a Spotify repost (ADR-0027). The id only; the
  -- console resolves title and artwork live.
  spotify_track_id    text,
  -- ── new: 'upload' or 'repost', so the console offers "Remove repost" only where it
  -- applies. Null when the post is gone, and for stories.
  post_kind           text,
  -- ── new: the reported post's caption AS REPORTED (section 2), not as it reads now. Post
  -- reports only — for a comment report the excerpt already is the reported words.
  post_caption        text,
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  reviewer_username text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.is_ops() then
    return;
  end if;

  return query
    -- ── Posts ──
    select
      'post'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      po.author_id, auth_p.username,
      r.post_id,
      coalesce(
        t.title,
        case when po.spotify_track_id is not null then '(Spotify repost)' end,
        '(track unavailable)'
      )::text,
      (po.id is not null),
      t.id, t.title, t.media_kind,
      case when t.media_kind = 'video' then t.video_url else t.audio_url end,
      coalesce(t.cover_art_url, t.thumbnail_url),
      t.taken_down_at,
      po.spotify_track_id,
      po.kind,
      r.caption_excerpt,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.post_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.posts po        on po.id = r.post_id
    left join public.profiles auth_p on auth_p.id = po.author_id
    left join public.tracks t        on t.id = po.track_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Comments ──
    -- What was REPORTED: the words as they were at report time (the snapshot), so neither
    -- deleting nor changing the comment afterwards hides them. The live body only for a
    -- report filed before snapshots existed.
    select
      'comment'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      coalesce(c.author_id, r.reported_user_id), auth_p.username,
      r.comment_id,
      coalesce(left(r.comment_excerpt, 140), left(c.body, 140), '(comment deleted)')::text,
      (c.id is not null),
      ct.id, ct.title, ct.media_kind,
      case when ct.media_kind = 'video' then ct.video_url else ct.audio_url end,
      coalesce(ct.cover_art_url, ct.thumbnail_url),
      ct.taken_down_at,
      cpo.spotify_track_id,
      cpo.kind,
      null::text,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.post_comment_reports r
    left join public.profiles rep     on rep.id = r.reporter_id
    left join public.post_comments c  on c.id = r.comment_id
    left join public.profiles auth_p  on auth_p.id = coalesce(c.author_id, r.reported_user_id)
    -- The post the comment sits (or sat) under, and its track. A remark is not judgeable
    -- without the thing it was a remark about.
    left join public.posts cpo        on cpo.id = coalesce(c.post_id, r.comment_post_id)
    left join public.tracks ct        on ct.id = cpo.track_id
    left join public.profiles rv      on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    union all

    -- ── Stories ──
    -- reported_user_id comes off the REPORT, not the story: the story may be gone. A story
    -- cannot carry a Spotify track (ADR-0027) and is not a post, so the three new columns
    -- are null here.
    select
      'story'::text,
      r.id, r.created_at, r.reason, r.details,
      r.reporter_id, rep.username,
      r.reported_user_id, auth_p.username,
      r.story_id,
      case
        when s.id is null then '(story expired)'
        else coalesce(nullif(btrim(s.comment), ''), t.title, '(no caption)')
      end::text,
      (s.id is not null),
      t.id, t.title, t.media_kind,
      case when t.media_kind = 'video' then t.video_url else t.audio_url end,
      coalesce(t.cover_art_url, t.thumbnail_url),
      t.taken_down_at,
      null::text,
      null::text,
      null::text,
      r.reviewed_at, r.reviewed_by, rv.username
    from public.story_reports r
    left join public.profiles rep    on rep.id = r.reporter_id
    left join public.stories s       on s.id = r.story_id
    left join public.tracks t        on t.id = s.track_id
    left join public.profiles auth_p on auth_p.id = r.reported_user_id
    left join public.profiles rv     on rv.id = r.reviewed_by
    where p_include_reviewed or r.reviewed_at is null

    order by 3 desc;
end;
$function$;

comment on function public.ops_reports_overview(boolean) is
  'The moderation queue. Returns the reported TRACK (or, for a Spotify repost, its Spotify '
  'track id) and the kind of post as well as the report, so an operator can see what was '
  'reported before deciding.';

revoke all on function public.ops_reports_overview(boolean) from public;
revoke execute on function public.ops_reports_overview(boolean) from anon;
grant execute on function public.ops_reports_overview(boolean) to authenticated;

-- ── 4. Removing one ─────────────────────────────────────────────────────────
-- The name this function had while it removed only Spotify reposts. Never applied to
-- production; dropped in case a copy of an earlier draft was.
drop function if exists public.ops_remove_spotify_repost(uuid, text);

-- RAISES for a non-operator, like every ops WRITE: a silent no-op would tell the operator
-- the post was gone while it was still in feeds.
create or replace function public.ops_remove_repost(
  p_post_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_author  uuid;
  v_kind    text;
  v_track   uuid;
  v_original uuid;
  v_spotify text;
  v_caption text;
  v_posted  timestamptz;
  v_what    text;
  v_reason  text;
  v_reports jsonb;
  v_report_count integer;
  v_playlist_entries integer;
  v_jam_suggestions integer;
begin
  -- FIRST, before the parameters are read (Constitution P17).
  if not public.is_ops() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- The author is shown this verbatim, so an empty one would tell them nothing — the
  -- failure the removal notice exists to prevent. The length matches the ledger's CHECK,
  -- so an over-long reason is refused with a readable message rather than a constraint
  -- name, and before anything has been deleted.
  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception 'a reason is required: the person is shown it' using errcode = '22023';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'the reason is too long (1000 characters at most)' using errcode = '22023';
  end if;

  -- FOR UPDATE: two operators on the same report must not both record a removal.
  select author_id, kind, track_id, original_post_id, spotify_track_id, caption, created_at
    into v_author, v_kind, v_track, v_original, v_spotify, v_caption, v_posted
    from public.posts
   where id = p_post_id
     for update;
  if not found then
    raise exception 'that post is already gone' using errcode = 'P0002';
  end if;
  -- An upload goes through `ops_take_down_track`, which also removes every repost of the
  -- track and can be restored. Removing only the upload's post would leave the reposts
  -- serving the track.
  if v_kind <> 'repost' then
    raise exception 'this is an upload: take down its track instead' using errcode = '22023';
  end if;
  v_what := case when v_spotify is not null then 'spotify_repost' else 'livil_repost' end;

  -- Before the delete: the cascade takes the report rows with the post. Category and time
  -- only, newest 200 — see the header for why neither who nor their words.
  select count(*) into v_report_count
    from public.post_reports
   where post_id = p_post_id;

  -- `caption` is the POSTER's words as each report saw them (section 2) — what was
  -- reported, which may differ from what came down if the caption was edited since.
  select jsonb_agg(jsonb_build_object(
           'report_id',   r.id,
           'reason',      r.reason,
           'caption',     r.caption_excerpt,
           'reported_at', r.created_at,
           'reviewed_at', r.reviewed_at)
         order by r.created_at desc)
    into v_reports
    from (select id, reason, caption_excerpt, created_at, reviewed_at
            from public.post_reports
           where post_id = p_post_id
           order by created_at desc
           limit 200) r;

  -- Listeners who saved the song FROM this repost keep it: their playlist entries move to
  -- the original upload (see the header). Already holding the original → nothing to add.
  -- An orphaned repost (its original deleted) has nowhere to move them, and they go.
  select count(*) into v_playlist_entries
    from public.playlist_posts where post_id = p_post_id;
  if v_original is not null and v_playlist_entries > 0 then
    insert into public.playlist_posts (playlist_id, post_id, added_at)
    select pp.playlist_id, v_original, pp.added_at
      from public.playlist_posts pp
     where pp.post_id = p_post_id
    on conflict (playlist_id, post_id) do nothing;
  end if;
  select count(*) into v_jam_suggestions
    from public.jam_suggestions where post_id = p_post_id;

  delete from public.posts where id = p_post_id;

  -- actor_id and created_at are pinned by `moderation_actions_pin`. `track_id` stays null
  -- even for a Livil repost: that column is "an action on this track" — what
  -- `ops_moderation_history` lists — and the track and its uploader were not acted on.
  -- The snapshot names it instead.
  insert into public.moderation_actions (action, track_id, target_owner_id, reason, snapshot)
  values (
    'remove_post',
    null,
    v_author,
    v_reason,
    jsonb_build_object(
      'post_id',          p_post_id,
      'post_kind',        v_what,
      'track_id',         v_track,
      'spotify_track_id', v_spotify,
      'caption',          v_caption,
      'posted_at',        v_posted,
      'report_count',     v_report_count,
      -- Counts only, like the reports: whose playlists is nobody's business here.
      'playlist_entries', v_playlist_entries,
      'playlist_entries_kept', v_original is not null,
      'jam_suggestions',  v_jam_suggestions,
      'reports',          coalesce(v_reports, '[]'::jsonb))
  );

  -- No title and never kind 'repost' — see the header for what 2.1.x would say otherwise.
  -- (A Spotify title could not be sent anyway: it is never stored, ADR-0027.) Swallows its
  -- own errors — the removal is the obligation, the notice a courtesy that must not block it.
  perform public.notify_content_removed(v_author, null, v_what, v_reason);
end;
$function$;

comment on function public.ops_remove_repost(uuid, text) is
  'Deletes ONE repost — Spotify (ADR-0027) or Livil — records it in moderation_actions with '
  'a summary of the reports that led to it, and tells its author why. The original upload '
  'and other reposts stay, and playlist entries of the repost move to the upload. Uploads '
  'go through ops_take_down_track.';

revoke all on function public.ops_remove_repost(uuid, text) from public;
revoke execute on function public.ops_remove_repost(uuid, text) from anon;
grant execute on function public.ops_remove_repost(uuid, text) to authenticated;

-- ── 5. Verify ───────────────────────────────────────────────────────────────
do $verify$
begin
  if has_function_privilege('anon', 'public.ops_remove_repost(uuid, text)', 'execute') then
    raise exception 'anon can execute ops_remove_repost';
  end if;
  if has_function_privilege('anon', 'public.ops_reports_overview(boolean)', 'execute') then
    raise exception 'anon can execute ops_reports_overview';
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.ops_remove_repost(uuid, text)'::regprocedure
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception 'ops_remove_repost must be SECURITY DEFINER with a pinned search_path';
  end if;
end
$verify$;
