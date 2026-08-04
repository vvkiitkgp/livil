/**
 * Clip-window clamping, shared by both clients.
 *
 * Clip bounds are ABSOLUTE full-track seconds everywhere in Livil: the player always loads
 * the whole track and only the lock screen translates to clip-relative. A bad window written
 * here does not fail loudly — it desynchronises the in-app position from the notification,
 * which is exactly the class of bug ADR-0002 and the clip-forwarding work were about.
 */
import {
  clampClip,
  MIN_CLIP_SECONDS,
} from '../../../shared/services/publishTrack';

describe('clampClip — refuses windows that are not clips', () => {
  it('returns null when no clip was requested', () => {
    expect(clampClip(null, 200)).toBeNull();
    expect(clampClip(undefined, 200)).toBeNull();
  });

  it('returns null for a window shorter than the minimum', () => {
    expect(clampClip({ startSec: 10, endSec: 10 + MIN_CLIP_SECONDS / 2 }, 200)).toBeNull();
  });

  it('returns null for an inverted window', () => {
    expect(clampClip({ startSec: 90, endSec: 30 }, 200)).toBeNull();
  });

  it('returns null for non-finite bounds', () => {
    expect(clampClip({ startSec: NaN, endSec: 30 }, 200)).toBeNull();
    expect(clampClip({ startSec: 0, endSec: Infinity }, 200)).toBeNull();
  });

  it('returns null when the window covers the whole track', () => {
    // Storing a full-track "clip" would make every consumer translate coordinates for a
    // window that changes nothing.
    expect(clampClip({ startSec: 0, endSec: 200 }, 200)).toBeNull();
    expect(clampClip({ startSec: -5, endSec: 500 }, 200)).toBeNull();
  });
});

describe('clampClip — keeps a real window inside the track', () => {
  it('passes a valid window through unchanged', () => {
    expect(clampClip({ startSec: 30, endSec: 45 }, 200)).toEqual({
      startSec: 30,
      endSec: 45,
    });
  });

  it('clamps a negative start to zero', () => {
    expect(clampClip({ startSec: -10, endSec: 45 }, 200)).toEqual({
      startSec: 0,
      endSec: 45,
    });
  });

  it('clamps an end past the track to the duration', () => {
    expect(clampClip({ startSec: 150, endSec: 900 }, 200)).toEqual({
      startSec: 150,
      endSec: 200,
    });
  });

  it('accepts a window when the duration is unknown', () => {
    // Duration is optional on the row and backfills on first play, so an unreadable file
    // must not silently discard the artist's chosen excerpt.
    expect(clampClip({ startSec: 10, endSec: 25 }, null)).toEqual({
      startSec: 10,
      endSec: 25,
    });
  });

  it('drops a window that clamping collapsed below the minimum', () => {
    // start is inside the track but the end clamps back to nearly the same point.
    expect(clampClip({ startSec: 199.5, endSec: 400 }, 200)).toBeNull();
  });
});
