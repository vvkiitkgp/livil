#!/usr/bin/env node
// ============================================================================
// transcode-media — swap heavy uploads for streaming-friendly renditions (ADR-0033)
// ============================================================================
//
// Runs on GitHub Actions (.github/workflows/transcode-media.yml) against production as the
// service role. Uploads are raw phone recordings — a 4K 60 fps HEVC video at 38 Mbit/s,
// WAV songs at 1.4–2.3 Mbit/s — and a phone on 4G gets 5–20 Mbit/s, so they buffer. This
// job re-encodes the heavy ones and points the track at the lighter copy.
//
// For each track nobody has looked at yet (tracks.transcode_status IS NULL):
//   1. ffprobe the file over HTTP (reads only the header).
//   2. decide():  video → transcode unless it is already H.264, ≤1080p, ≤30 fps and
//                 ≤ VIDEO_MAX_KBPS;   audio → transcode if lossless or > AUDIO_MAX_KBPS.
//      Anything else is marked `skipped` and never looked at again.
//   3. Download, encode (video: H.264 ≤1080p 30 fps CRF 23 capped at 4 Mbit/s, the sound
//      track COPIED untouched whenever mp4 can carry it; audio: AAC 256k), and refuse the
//      result unless it is smaller and the same length as the original.
//   4. Upload it NEXT TO the original (video.h264.mp4 / audio.aac.m4a in the same
//      <uploader>/<track>/ folder), verify the bucket has every byte, then point the row
//      at it and record the upload in original_media_url. The database only lets the
//      service role make exactly that shape of swap (20261115000000). Nothing is deleted.
//
// A failure marks the row `failed` with the reason and moves on; the run then exits
// non-zero ONCE so it shows up, and the row is not retried until someone resets
// transcode_status to NULL. Rows mid-upload (the 'pending://placeholder' URL) are left
// alone for a later run.
//
// Nothing here is ever logged that could identify the key: the only secret is read from
// the environment and sent as a header.
// ============================================================================

import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'https://fqzrmqnlgjeuxzinbqvs.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = 'tracks-media';
const BUCKET_PREFIX = `/storage/v1/object/public/${BUCKET}/`;
const PLACEHOLDER = 'pending://placeholder';
const BATCH = Math.max(1, Number(process.env.TRANSCODE_BATCH ?? 20) || 20);
const PER_FILE_TIMEOUT_MS = 20 * 60_000;
// TRANSCODE_DRY_RUN=1: list, probe and decide, but download, encode, upload and write
// nothing — a report of what a real run would do. Works with a read-only key.
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.TRANSCODE_DRY_RUN ?? '');

// Rendition targets. A video over any of these limits is re-encoded; so is anything that
// is not H.264, because cheap Android phones decode HEVC in software and stutter.
export const VIDEO_MAX_LONG_EDGE = 1920;
export const VIDEO_MAX_FPS = 31;
export const VIDEO_MAX_KBPS = 6000;
export const AUDIO_MAX_KBPS = 400;
const LOSSLESS_AUDIO = /^(pcm_|flac|alac|wavpack|ape|tta|truehd|mlp)/;
// Sound tracks mp4 can carry as-is. Anything else (PCM in a .mov, Opus in a .webm) is
// encoded to AAC so the rendition stays one plain mp4.
const MP4_AUDIO_CODECS = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac']);

const VIDEO_RENDITION = { file: 'video.h264.mp4', mime: 'video/mp4' };
const AUDIO_RENDITION = { file: 'audio.aac.m4a', mime: 'audio/mp4' };

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** The file this track plays, or null when it is not an upload of ours (Spotify reposts). */
export function mediaUrlOf(track) {
  const url = track.media_kind === 'video' ? track.video_url : track.audio_url;
  if (!url || url === PLACEHOLDER || !url.includes(BUCKET_PREFIX)) { return null; }
  return url;
}

/** Same folder, different last segment — the only swap the database accepts. */
export function renditionUrl(url, kind) {
  const file = kind === 'video' ? VIDEO_RENDITION.file : AUDIO_RENDITION.file;
  return url.replace(/\/[^/]*$/, `/${file}`);
}

