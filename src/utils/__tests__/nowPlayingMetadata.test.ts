/**
 * Characterization tests for the clip coordinate boundary.
 *
 * WHY
 *
 * Livil holds ABSOLUTE full-track seconds everywhere in JavaScript, and the lock screen is
 * CLIP-RELATIVE. These builders are the only place that translation is serialised, and what
 * they emit crosses into Kotlin (kb/architecture/playback.md, ADR-0002).
 *
 * Errors here produce a lock screen that disagrees with the app: the scrubber shows the wrong
 * duration, or a seek lands in the wrong place. That is visible to users, hard to reproduce,
 * and — because nothing throws — invisible until someone notices on a device.
 *
 * These are CHARACTERIZATION tests: they pin the behaviour that ships today so a rebase of the
 * native patch (ADR-0006's triggers) can be checked against something. They assert the
 * contract the Kotlin side depends on, notably that `clipActive` / `active` are EXPLICIT flags
 * and never inferred from `start > 0` — a clip may legitimately start at zero.
 *
 * Written under PROP-0001. No production code moved: these functions were already pure.
 */

import {
  buildCurrentClipJson,
  buildMediaQueueJson,
  buildMediaSessionStateJson,
  buildNowPlayingMetadata,
  ALBUM_DEFAULT_FOR_METADATA,
} from '../nowPlayingMetadata';
import type { NowPlayingInfo } from '../../contexts/PlaybackContext';

/** Minimal valid track. Fields under test are overridden per case. */
function track(over: Partial<NowPlayingInfo> = {}): NowPlayingInfo {
  return {
    postId: 'post-1',
    trackId: 'track-1',
    title: 'Test Title',
    artistName: 'Test Artist',
    mediaKind: 'audio',
    audioUrl: 'https://example.test/a.mp3',
    videoUrl: undefined,
    coverArtUrl: undefined,
    thumbnailUrl: undefined,
    clipStartSec: null,
    clipEndSec: null,
    ...over,
  } as NowPlayingInfo;
}

const parse = (json: string) => JSON.parse(json);

describe('buildCurrentClipJson — the absolute → clip-relative boundary', () => {
  it('reports inactive when there is no clip', () => {
    const c = parse(buildCurrentClipJson(null, 'off'));
    expect(c.active).toBe(false);
    expect(c.startMs).toBe(0);
    expect(c.endMs).toBe(0);
  });

  it('converts absolute seconds to milliseconds', () => {
    const c = parse(buildCurrentClipJson({ start: 12.5, end: 42.25 }, 'off'));
    expect(c.active).toBe(true);
    expect(c.startMs).toBe(12500);
    expect(c.endMs).toBe(42250);
  });

  it('treats a clip starting at zero as ACTIVE', () => {
    // The regression this guards: native must never infer "clipped" from start > 0.
    // A clip legitimately starting at 0 with a shortened end is still a clip, and
    // inferring otherwise makes the lock screen show the full track duration.
    const c = parse(buildCurrentClipJson({ start: 0, end: 30 }, 'off'));
    expect(c.active).toBe(true);
    expect(c.startMs).toBe(0);
    expect(c.endMs).toBe(30000);
  });

  it('rejects a zero-length window', () => {
    expect(parse(buildCurrentClipJson({ start: 10, end: 10 }, 'off')).active).toBe(false);
  });

  it('rejects an inverted window', () => {
    // end < start would produce a negative duration on the lock screen.
    expect(parse(buildCurrentClipJson({ start: 30, end: 10 }, 'off')).active).toBe(false);
  });

  it('rounds sub-millisecond precision rather than truncating', () => {
    const c = parse(buildCurrentClipJson({ start: 1.0004, end: 2.0006 }, 'off'));
    expect(c.startMs).toBe(1000);
    expect(c.endMs).toBe(2001);
  });

  it('flags repeat-one so native can loop the clip while backgrounded', () => {
    // Fabric defers view commands while backgrounded, so the loop is enforced natively.
    // This flag is how native knows to loop rather than advance.
    expect(parse(buildCurrentClipJson({ start: 1, end: 2 }, 'one')).repeatOne).toBe(true);
    expect(parse(buildCurrentClipJson({ start: 1, end: 2 }, 'all')).repeatOne).toBe(false);
    expect(parse(buildCurrentClipJson({ start: 1, end: 2 }, 'off')).repeatOne).toBe(false);
  });
});

