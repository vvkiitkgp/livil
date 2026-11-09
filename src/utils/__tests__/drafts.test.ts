import { decodeWav16, encodeWav16, toBase64 } from '../audioFile/wav';
import {
  DRAFT_SCHEMA_VERSION,
  isSafeDraftPath,
  isSafeId,
  parseDraftFile,
  parseUploadDraftFile,
  storedFileName,
  summaryOf,
  toDraftFile,
  UPLOAD_DRAFT_SCHEMA_VERSION,
} from '../../screens/studio/draftFormat';
import type { Project, VoiceLane } from '../../screens/studio/studioEngine';
import { DEFAULT_FX } from '../audioFx/effects';
import { emptyPattern } from '../drums';

describe('wav', () => {
  it('round-trips a take within 16-bit precision', () => {
    const x = new Float32Array(4800).map((_, i) => 0.8 * Math.sin(i / 7));
    const { samples, sampleRate } = decodeWav16(encodeWav16(x, 48000));
    expect(sampleRate).toBe(48000);
    expect(samples).toHaveLength(x.length);
    for (let i = 0; i < x.length; i += 97) expect(samples[i]).toBeCloseTo(x[i], 4);
  });

  it('writes a standard RIFF/WAVE header', () => {
    const b = encodeWav16(new Float32Array(10), 44100);
    expect(String.fromCharCode(...b.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...b.slice(8, 12))).toBe('WAVE');
    expect(b.length).toBe(44 + 20);
  });

  it('base64 matches Node, whole and in slices', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 255);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    // How studioFiles.writeBytes appends: slices that start on a multiple of 3.
    const joined = Buffer.concat([0, 300, 999].map((at, i, a) => Buffer.from(toBase64(bytes, at, a[i + 1] ?? 1000), 'base64')));
    expect(Array.from(joined)).toEqual(Array.from(bytes));
  });
});

const lane = (id: string, raw: Float32Array, original: Float32Array, tuned: Float32Array | null): VoiceLane => ({
  id, name: id, start: 0, trimStart: 0, trimEnd: 1, loops: 1, volume: 1, level: 1.5, tuneOn: !!tuned,
  fx: { ...DEFAULT_FX, reverb: { ...DEFAULT_FX.reverb } },
  take: { id: `${id}t`, sampleRate: 48000, raw, tuned, original, tune: { key: null, strength: 0.7, clean: raw !== original } },
});

describe('draft file', () => {
  const orig = new Float32Array(10);
  const project: Project = {
    voices: [lane('v1', orig, orig, null), lane('v2', new Float32Array(5), new Float32Array(5), new Float32Array(5))],
    drumsOn: true, pattern: emptyPattern(), drumVolume: 0.9, masterVolume: 1.5, bpm: 92, range: { start: 1, end: 9 },
    synths: [{ id: 's1', sound: 'pad', key: { tonic: 3, mode: 'minor' }, volume: 0.8, chords: 'pop', notes: [{ step: 4, degree: 2, len: 2 }] }],
  };
  const meta = { id: 'dabc', title: 'Late night', createdAt: '2026-10-31T10:00:00Z', updatedAt: '2026-10-31T11:00:00Z', durationSec: 8 };

  it('stores each distinct take version once, at safe relative paths', () => {
    const { file, audio } = toDraftFile(project, meta);
    expect(audio).toHaveLength(1 + 3); // v1: raw === original; v2: original, raw, tuned
    expect(audio.every(a => isSafeDraftPath(a.path))).toBe(true);
    expect(file.project.voices[0].take.files.raw).toBe(file.project.voices[0].take.files.original);
    expect(JSON.stringify(file)).not.toContain('"0":'); // no sample data in the JSON
  });

  it('reads back what it wrote, keeping the settings', () => {
    const { file } = toDraftFile(project, meta);
    const back = parseDraftFile(JSON.stringify(file));
    expect(back?.project.range).toEqual({ start: 1, end: 9 });
    expect(back && summaryOf(back)).toEqual({ id: 'dabc', title: 'Late night', updatedAt: meta.updatedAt, durationSec: 8, voiceCount: 2, instrumentCount: 1 });
  });

  it('keeps synth parts, and opens drafts saved before instruments existed', () => {
    const { file } = toDraftFile(project, meta);
    expect(parseDraftFile(JSON.stringify(file))?.project.synths).toEqual(project.synths);
    const old = JSON.parse(JSON.stringify(file));
    delete old.project.synths;
    expect(parseDraftFile(JSON.stringify(old))?.project.synths).toEqual([]);
    expect(parseDraftFile(JSON.stringify(file))?.project.masterVolume).toBe(1.5);
    delete old.project.masterVolume;
    expect(parseDraftFile(JSON.stringify(old))?.project.masterVolume).toBe(1);
  });

  it('opens a draft saved with reverb on with it off (Reverb left the Editor), settings kept', () => {
    const wet = { ...project, voices: project.voices.map(v => ({ ...v, fx: { pitch: 3, reverb: { on: true, size: 0.8, mix: 0.4 } } })) };
    const back = parseDraftFile(JSON.stringify(toDraftFile(wet, meta).file));
    expect(back?.project.voices.map(v => v.fx)).toEqual(wet.voices.map(() => ({ pitch: 3, reverb: { on: false, size: 0.8, mix: 0.4 } })));
  });

  it('refuses a draft that points outside its folder or is from another version', () => {
    const { file } = toDraftFile(project, meta);
    const evil = JSON.parse(JSON.stringify(file));
    evil.project.voices[0].take.files.raw = '../../other-user/x.wav';
    expect(parseDraftFile(JSON.stringify(evil))).toBeNull();
    const abs = JSON.parse(JSON.stringify(file));
    abs.project.voices[1].take.files.tuned = '/var/mobile/secret.wav';
    expect(parseDraftFile(JSON.stringify(abs))).toBeNull();
    expect(parseDraftFile(JSON.stringify({ ...file, schemaVersion: DRAFT_SCHEMA_VERSION + 1 }))).toBeNull();
    expect(parseDraftFile('not json')).toBeNull();
  });

  it('ids are plain names, never paths', () => {
    expect(isSafeId('d1abc')).toBe(true);
    expect(isSafeId('../x')).toBe(false);
    expect(isSafeId('a/b')).toBe(false);
    expect(isSafeId('')).toBe(false);
  });
});