/** The object key inside the bucket for a public URL. */
export function objectKeyOf(url) {
  const i = url.indexOf(BUCKET_PREFIX);
  return i < 0 ? null : decodeURIComponent(url.slice(i + BUCKET_PREFIX.length));
}

function fpsOf(stream) {
  const [n, d] = String(stream?.r_frame_rate ?? '0/1').split('/').map(Number);
  return d ? n / d : 0;
}

/** Overall kbit/s from the container, falling back to size ÷ duration. */
export function kbpsOf(probe) {
  const fmt = probe?.format ?? {};
  const bitRate = Number(fmt.bit_rate);
  if (bitRate > 0) { return bitRate / 1000; }
  const size = Number(fmt.size);
  const dur = Number(fmt.duration);
  return size > 0 && dur > 0 ? (size * 8) / 1000 / dur : 0;
}

/**
 * What to do with a probed file: { action: 'skip' | 'video' | 'audio', reason, copyAudio? }.
 * Pure — the tests feed it ffprobe JSON.
 */
export function decide(kind, probe) {
  const streams = probe?.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !isCoverArt(s));
  const audio = streams.find((s) => s.codec_type === 'audio');
  const kbps = kbpsOf(probe);

  if (kind === 'video') {
    if (!video) { return { action: 'skip', reason: 'no video stream' }; }
    const longEdge = Math.max(Number(video.width) || 0, Number(video.height) || 0);
    const fps = fpsOf(video);
    const reasons = [];
    if (video.codec_name !== 'h264') { reasons.push(`codec ${video.codec_name}`); }
    if (longEdge > VIDEO_MAX_LONG_EDGE) { reasons.push(`${video.width}x${video.height}`); }
    if (fps > VIDEO_MAX_FPS) { reasons.push(`${Math.round(fps)} fps`); }
    if (kbps > VIDEO_MAX_KBPS) { reasons.push(`${Math.round(kbps)} kbit/s`); }
    if (reasons.length === 0) { return { action: 'skip', reason: 'already streams well' }; }
    return {
      action: 'video',
      reason: reasons.join(', '),
      copyAudio: !!audio && MP4_AUDIO_CODECS.has(audio.codec_name),
      hasAudio: !!audio,
    };
  }

  if (!audio) { return { action: 'skip', reason: 'no audio stream' }; }
  const reasons = [];
  if (LOSSLESS_AUDIO.test(audio.codec_name ?? '')) { reasons.push(`lossless ${audio.codec_name}`); }
  if (kbps > AUDIO_MAX_KBPS) { reasons.push(`${Math.round(kbps)} kbit/s`); }
  if (reasons.length === 0) { return { action: 'skip', reason: 'already streams well' }; }
  return { action: 'audio', reason: reasons.join(', ') };
}

// An mp3's embedded cover is reported as a video stream (mjpeg/png, attached_pic).
function isCoverArt(stream) {
  return stream.disposition?.attached_pic === 1 || /^(mjpeg|png|bmp|gif)$/.test(stream.codec_name ?? '');
}

/** ffmpeg arguments for a rendition. Exported so the test can pin the encode settings. */
export function ffmpegArgs(decision, input, output) {
  if (decision.action === 'video') {
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', input,
      '-map', '0:v:0', '-sn', '-dn',
      ...(decision.hasAudio ? ['-map', '0:a:0'] : []),
      // Longest edge ≤ 1920 (1080x1920 portrait, 1920x1080 landscape), even dimensions,
      // 30 fps. ffmpeg applies the phone's rotation tag before scaling.
      '-vf', `scale=w='if(gt(iw,ih),min(${VIDEO_MAX_LONG_EDGE},iw),-2)':h='if(gt(iw,ih),-2,min(${VIDEO_MAX_LONG_EDGE},ih))',fps=30`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
      '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    ];
    if (decision.hasAudio) {
      args.push('-c:a', decision.copyAudio ? 'copy' : 'aac');
      if (!decision.copyAudio) { args.push('-b:a', '192k'); }
    }
    // No chapter track: a WAV's cue/LIST chunk otherwise becomes a stray text stream.
    args.push('-map_chapters', '-1', '-movflags', '+faststart', '-f', 'mp4', output);
    return args;
  }
  return [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', input, '-vn', '-sn', '-dn', '-map', '0:a:0',
    '-c:a', 'aac', '-b:a', '256k',
    '-map_chapters', '-1', '-movflags', '+faststart', '-f', 'ipod', output,
  ];
}

