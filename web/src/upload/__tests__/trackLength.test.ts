// The length rule the studio applies at pick time (queue.ts) and again before publish
// (publish.ts): at least MIN_TRACK_SECONDS, at most MAX_TRACK_SECONDS (15 min — the
// server-side transcoder's safe zone, ADR-0033), unknown lengths let through.

import {
  MAX_TRACK_SECONDS,
  MIN_TRACK_SECONDS,
  tooLongMessage,
  tooShortMessage,
  trackLengthError,
} from '@shared/constants/media';

describe('trackLengthError', () => {
  it('lets an unknown or unreadable length through — duration backfills on first play', () => {
    expect(trackLengthError(null)).toBeNull();
    expect(trackLengthError(0)).toBeNull();
    expect(trackLengthError(Number.NaN)).toBeNull();
  });

  it('refuses anything shorter than the minimum, with the existing message', () => {
    expect(trackLengthError(MIN_TRACK_SECONDS - 0.5)).toBe(tooShortMessage(MIN_TRACK_SECONDS - 0.5));
    expect(trackLengthError(MIN_TRACK_SECONDS)).toBeNull();
  });

  it('refuses anything longer than 15 minutes', () => {
    expect(MAX_TRACK_SECONDS).toBe(15 * 60);
    expect(trackLengthError(MAX_TRACK_SECONDS)).toBeNull();
    expect(trackLengthError(MAX_TRACK_SECONDS + 1)).toBe(tooLongMessage(MAX_TRACK_SECONDS + 1));
  });

  it('accepts a normal song and a normal clip', () => {
    expect(trackLengthError(192)).toBeNull();
    expect(trackLengthError(26.6)).toBeNull();
  });
});

describe('tooLongMessage', () => {
  it('says the limit and the file length in minutes people can read', () => {
    expect(tooLongMessage(3725)).toBe('Tracks can be at most 15 minutes long — this one is 1h 2m.');
    expect(tooLongMessage(754)).toBe('Tracks can be at most 15 minutes long — this one is 12m 34s.');
    expect(tooLongMessage(900.4)).toBe('Tracks can be at most 15 minutes long — this one is 15m 0s.');
  });
});