describe('draft names', () => {
  const { clock12, displayTitle } = require('../../screens/studio/draftFormat');
  it('reads times on a 12-hour clock', () => {
    expect(clock12(0, 59)).toBe('12:59 am');
    expect(clock12(12, 5)).toBe('12:05 pm');
    expect(clock12(23, 40)).toBe('11:40 pm');
    expect(displayTitle('Draft · 2 Nov, 0:59')).toBe('Draft · 2 Nov, 12:59 am');
    expect(displayTitle('Draft · 2 Nov, 12:59 am')).toBe('Draft · 2 Nov, 12:59 am');
    expect(displayTitle('Late night')).toBe('Late night');
  });
});

describe('upload draft format', () => {
  const pick = (file: string) => ({ file, name: 'a.mov', type: 'video/quicktime', size: 10 });
  const good = () => ({
    schemaVersion: UPLOAD_DRAFT_SCHEMA_VERSION,
    kind: 'upload',
    id: 'draft1',
    title: 'Song',
    createdAt: '2026-11-06T06:00:00.000Z',
    updatedAt: '2026-11-06T06:00:00.000Z',
    durationSec: 35,
    form: {
      mode: 'video',
      description: '',
      tags: ['a'],
      uploaderRoles: ['Guitar'],
      collaborators: [],
      album: null,
      media: pick('media-abc.mov'),
      picture: null,
    },
  });
  const withForm = (form: object) => JSON.stringify({ ...good(), form: { ...good().form, ...form } });

  it('reads back a good file', () => {
    expect(parseUploadDraftFile(JSON.stringify(good()))?.form.media?.file).toBe('media-abc.mov');
  });

  it.each(['../media-abc.mov', '/etc/passwd', 'media-a/b.mov', 'other.mov', 'media-..'])(
    'refuses a file path that could leave the draft: %s',
    file => {
      expect(parseUploadDraftFile(withForm({ media: pick(file) }))).toBeNull();
    },
  );

  it('refuses what this build cannot open', () => {
    expect(parseUploadDraftFile('not json')).toBeNull();
    expect(parseUploadDraftFile(JSON.stringify({ ...good(), schemaVersion: 99 }))).toBeNull();
    expect(parseUploadDraftFile(JSON.stringify({ ...good(), kind: 'editor' }))).toBeNull();
    expect(parseUploadDraftFile(JSON.stringify({ ...good(), id: '../x' }))).toBeNull();
    expect(parseUploadDraftFile(withForm({ mode: 'gif' }))).toBeNull();
  });

  it('drops malformed fields rather than passing them to the form', () => {
    const d = parseUploadDraftFile(withForm({ tags: ['ok', 3], album: { id: 7 }, collaborators: 'x', description: 5 }));
    expect(d?.form).toMatchObject({ tags: ['ok'], album: null, collaborators: [], description: '' });
  });

  it('names a stored file safely, keeping a sensible extension only', () => {
    expect(storedFileName('media', 'IMG_5632.mov', 'u1')).toBe('media-u1.mov');
    expect(storedFileName('picture', null, 'u1')).toBe('picture-u1');
    expect(storedFileName('media', 'evil.../../x', 'u1')).toBe('media-u1');
  });
});
