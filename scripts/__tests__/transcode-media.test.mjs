// The transcoder's decisions (scripts/transcode-media.mjs, ADR-0033), pinned on ffprobe
// shapes seen in production. Runs with Node's own runner — Jest ignores .mjs on purpose:
//
//     node --test scripts/__tests__/transcode-media.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, ffmpegArgs, kbpsOf, mediaUrlOf, objectKeyOf, renditionUrl,
  AUDIO_MAX_KBPS, VIDEO_MAX_KBPS,
} from '../transcode-media.mjs';

const FOLDER = 'https://fqzrmqnlgjeuxzinbqvs.supabase.co/storage/v1/object/public/tracks-media/'
  + '89673b62-c2d8-4922-ac36-1045ff88ce20/3652bac5-53f4-444d-bc6c-ee3d1370364a/';

const probe = ({ video, audio, format = {} }) => ({
  streams: [
    ...(video ? [{ codec_type: 'video', ...video }] : []),
    ...(audio ? [{ codec_type: 'audio', ...audio }] : []),
  ],
  format,
});

// The 2026-10-26 upload that started this: 2160x3840, 60 fps, HEVC, 38 Mbit/s.
const PHONE_4K = probe({
  video: { codec_name: 'hevc', width: 2160, height: 3840, r_frame_rate: '60/1' },
  audio: { codec_name: 'aac', bit_rate: '104988' },
  format: { bit_rate: '38106749', size: '126729750', duration: '26.606' },
});

test('a 4K 60 fps HEVC phone video is transcoded and its sound track copied', () => {
  const d = decide('video', PHONE_4K);
  assert.equal(d.action, 'video');
  assert.equal(d.copyAudio, true);
  assert.equal(d.hasAudio, true);
  assert.match(d.reason, /hevc/);
  assert.match(d.reason, /2160x3840/);
  assert.match(d.reason, /60 fps/);
});

test('a 1080p 30 fps H.264 video under the bitrate cap is left alone', () => {
  const d = decide('video', probe({
    video: { codec_name: 'h264', width: 1080, height: 1920, r_frame_rate: '30/1' },
    audio: { codec_name: 'aac' },
    format: { bit_rate: String(4_000_000), size: '1', duration: '1' },
  }));
  assert.equal(d.action, 'skip');
});

test('H.264 at 15 Mbit/s is transcoded for its bitrate alone', () => {
  const d = decide('video', probe({
    video: { codec_name: 'h264', width: 1080, height: 1920, r_frame_rate: '30/1' },
    audio: { codec_name: 'aac' },
    format: { bit_rate: String(15_297_000) },
  }));
  assert.equal(d.action, 'video');
  assert.match(d.reason, /15297 kbit\/s/);
});

