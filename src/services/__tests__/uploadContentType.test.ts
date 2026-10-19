/**
 * The content type an upload declares, and what happens when the bucket refuses it.
 *
 * PRODUCTION INCIDENT, 2026-10-11: an artist on iOS picked a WAV master and was shown
 * storage's raw "mime type audio/vnd.wave is not supported". iOS names WAV
 * `audio/vnd.wave`; the bucket allowlist listed only `audio/wav` and `audio/x-wav`; the
 * mobile client forwarded the picker's type verbatim. Nothing caught it because no WAV had
 * ever been uploaded — every audio object in production was an MP3.
 *
 * So this suite pins three things:
 *   1. the spellings each OS really produces are canonicalised before upload;
 *   2. every type a client can declare is on the allowlist the migrations build — the
 *      check that would have caught the incident, since it needs no device and no WAV;
 *   3. a refusal reaches the artist as something they can act on, not storage's text.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// `uploads.ts` reaches the document picker's native module at import time, and the
// Supabase client at module scope.
jest.mock('@react-native-documents/picker', () => ({ keepLocalCopy: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({
  SUPABASE_URL: 'https://example.test',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    storage: {
      from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }),
    },
  },
}));

import { canonicalContentType, resolveContentType } from '../../../shared/services/media';
import { __uploadFileUriWithProgressForTest, unsupportedTypeMessage, uploadTrackFile } from '../uploads';

// ── The bucket allowlist, as the migrations build it ────────────────────────
//
// Union of every MIME literal in the executable SQL of migrations that set the
// `tracks-media` allowlist. A union is right because the first sets the list and every
// later one only adds; a migration that ever REMOVES a type must update this reader.
function trackMediaAllowlist(): Set<string> {
  const dir = join(__dirname, '../../../supabase/migrations');
  const allowed = new Set<string>();
  for (const name of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, name), 'utf8')
      .split('\n')
      .map(line => line.replace(/--.*$/, ''))
      .join('\n');
    if (!/allowed_mime_types/.test(sql) || !/'tracks-media'/.test(sql)) { continue; }
    for (const m of sql.matchAll(/'((?:audio|video|image)\/[a-z0-9.+-]+)'/g)) {
      allowed.add(m[1]);
    }
  }
  return allowed;
}

describe('canonicalContentType', () => {
  it('turns the iOS name for WAV into the one the bucket was written against', () => {
    expect(canonicalContentType('wav', 'audio/vnd.wave')).toBe('audio/wav');
  });

  it.each([
    ['audio/wave', 'audio/wav'],
    ['audio/x-flac', 'audio/flac'],
    ['audio/x-aac', 'audio/aac'],
    ['audio/mp3', 'audio/mpeg'],
    ['image/jpg', 'image/jpeg'],
  ])('canonicalises %s to %s', (declared, expected) => {
    expect(canonicalContentType('bin', declared)).toBe(expected);
  });

  it('ignores case and stray whitespace in the declared type', () => {
    expect(canonicalContentType('wav', ' Audio/VND.Wave ')).toBe('audio/wav');
  });

  it('leaves a type already in canonical form alone', () => {
    expect(canonicalContentType('wav', 'audio/x-wav')).toBe('audio/x-wav');
    expect(canonicalContentType('m4a', 'audio/x-m4a')).toBe('audio/x-m4a');
  });

  it('falls back to the extension when the picker gave no type', () => {
    expect(canonicalContentType('wav', null)).toBe('audio/wav');
    expect(canonicalContentType('wav', 'application/octet-stream')).toBe('audio/wav');
  });

  it('returns null when neither the type nor the extension says anything', () => {
    expect(canonicalContentType('caf', null)).toBeNull();
  });
});

describe('resolveContentType (web) keeps its last-resort guess', () => {
  it('still guesses by kind when nothing is known', () => {
    expect(resolveContentType('audio', 'xyz', null)).toBe('audio/mpeg');
    expect(resolveContentType('audio', 'webm', null)).toBe('audio/webm');
  });

  it('canonicalises a declared alias like the mobile path does', () => {
    expect(resolveContentType('audio', 'wav', 'audio/vnd.wave')).toBe('audio/wav');
  });
});

describe('every type a client can declare is on the bucket allowlist', () => {
  const allowed = trackMediaAllowlist();

  it('read the allowlist from the migrations', () => {
    // Guards the reader itself: an empty set would make every assertion below vacuous.
    expect(allowed.has('audio/mpeg')).toBe(true);
    expect(allowed.size).toBeGreaterThan(15);
  });

  it.each([
    'mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'aiff', 'aif', 'aifc',
    'mp4', 'mov', 'mkv', 'jpg', 'jpeg', 'png', 'webp', 'heic',
  ])('a .%s file with no declared type', ext => {
    expect(allowed).toContain(canonicalContentType(ext, null));
  });

  // What the pickers and browsers actually hand over. iOS: UTType preferred MIME types.
  it.each([
    'audio/vnd.wave', 'audio/wave', 'audio/x-wav', 'audio/wav',
    'audio/mpeg', 'audio/mp3', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/x-aac',
    'audio/flac', 'audio/x-flac', 'audio/aiff', 'audio/x-aiff',
    'video/mp4', 'video/quicktime', 'image/jpeg', 'image/jpg', 'image/png', 'image/heic',
  ])('a file declared as %s', declared => {
    expect(allowed).toContain(canonicalContentType('bin', declared));
  });

  it('the bucket also takes the iOS WAV name as sent, for builds already installed', () => {
    expect(allowed).toContain('audio/vnd.wave');
  });
});

// ── The mobile upload, end to end against a fake XHR ────────────────────────

class FakeFormData {
  parts: Array<[string, unknown]> = [];
  append(name: string, value: unknown) { this.parts.push([name, value]); }
}

class FakeXHR {
  static last: FakeXHR;
  upload: { onprogress?: unknown; onloadend?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 200;
  responseText = '{}';
  body?: FakeFormData;
  open() {}
  setRequestHeader() {}
  send(body: FakeFormData) { this.body = body; FakeXHR.last = this; }
  abort() { this.onabort?.(); }
  respond(status: number, responseText: string) {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
  /** The `type` on the file part — what storage records as the object's content type. */
  get declaredType(): string | undefined {
    const file = this.body?.parts.find(([name]) => name === '')?.[1] as { type?: string } | undefined;
    return file?.type;
  }
}

