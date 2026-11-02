import {
  CHAT_MEDIA_LIFETIME_MS,
  CHAT_PHOTO_LABEL,
  CHAT_VIDEO_LABEL,
  chatMediaFrom,
  chatMediaLabel,
  chatMediaLeftMs,
  chatMediaMetadata,
  chatMediaPushText,
  formatLeft,
  randomUuid,
} from '../chatMedia';
import { __resetServerClock, noteServerTime, serverNow } from '../serverClock';

const CONV = 'c2000000-0000-0000-0000-000000000001';
const OBJECT = `${CONV}/a0000000-0000-4000-8000-000000000001.jpg`;
const PHOTO = { type: 'photo' as const, object: OBJECT, mime: 'image/jpeg', w: 1200, h: 1600, bytes: 412345 };

it('round-trips what the app sends', () => {
  expect(chatMediaFrom(chatMediaMetadata(PHOTO))).toEqual({ v: 1, ...PHOTO });
  const video = { ...PHOTO, type: 'video' as const, object: OBJECT.replace('.jpg', '.mp4'), mime: 'video/mp4', durationMs: 8000 };
  expect(chatMediaFrom(chatMediaMetadata(video))).toEqual({ v: 1, ...video });
});

it("never trusts the sender's metadata", () => {
  const good = chatMediaMetadata(PHOTO).media;
  expect(chatMediaFrom(null)).toBeNull();
  expect(chatMediaFrom({})).toBeNull();
  expect(chatMediaFrom({ media: 'x' })).toBeNull();
  expect(chatMediaFrom({ media: { ...good, type: 'gif' } })).toBeNull();
  expect(chatMediaFrom({ media: { ...good, object: `${CONV}/../x.jpg` } })).toBeNull();
  expect(chatMediaFrom({ media: { ...good, object: 'https://evil.example/x.jpg' } })).toBeNull();
  expect(chatMediaFrom({ media: { ...good, mime: 'text/html' } })).toBeNull();
  // A GIF message is not media.
  expect(chatMediaFrom({ gif: { provider: 'giphy', id: 'x', width: 1, height: 1 } })).toBeNull();
});

it('bad sizes read as unknown, not as a crash', () => {
  const good = chatMediaMetadata(PHOTO).media;
  expect(chatMediaFrom({ media: { ...good, w: -1, h: 'big', bytes: Infinity } })).toMatchObject({ w: 0, h: 0, bytes: 0 });
});

it('the labels match the database preview mapping', () => {
  expect(chatMediaLabel('photo')).toBe(CHAT_PHOTO_LABEL);
  expect(chatMediaLabel('video')).toBe(CHAT_VIDEO_LABEL);
  expect(chatMediaPushText('photo')).toBe('📷 Sent a photo');
  expect(chatMediaPushText('video')).toBe('🎬 Sent a video');
});

describe('the 20 minutes', () => {
  const sent = '2026-11-02T10:00:00.000Z';
  const t0 = Date.parse(sent);

  it('counts down from the server-stamped send time and never goes negative', () => {
    expect(chatMediaLeftMs(sent, t0)).toBe(CHAT_MEDIA_LIFETIME_MS);
    expect(chatMediaLeftMs(sent, t0 + 2_000)).toBe(CHAT_MEDIA_LIFETIME_MS - 2_000);
    expect(chatMediaLeftMs(sent, t0 + CHAT_MEDIA_LIFETIME_MS)).toBe(0);
    expect(chatMediaLeftMs(sent, t0 + 10 * 60_000)).toBe(10 * 60_000);
    expect(chatMediaLeftMs(sent, t0 + 25 * 60_000)).toBe(0);
    expect(chatMediaLeftMs('not a date', t0)).toBe(0);
  });

  it('reads like a timer, rounding the last fraction up', () => {
    expect(formatLeft(CHAT_MEDIA_LIFETIME_MS)).toBe('20:00');
    expect(formatLeft(298_000)).toBe('4:58');
    expect(formatLeft(61_000)).toBe('1:01');
    expect(formatLeft(9_200)).toBe('0:10');
    expect(formatLeft(400)).toBe('0:01');
    expect(formatLeft(0)).toBe('0:00');
  });
});

describe('serverClock', () => {
  afterEach(() => { __resetServerClock(); jest.restoreAllMocks(); });

  it('corrects for a phone clock that runs fast', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 60_000);
    // The server said 1_000_000 while the phone (a minute fast) thought 1_060_000.
    noteServerTime(new Date(1_000_000).toISOString(), 1_060_000 - 100, 1_060_000 + 100);
    expect(serverNow()).toBe(1_000_000);
  });

  it('ignores sub-second jitter', () => {
    jest.spyOn(Date, 'now').mockReturnValue(5_000_000);
    noteServerTime(new Date(5_000_000).toISOString(), 5_000_000, 5_000_000);
    noteServerTime(new Date(5_000_400).toISOString(), 5_000_000, 5_000_000);
    expect(serverNow()).toBe(5_000_000);
  });
});

it('makes v4 UUIDs the bucket accepts', () => {
  for (let i = 0; i < 50; i++) {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