test('bitrate falls back to size ÷ duration when the container reports none', () => {
  assert.equal(Math.round(kbpsOf({ format: { size: String(70_700_000), duration: '37' } })), 15286);
  assert.equal(kbpsOf({ format: {} }), 0);
  const d = decide('video', probe({
    video: { codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30000/1001' },
    audio: { codec_name: 'aac' },
    format: { size: String(VIDEO_MAX_KBPS * 1000 / 8 * 10 * 1.01), duration: '10' },
  }));
  assert.equal(d.action, 'video');
});

test('a sound track mp4 cannot carry (PCM in a .mov) is re-encoded to AAC, not copied', () => {
  const d = decide('video', probe({
    video: { codec_name: 'hevc', width: 1920, height: 1080, r_frame_rate: '30/1' },
    audio: { codec_name: 'pcm_s16le' },
    format: { bit_rate: '20000000' },
  }));
  assert.equal(d.action, 'video');
  assert.equal(d.copyAudio, false);
  const args = ffmpegArgs(d, 'in.mov', 'out.mp4');
  assert.ok(args.includes('aac') && args.includes('192k'));
});

test('a silent video gets no audio map', () => {
  const d = decide('video', probe({
    video: { codec_name: 'hevc', width: 1920, height: 1080, r_frame_rate: '30/1' },
    format: { bit_rate: '20000000' },
  }));
  assert.equal(d.hasAudio, false);
  const args = ffmpegArgs(d, 'in.mov', 'out.mp4');
  assert.ok(!args.includes('0:a:0'));
  assert.ok(!args.includes('-c:a'));
});

test('video rendition settings: longest edge 1920, 30 fps, H.264 high 4.1, faststart, plain mp4', () => {
  const args = ffmpegArgs(decide('video', PHONE_4K), 'in.mov', 'out.mp4');
  assert.equal(args.at(-1), 'out.mp4');
  assert.ok(args.includes('-f') && args[args.indexOf('-f') + 1] === 'mp4');
  assert.match(args[args.indexOf('-vf') + 1], /min\(1920,iw\)/);
  assert.match(args[args.indexOf('-vf') + 1], /fps=30$/);
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.equal(args[args.indexOf('-maxrate') + 1], '4M');
  assert.equal(args[args.indexOf('-movflags') + 1], '+faststart');
  assert.ok(args.includes('-nostdin'));
});

test('a WAV song is transcoded to AAC 256k in an m4a', () => {
  const d = decide('audio', probe({
    audio: { codec_name: 'pcm_s16le', sample_rate: '44100' },
    format: { bit_rate: '1411200', size: '34000000', duration: '192' },
  }));
  assert.equal(d.action, 'audio');
  assert.match(d.reason, /lossless pcm_s16le/);
  const args = ffmpegArgs(d, 'in.wav', 'out.m4a');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.equal(args[args.indexOf('-b:a') + 1], '256k');
  assert.equal(args[args.indexOf('-f') + 1], 'ipod');
  assert.ok(args.includes('-vn'));
  // One audio stream and nothing else — no chapter/text track riding along.
  assert.equal(args[args.indexOf('-map_chapters') + 1], '-1');
});

test('a 320k mp3 with embedded cover art is left alone', () => {
  const d = decide('audio', {
    streams: [
      { codec_type: 'audio', codec_name: 'mp3', bit_rate: '320000' },
      { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } },
    ],
    format: { bit_rate: '321000', size: '6800000', duration: '170' },
  });
  assert.equal(d.action, 'skip');
});

test(`lossy audio above ${AUDIO_MAX_KBPS} kbit/s is still transcoded`, () => {
  const d = decide('audio', probe({ audio: { codec_name: 'aac' }, format: { bit_rate: '512000' } }));
  assert.equal(d.action, 'audio');
});

test('only uploads in our bucket are media of ours', () => {
  assert.equal(mediaUrlOf({ media_kind: 'video', video_url: `${FOLDER}video.mov` }), `${FOLDER}video.mov`);
  assert.equal(mediaUrlOf({ media_kind: 'audio', audio_url: `${FOLDER}audio.wav` }), `${FOLDER}audio.wav`);
  assert.equal(mediaUrlOf({ media_kind: 'audio', audio_url: 'pending://placeholder' }), null);
  assert.equal(mediaUrlOf({ media_kind: 'audio', audio_url: null }), null);
  assert.equal(mediaUrlOf({ media_kind: 'audio', audio_url: 'https://open.spotify.com/track/x' }), null);
  // A video track's audio_url is not what it plays.
  assert.equal(mediaUrlOf({ media_kind: 'video', video_url: null, audio_url: `${FOLDER}audio.wav` }), null);
});

test('the rendition lives next to the original, which is what the database checks', () => {
  assert.equal(renditionUrl(`${FOLDER}video.mov`, 'video'), `${FOLDER}video.h264.mp4`);
  assert.equal(renditionUrl(`${FOLDER}audio.wav`, 'audio'), `${FOLDER}audio.aac.m4a`);
  assert.equal(
    objectKeyOf(`${FOLDER}video.h264.mp4`),
    '89673b62-c2d8-4922-ac36-1045ff88ce20/3652bac5-53f4-444d-bc6c-ee3d1370364a/video.h264.mp4',
  );
  assert.equal(objectKeyOf('https://evil.example/video.mp4'), null);
});