// ── Processes ───────────────────────────────────────────────────────────────

function run(cmd, args, { timeoutMs = PER_FILE_TIMEOUT_MS, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(out); } else { reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(-400)}`)); }
    });
  });
}

async function ffprobe(target) {
  const json = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', target,
  ], { timeoutMs: 120_000, capture: true });
  return JSON.parse(json);
}

// ── Supabase (REST, service role) ───────────────────────────────────────────

function authHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

// Thrown when the ledger columns are not in production yet (migration 20261115000000
// unapplied). The scheduled job treats it as "nothing to do yet" rather than failing
// every five minutes until someone applies it.
class LedgerMissing extends Error {}

async function listPending({ everything = false } = {}) {
  const q = new URLSearchParams({
    select: 'id,uploader_id,media_kind,audio_url,video_url,duration_seconds,created_at',
    taken_down_at: 'is.null',
    order: 'created_at.desc',
    limit: String(BATCH),
  });
  if (!everything) { q.set('transcode_status', 'is.null'); }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tracks?${q}`, { headers: { ...authHeaders(), Accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status === 400 && body.includes('42703') && body.includes('transcode_status')) {
      throw new LedgerMissing('tracks.transcode_status does not exist — migration 20261115000000 not applied yet');
    }
    throw new Error(`list tracks: HTTP ${res.status} ${body}`);
  }
  return res.json();
}

async function patchTrack(id, patch) {
  if (DRY_RUN) { console.log(`  (dry run) would set ${JSON.stringify(patch)}`); return; }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tracks?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) { throw new Error(`update track: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); }
}

async function uploadObject(key, file, mime) {
  // curl streams the file from disk; `x-upsert` lets a re-run replace a half-written copy.
  await run('curl', [
    '-sS', '--fail-with-body', '-X', 'POST',
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`,
    '-H', `Authorization: Bearer ${SERVICE_KEY}`,
    '-H', `Content-Type: ${mime}`,
    '-H', 'x-upsert: true',
    '-H', 'cache-control: max-age=3600',
    '--data-binary', `@${file}`,
    '-o', '/dev/null',
  ], { timeoutMs: 10 * 60_000 });
}

async function remoteSize(url) {
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) { throw new Error(`verify upload: HTTP ${res.status}`); }
  return Number(res.headers.get('content-length'));
}

// ── One track ───────────────────────────────────────────────────────────────

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

