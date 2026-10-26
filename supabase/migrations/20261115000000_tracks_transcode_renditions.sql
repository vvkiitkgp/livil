-- ============================================================================
-- Streaming renditions — the server swaps a heavy upload for a lighter copy
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- Uploads are raw phone recordings and the app plays them as-is. On 2026-10-26 the
-- newest video was 2160x3840, 60 fps, HEVC at 38 Mbit/s (127 MB for 27 s); three more
-- were 15 Mbit/s; five songs were uncompressed WAV at 1.4–2.3 Mbit/s. A phone on 4G
-- gets 5–20 Mbit/s, so those posts buffered endlessly. The database server was idle the
-- whole time (CPU 5 %) — media never touches it; the files were the problem.
--
-- The fix is server-side (ADR-0033): a job on GitHub Actions
-- (.github/workflows/transcode-media.yml → scripts/transcode-media.mjs) re-encodes a
-- heavy file into a streaming-friendly rendition (video: H.264 ≤1080p 30 fps, sound
-- track copied untouched; audio: AAC 256 kbit/s), uploads it NEXT TO the original as
-- <uploader>/<track>/video.h264.mp4 or audio.aac.m4a, and points the track at it.
-- Nothing is deleted: the scanned upload stays in the bucket and this row remembers it.
--
-- WHAT CHANGES
--
-- 1. Four nullable columns on tracks — the job's ledger. Nullable, no default, so an
--    insert from any shipped app (which never sends them) is unaffected. Clients cannot
--    write them (section 2): the ledger belongs to the service role.
-- 2. tracks_freeze_media() gains ONE more legal transition. Since 20260922100000 a media
--    URL is the track's identity and cannot change after the upload placeholder becomes
--    real — that is what makes a copyright scan mean something. The service role may now
--    replace a real URL with a rendition that lives in the SAME bucket folder
--    (<uploader>/<track>/), and only while recording which upload it replaced in
--    original_media_url. Every client stays fully frozen. The service role could already
--    do anything (it could drop the trigger), so this widens nothing — it names the one
--    swap we intend and refuses every other shape.
--
-- PRODUCTION SAFETY — safe to apply before any app update: additive columns, no rename,
-- no retype, no tightened policy. Shipped apps read audio_url/video_url and get the
-- rendition's URL the next time they load the row; the original keeps serving at its
-- old URL for anyone who cached it.
-- ============================================================================

-- ── 1. The ledger ──────────────────────────────────────────────────────────

alter table public.tracks
  add column if not exists transcode_status   text,
  add column if not exists transcoded_at      timestamptz,
  add column if not exists transcode_error    text,
  add column if not exists original_media_url text;

alter table public.tracks drop constraint if exists tracks_transcode_status_check;
alter table public.tracks
  add constraint tracks_transcode_status_check
  check (transcode_status is null or transcode_status in ('skipped', 'done', 'failed'));

comment on column public.tracks.transcode_status is
  'Written by scripts/transcode-media.mjs as the service role. NULL = not looked at yet; '
  'skipped = already light enough, or not media of ours; done = audio_url/video_url now '
  'points at the rendition; failed = see transcode_error — reset to NULL to retry.';
comment on column public.tracks.transcoded_at is
  'When the rendition replaced the upload.';
comment on column public.tracks.transcode_error is
  'Why the last attempt failed (truncated).';
comment on column public.tracks.original_media_url is
  'The upload that was scanned and then replaced by a rendition. Still in the bucket; '
  'pointing audio_url/video_url back at it (as the service role) undoes the swap.';

-- ── 2. Clients cannot write the ledger ─────────────────────────────────────
-- Same shape as keep_created_at (20261105000000): whatever the app roles send for these
-- columns is ignored — on insert they start empty, on update they keep their value.

create or replace function public.tracks_keep_transcode_ledger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.transcode_status   := null;
      new.transcoded_at      := null;
      new.transcode_error    := null;
      new.original_media_url := null;
    else
      new.transcode_status   := old.transcode_status;
      new.transcoded_at      := old.transcoded_at;
      new.transcode_error    := old.transcode_error;
      new.original_media_url := old.original_media_url;
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.tracks_keep_transcode_ledger() from anon;

drop trigger if exists trg_tracks_keep_transcode_ledger on public.tracks;
create trigger trg_tracks_keep_transcode_ledger
  before insert or update on public.tracks
  for each row execute function public.tracks_keep_transcode_ledger();

-- ── 3. The one swap the service role may make ──────────────────────────────
-- Body below section marker "(unchanged)" is 20260923070000 verbatim.

create or replace function public.tracks_freeze_media()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  placeholder   constant text := 'pending://placeholder';
  bucket_prefix constant text := '/storage/v1/object/public/tracks-media/';
begin
  -- The transcoder's swap (20261115000000): the service role may replace a REAL url in
  -- our bucket with a rendition in the same <uploader>/<track>/ folder, and must record
  -- what it replaced. Any other shape falls through to the checks below and is refused —
  -- including a swap that forgets the original, moves folders, or leaves the bucket.
  if current_user = 'service_role' and new.original_media_url is not null then
    if (new.audio_url is not distinct from old.audio_url
        or (old.audio_url is not null and new.audio_url is not null
            and position(bucket_prefix in old.audio_url) > 0
            and regexp_replace(old.audio_url, '/[^/]*$', '')
              = regexp_replace(new.audio_url, '/[^/]*$', '')))
       and
       (new.video_url is not distinct from old.video_url
        or (old.video_url is not null and new.video_url is not null
            and position(bucket_prefix in old.video_url) > 0
            and regexp_replace(old.video_url, '/[^/]*$', '')
              = regexp_replace(new.video_url, '/[^/]*$', '')))
    then
      return new;
    end if;
  end if;

  -- (unchanged) `is not distinct from` rather than `=` throughout: it is NULL-safe, so
  -- an empty slot answers FALSE like any other non-match instead of poisoning the
  -- expression into NULL and skipping the raise.
  if not (
    new.audio_url is not distinct from old.audio_url
    or (old.audio_url is not distinct from placeholder
        and new.audio_url is not null
        and new.audio_url is distinct from placeholder)
  ) then
    raise exception 'tracks.audio_url is immutable once set'
      using errcode = '42501';
  end if;

  if not (
    new.video_url is not distinct from old.video_url
    or (old.video_url is not distinct from placeholder
        and new.video_url is not null
        and new.video_url is distinct from placeholder)
  ) then
    raise exception 'tracks.video_url is immutable once set'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.tracks_freeze_media() is
  'A track''s media URL is its identity. A slot may go from the upload placeholder to a '
  'real URL exactly once; every other client transition is refused, INCLUDING the first '
  'write to a slot that was left empty. One server-side exception (20261115000000): the '
  'service role may swap a real URL for a rendition in the same bucket folder while '
  'recording the replaced upload in original_media_url.';