describe('buildMediaQueueJson — the native background-skip queue', () => {
  it('preserves the queue index', () => {
    const q = parse(buildMediaQueueJson([track(), track({ postId: 'p2' })], 1));
    expect(q.index).toBe(1);
    expect(q.items).toHaveLength(2);
  });

  it('marks an unclipped track inactive with zeroed bounds', () => {
    const [item] = parse(buildMediaQueueJson([track()], 0)).items;
    expect(item.clipActive).toBe(false);
    expect(item.clipStartMs).toBe(0);
    expect(item.clipEndMs).toBe(0);
  });

  it('carries per-item clip windows in milliseconds', () => {
    const [item] = parse(
      buildMediaQueueJson([track({ clipStartSec: 5, clipEndSec: 15.5 })], 0),
    ).items;
    expect(item.clipActive).toBe(true);
    expect(item.clipStartMs).toBe(5000);
    expect(item.clipEndMs).toBe(15500);
  });

  it('requires BOTH bounds before treating a track as clipped', () => {
    // A half-specified clip is a bug upstream; native must not act on it.
    const onlyStart = parse(buildMediaQueueJson([track({ clipStartSec: 5 })], 0)).items[0];
    const onlyEnd = parse(buildMediaQueueJson([track({ clipEndSec: 15 })], 0)).items[0];
    expect(onlyStart.clipActive).toBe(false);
    expect(onlyEnd.clipActive).toBe(false);
  });

  it('prefers audioUrl over videoUrl when BOTH are present', () => {
    // The fixture must set both, or the assertion proves nothing: with videoUrl null,
    // `audioUrl ?? videoUrl` and `videoUrl ?? audioUrl` return the same value and the
    // preference order is untested. An earlier version of this test had exactly that
    // hole, and mutation-testing found it.
    const [item] = parse(
      buildMediaQueueJson(
        [track({ audioUrl: 'https://example.test/a.mp3', videoUrl: 'https://example.test/v.mp4' })],
        0,
      ),
    ).items;
    expect(item.uri).toBe('https://example.test/a.mp3');
  });

  it('falls back to videoUrl when there is no audioUrl', () => {
    // A video post has no separate audio file; the engine decodes audio from the video
    // (ADR-0001). Native must receive the video URL as the playable source.
    const [item] = parse(
      buildMediaQueueJson(
        [track({ mediaKind: 'video', audioUrl: undefined, videoUrl: 'https://example.test/v.mp4' })],
        0,
      ),
    ).items;
    expect(item.uri).toBe('https://example.test/v.mp4');
  });

  it('emits an empty queue without throwing', () => {
    const q = parse(buildMediaQueueJson([], 0));
    expect(q.items).toEqual([]);
  });
});

describe('buildMediaSessionStateJson', () => {
  it('round-trips repeat and shuffle for external controllers', () => {
    // Consumed by car head units, Wear OS and Assistant via the MediaSession.
    expect(parse(buildMediaSessionStateJson('one', true))).toEqual({
      repeatMode: 'one',
      shuffleEnabled: true,
    });
    expect(parse(buildMediaSessionStateJson('off', false))).toEqual({
      repeatMode: 'off',
      shuffleEnabled: false,
    });
  });
});

describe('buildNowPlayingMetadata', () => {
  it('falls back to the default album label only for the lock screen', () => {
    // ALBUM_DEFAULT_FOR_METADATA must never leak into in-app UI — it exists so the
    // notification does not show an empty album line.
    const m = buildNowPlayingMetadata(track());
    expect(m.album).toBe(ALBUM_DEFAULT_FOR_METADATA);
  });

  it('carries title and artist through unchanged', () => {
    const m = buildNowPlayingMetadata(track({ title: 'Real', artistName: 'Someone' }));
    expect(m.title).toBe('Real');
    expect(m.artist).toBe('Someone');
  });
});