async function processTrack(track, workDir) {
  const tag = `track ${track.id} (${track.media_kind})`;
  const url = mediaUrlOf(track);
  if (!url) {
    const raw = track.media_kind === 'video' ? track.video_url : track.audio_url;
    if (raw === PLACEHOLDER) { console.log(`${tag}: still uploading — later`); return 'later'; }
    console.log(`${tag}: not media of ours — skipped`);
    await patchTrack(track.id, { transcode_status: 'skipped' });
    return 'skipped';
  }

  const probe = await ffprobe(url);
  const decision = decide(track.media_kind, probe);
  if (decision.action === 'skip') {
    console.log(`${tag}: ${decision.reason} — skipped`);
    await patchTrack(track.id, { transcode_status: 'skipped' });
    return 'skipped';
  }

  const originalBytes = Number(probe.format?.size) || 0;
  const originalDur = Number(probe.format?.duration) || 0;
  if (DRY_RUN) {
    console.log(`${tag}: ${decision.reason}, ${mb(originalBytes)} — would transcode (dry run)`);
    return 'done';
  }
  console.log(`${tag}: ${decision.reason}, ${mb(originalBytes)} — transcoding`);

  const src = path.join(workDir, `${track.id}.src`);
  const out = path.join(workDir, `${track.id}.${decision.action === 'video' ? 'mp4' : 'm4a'}`);
  await run('curl', ['-sS', '--fail', '-L', '-o', src, url], { timeoutMs: 10 * 60_000 });
  await run('ffmpeg', ffmpegArgs(decision, src, out));

  const outBytes = (await stat(out)).size;
  const outProbe = await ffprobe(out);
  const outDur = Number(outProbe.format?.duration) || 0;
  if (outBytes <= 0) { throw new Error('empty rendition'); }
  if (originalDur > 0 && Math.abs(outDur - originalDur) > 1.5) {
    throw new Error(`rendition is ${outDur.toFixed(1)}s, original ${originalDur.toFixed(1)}s`);
  }
  if (originalBytes > 0 && outBytes >= originalBytes) {
    console.log(`${tag}: rendition not smaller (${mb(outBytes)} vs ${mb(originalBytes)}) — skipped`);
    await patchTrack(track.id, { transcode_status: 'skipped' });
    return 'skipped';
  }

  const rendition = decision.action === 'video' ? VIDEO_RENDITION : AUDIO_RENDITION;
  const newUrl = renditionUrl(url, decision.action);
  await uploadObject(objectKeyOf(newUrl), out, rendition.mime);
  const stored = await remoteSize(newUrl);
  if (stored !== outBytes) { throw new Error(`bucket has ${stored} bytes, rendition is ${outBytes}`); }

  const urlColumn = decision.action === 'video' ? 'video_url' : 'audio_url';
  await patchTrack(track.id, {
    [urlColumn]: newUrl,
    original_media_url: url,
    file_size_bytes: outBytes,
    transcode_status: 'done',
    transcoded_at: new Date().toISOString(),
    transcode_error: null,
  });
  console.log(`${tag}: done — ${mb(originalBytes)} → ${mb(outBytes)}`);
  return 'done';
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!SERVICE_KEY) {
    console.log('::notice::SUPABASE_SERVICE_ROLE_KEY is not set — nothing to do');
    return 0;
  }
  let tracks;
  try {
    tracks = await listPending();
  } catch (e) {
    if (!(e instanceof LedgerMissing)) { throw e; }
    if (!DRY_RUN) { console.log(`::warning::${e.message} — nothing to do`); return 0; }
    // A dry run can still say what it WOULD do: look at every live track instead.
    console.log(`${e.message}; dry run looks at every track instead`);
    tracks = await listPending({ everything: true });
  }
  if (tracks.length === 0) { console.log('nothing pending'); return 0; }
  console.log(`${tracks.length} track(s) to look at`);

  const workDir = await mkdtemp(path.join(tmpdir(), 'transcode-'));
  const tally = { done: 0, skipped: 0, later: 0, failed: 0 };
  try {
    for (const track of tracks) {
      try {
        tally[await processTrack(track, workDir)] += 1;
      } catch (e) {
        tally.failed += 1;
        const message = String(e?.message ?? e).slice(0, 500);
        console.log(`::error::track ${track.id}: ${message}`);
        await patchTrack(track.id, { transcode_status: 'failed', transcode_error: message }).catch((e2) => {
          console.log(`::error::track ${track.id}: could not record the failure: ${String(e2?.message ?? e2).slice(0, 200)}`);
        });
      } finally {
        await rm(path.join(workDir, `${track.id}.src`), { force: true });
        await rm(path.join(workDir, `${track.id}.mp4`), { force: true });
        await rm(path.join(workDir, `${track.id}.m4a`), { force: true });
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  console.log(`done ${tally.done}, skipped ${tally.skipped}, later ${tally.later}, failed ${tally.failed}`);
  return tally.failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.log(`::error::${String(e?.message ?? e).slice(0, 500)}`);
    process.exitCode = 1;
  });
}
