/**
 * Tests for the play-count model.
 *
 * WHY
 *
 * A play is the product's core metric: it drives play counts on posts and the
 * milestone notifications creators receive. A bug here produces WRONG NUMBERS WITH NO
 * VISIBLE SYMPTOM — nothing crashes, nothing errors, the counts are just quietly wrong,
 * and there is no way to reconstruct the truth afterwards.
 *
 * The model is genuinely subtle. It must distinguish:
 *   - a scroll-past (no play) from 3 seconds of listening (one play)
 *   - a pause-and-resume (still one play) from a loop (two plays)
 *   - onProgress micro-jitter from a deliberate backward seek
 *
 * `recordPlay` is mocked: this tests the ACCOUNTING, not the network call.
 */

import {
  trackPlayProgress,
  resetPlayTracking,
  clearAllPlayTracking,
} from '../playTracker';
import { recordPlay } from '../../services/posts';

jest.mock('../../services/posts', () => ({
  recordPlay: jest.fn(() => Promise.resolve()),
}));

const recorded = recordPlay as jest.MockedFunction<typeof recordPlay>;

/** Feed a sequence of positions as onProgress would. */
function play(postId: string, positions: number[]) {
  for (const p of positions) {
    trackPlayProgress(postId, p);
  }
}

beforeEach(() => {
  clearAllPlayTracking();
  recorded.mockClear();
});

describe('play counting', () => {
  it('does not count a scroll-past', () => {
    // A single onProgress tick establishes the session but accumulates nothing.
    play('post-1', [0]);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('does not count under the 3-second threshold', () => {
    play('post-1', [0, 1, 2, 2.9]);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('counts once at the threshold', () => {
    play('post-1', [0, 1, 2, 3]);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveBeenCalledWith('post-1');
  });

  it('counts a play only once no matter how long it continues', () => {
    // The regression this guards: recording on every tick past the threshold would
    // multiply every play by the length of the track.
    play('post-1', [0, 1, 2, 3, 4, 5, 10, 60, 200]);
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('accumulates only FORWARD motion', () => {
    // Total elapsed is large, but forward progress is under the threshold.
    play('post-1', [0, 1, 1, 1, 1, 2, 2, 2]);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('does not accumulate distance travelled BACKWARD within the jitter window', () => {
    // Oscillating inside the jitter window: 20 hops of 0.4s each is 8 seconds of
    // total travel, but net forward progress is only ~0.4s. Counting the absolute
    // delta rather than forward motion would record a play here — inflating counts
    // on any track whose position reporting is noisy.
    //
    // Mutation-testing found this: an earlier version asserted only the play COUNT,
    // which stayed at 1 whether or not backward travel was accumulated.
    // Each cycle steps forward 0.1s and back 0.45s. The backward hop stays inside the
    // 0.5s jitter window, so it is not a new play instance. Over 10 cycles:
    //   forward travel  = 1.0s  → correctly under the 3s threshold
    //   absolute travel = 5.5s  → would cross it if backward distance counted
    let pos = 20;
    const positions: number[] = [pos];
    for (let i = 0; i < 10; i++) {
      pos += 0.1;
      positions.push(pos);
      pos -= 0.45;
      positions.push(pos);
    }
    play('post-1', positions);
    expect(recorded).not.toHaveBeenCalled();
  });
});

describe('play instances', () => {
  it('counts a loop as a second play', () => {
    play('post-1', [0, 1, 2, 3]); //         first play recorded
    play('post-1', [0, 1, 2, 3]); // wraps → second play recorded
    expect(recorded).toHaveBeenCalledTimes(2);
  });

  it('treats pause-and-resume as ONE play', () => {
    // While paused, onProgress simply stops firing — the position does not move
    // backward, so the session must survive the gap.
    play('post-1', [0, 1, 2]);
    play('post-1', [2, 2, 2]); // paused: repeated identical positions
    play('post-1', [2.5, 3, 4]); // resumed
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('ignores micro-jitter and does not restart the instance', () => {
    // onProgress can report a slightly earlier position between frames. Treating
    // that as a loop would inflate counts on every track.
    play('post-1', [0, 1, 0.9, 1.5, 1.4, 2, 2.5, 3]);
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('treats a backward jump beyond the jitter window as a new instance', () => {
    play('post-1', [10, 11, 12, 13]); // first play
    expect(recorded).toHaveBeenCalledTimes(1);
    play('post-1', [0, 1, 2, 3]); // seek to start → second play
    expect(recorded).toHaveBeenCalledTimes(2);
  });

  it('RESETS accumulated time on a backward jump, not just the recorded flag', () => {
    // Feeding a full 3s after the seek could not distinguish the two: it reached a
    // second play either way. With carried-over accumulation, the first tick after
    // ANY backward seek records immediately with zero new listening — scrubbing back
    // and forth would farm play counts. Found by the code-reviewer.
    play('post-1', [10, 11, 12, 13]); // one play recorded
    expect(recorded).toHaveBeenCalledTimes(1);
    play('post-1', [0, 0.5]); // seek back, then only 0.5s of listening
    expect(recorded).toHaveBeenCalledTimes(1); // must NOT record again
  });
});

describe('multiple posts', () => {
  it('tracks each post independently', () => {
    play('post-1', [0, 1, 2, 3]);
    play('post-2', [0, 1]);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveBeenCalledWith('post-1');

    play('post-2', [2, 3]);
    expect(recorded).toHaveBeenCalledTimes(2);
    expect(recorded).toHaveBeenCalledWith('post-2');
  });

  it('does not leak accumulated time between posts', () => {
    play('post-1', [0, 1, 2]); // 2s, under threshold
    play('post-2', [0, 1, 2]); // 2s, under threshold
    expect(recorded).not.toHaveBeenCalled();
  });
});

describe('explicit resets', () => {
  it('resetPlayTracking starts a fresh instance for one post', () => {
    play('post-1', [0, 1, 2]);
    resetPlayTracking('post-1');
    play('post-1', [2, 3, 4]); // accumulation restarted; only 2s of forward motion
    expect(recorded).not.toHaveBeenCalled();
  });

  it('clearAllPlayTracking resets every post', () => {
    play('post-1', [0, 1, 2]);
    play('post-2', [0, 1, 2]);
    clearAllPlayTracking();
    play('post-1', [2, 3]);
    play('post-2', [2, 3]);
    expect(recorded).not.toHaveBeenCalled();
  });

  it('allows a post to be counted again after a reset', () => {
    play('post-1', [0, 1, 2, 3]);
    expect(recorded).toHaveBeenCalledTimes(1);
    resetPlayTracking('post-1');
    play('post-1', [0, 1, 2, 3]);
    expect(recorded).toHaveBeenCalledTimes(2);
  });
});

describe('failure isolation', () => {
  it('swallows a failed record rather than leaving an unhandled rejection', async () => {
    // Play counting is fire-and-forget: a failed record must never break playback
    // (kb/architecture/backend.md, fail-safe mode).
    //
    // Asserting `not.toThrow()` proved NOTHING — the rejection is asynchronous, so the
    // synchronous call returns cleanly whether or not `.catch()` exists. Removing the
    // catch left the suite green while producing an unhandled rejection, which in RN
    // dev is a redbox on a path that fires on every play. Found by the code-reviewer.
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);

    recorded.mockRejectedValueOnce(new Error('network down'));
    play('post-1', [0, 1, 2, 3]);
    await new Promise(r => setImmediate(r));

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