describe('uploadTrackFile', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
    (global as unknown as { FormData: unknown }).FormData = FakeFormData;
  });
  afterEach(() => { jest.useRealTimers(); });

  const upload = (name: string | null, type: string | null, kind: 'audio' | 'cover' = 'audio') => {
    const done = uploadTrackFile(
      { uri: 'file:///caches/x', name, type, size: 61_000_000 },
      kind, 'track-1', 'user-1', 'token', () => {},
    );
    return done;
  };

  it('uploads an iPhone WAV as audio/wav — the incident', async () => {
    const done = upload('Manzil Mix V2.wav', 'audio/vnd.wave');
    await Promise.resolve();
    expect(FakeXHR.last.declaredType).toBe('audio/wav');
    FakeXHR.last.respond(200, '{}');
    await expect(done).resolves.toContain('user-1/track-1/audio.wav');
  });

  it('types a file the picker left untyped by its extension', async () => {
    upload('Manzil Mix V2.wav', null);
    await Promise.resolve();
    expect(FakeXHR.last.declaredType).toBe('audio/wav');
  });

  it('still lets the bucket refuse a format it does not know, rather than guessing', async () => {
    upload('memo.caf', null);
    await Promise.resolve();
    expect(FakeXHR.last.declaredType).toBe('audio/*');
  });
});

describe('a type the bucket refuses', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
    (global as unknown as { FormData: unknown }).FormData = FakeFormData;
  });
  afterEach(() => { jest.useRealTimers(); });

  it("reaches the artist as an actionable message, not storage's text", async () => {
    const done = __uploadFileUriWithProgressForTest(
      'u/t/audio.caf', 'audio', 'file:///x', 'memo.caf', 'audio/x-caf', 'token', () => {},
    );
    FakeXHR.last.respond(
      400,
      JSON.stringify({ statusCode: '415', error: 'invalid_mime_type', message: 'mime type audio/x-caf is not supported' }),
    );
    await expect(done).rejects.toThrow(unsupportedTypeMessage('audio'));
    expect(unsupportedTypeMessage('audio')).not.toMatch(/mime/i);
  });

  it('names formats that are actually accepted', () => {
    expect(unsupportedTypeMessage('audio')).toMatch(/WAV/);
    expect(unsupportedTypeMessage('video')).toMatch(/MP4/);
    expect(unsupportedTypeMessage('cover')).toMatch(/JPG/);
  });
});
