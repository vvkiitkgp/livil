import {
  decorativeAt,
  decorativeBars,
  ghostWindow,
  barsAreaFor,
  scrubTarget,
  slideWindowTo,
  moveClipEnd,
} from '../WaveformScrubber';

describe('slideWindowTo', () => {
  const DUR = 200;
  const STORY_CAP = 10;

  /**
   * A story clip is pinned at its 10s cap, so the left handle POSITIONS the
   * window rather than resizing it. Resizing cannot work at the cap: the resize
   * clamp holds start at `end - 10`, so dragging left moves nothing and the
   * handle reads as broken. These pin the positioning model instead.
   */
  it('carries the whole window when dragged left at max length', () => {
    expect(slideWindowTo(40, STORY_CAP, DUR)).toEqual([40, 50]);
    // Same window, dragged further left — it travels, it does not shrink.
    expect(slideWindowTo(25, STORY_CAP, DUR)).toEqual([25, 35]);
  });

  it('holds the length exactly, in both directions', () => {
    for (const raw of [0, 3, 77.5, 190]) {
      const [s, e] = slideWindowTo(raw, STORY_CAP, DUR);
      expect(e - s).toBeCloseTo(STORY_CAP);
    }
  });

  it('stops at the start of the song instead of going negative', () => {
    expect(slideWindowTo(-40, STORY_CAP, DUR)).toEqual([0, 10]);
  });

  it('stops at the end of the song instead of running past it', () => {
    expect(slideWindowTo(999, STORY_CAP, DUR)).toEqual([190, 200]);
  });

  it('positions a shorter window too — the handle never resizes in slide mode', () => {
    expect(slideWindowTo(100, 6, DUR)).toEqual([100, 106]);
  });
});

describe('moveClipEnd', () => {
  const DUR = 200;
  const CAP = 10;
  const MIN = 1;

  it('carries the whole window when pushed right at the cap', () => {
    // 50–60 is already the full 10s. Pushing the end to 65 must move the window
    // to 55–65, not stretch it to 50–65.
    expect(moveClipEnd(65, 50, DUR, MIN, CAP)).toEqual([55, 65]);
  });

  it('still GROWS while there is room under the cap', () => {
    // 50–54 has room; the end just extends and the start stays put.
    expect(moveClipEnd(58, 50, DUR, MIN, CAP)).toEqual([50, 58]);
  });

  it('grows to the cap and then carries, in one continuous drag', () => {
    expect(moveClipEnd(60, 50, DUR, MIN, CAP)).toEqual([50, 60]);   // exactly at cap
    expect(moveClipEnd(61, 50, DUR, MIN, CAP)).toEqual([51, 61]);   // one past → carries
  });

  it('can still SHRINK a story below its cap', () => {
    // The reason the right handle cannot just always slide.
    expect(moveClipEnd(55, 50, DUR, MIN, CAP)).toEqual([50, 55]);
  });

  it('honours the minimum length', () => {
    expect(moveClipEnd(10, 50, DUR, MIN, CAP)).toEqual([50, 51]);
  });

  it('stops at the end of the song instead of running past it', () => {
    expect(moveClipEnd(999, 150, DUR, MIN, CAP)).toEqual([190, 200]);
  });

  it('never carries when there is no cap — that is plain resizing', () => {
    expect(moveClipEnd(180, 50, DUR, MIN, undefined)).toEqual([50, 180]);
  });
});

describe('scrubTarget', () => {
  const BARS = 200;   // px
  const SPAN = 60;    // seconds visible

  it('is RELATIVE — a touch that has not moved changes nothing', () => {
    // The defining property. An absolute (seek-bar) mapping would jump playback
    // to wherever the finger landed the instant it touched down.
    expect(scrubTarget(0, BARS, SPAN, 12.5)).toBe(12.5);
  });

  it('moves playback by the distance swiped, from wherever it was', () => {
    // Half the bar width swiped right → half the visible span later.
    expect(scrubTarget(BARS / 2, BARS, SPAN, 10)).toBeCloseTo(40);
    // Same swipe from a different starting position moves by the same amount.
    expect(scrubTarget(BARS / 2, BARS, SPAN, 0)).toBeCloseTo(30);
  });

  it('swipes backwards as readily as forwards', () => {
    expect(scrubTarget(-BARS / 4, BARS, SPAN, 40)).toBeCloseTo(25);
  });

  it('scales with the zoom, so a swipe crosses the VIEW not the song', () => {
    // Identical gesture, zoomed into a 10s clip: it moves 10s, not 60s.
    expect(scrubTarget(BARS, BARS, 10, 0)).toBeCloseTo(10);
    expect(scrubTarget(BARS, BARS, SPAN, 0)).toBeCloseTo(60);
  });

  it('holds position rather than dividing by zero before layout', () => {
    expect(scrubTarget(500, 0, SPAN, 7)).toBe(7);
  });
});

describe('barsAreaFor', () => {
  // Regression: sizing the bars to the purple BOX rather than to the view once
  // shipped, and it cut the feed's repost card down to showing only the clip —
  // the whole point of that card is the clip's slice of the WHOLE song.
  it('proportional draws the bars edge to edge, ignoring where the box sits', () => {
    const narrowBox = barsAreaFor(false, 300, 120, 180);
    const wideBox = barsAreaFor(false, 300, 0, 300);
    expect(narrowBox).toEqual(wideBox);
    expect(narrowBox).toEqual({ left: 10, width: 280 });
  });

  it('anchored draws the bars inside the box, leaving the gutters for ghosts', () => {
    expect(barsAreaFor(true, 300, 40, 260)).toEqual({ left: 50, width: 200 });
  });

  it('never returns a negative width when the box is degenerate', () => {
    expect(barsAreaFor(true, 300, 140, 145).width).toBe(0);
    expect(barsAreaFor(false, 8, 0, 8).width).toBe(0);
  });
});

describe('ghostWindow', () => {
  const DUR = 200;

  it('is EMPTY on the left when the clip starts at 0:00', () => {
    // The blank gutter is the signal that there is no song before this point.
    expect(ghostWindow(0, 40, DUR, 'left')).toBeNull();
  });

  it('is EMPTY on the right when the clip ends at the track end', () => {
    expect(ghostWindow(160, DUR, DUR, 'right')).toBeNull();
  });

  it('previews the audio immediately outside the clip, on both sides', () => {
    // 100s clip → 12s of preview each way.
    expect(ghostWindow(50, 150, DUR, 'left')).toEqual({ from: 38, to: 50 });
    expect(ghostWindow(50, 150, DUR, 'right')).toEqual({ from: 150, to: 162 });
  });

  it('never previews past the ends of the track', () => {
    const l = ghostWindow(5, 105, DUR, 'left');
    expect(l?.from).toBe(0);
    const r = ghostWindow(100, 195, DUR, 'right');
    expect(r?.to).toBe(DUR);
  });

  it('floors the preview so a very short clip still shows context', () => {
    // A 3s clip's 12% share is 0.36s — too little to read, so it floors at 2s.
    expect(ghostWindow(50, 53, DUR, 'left')).toEqual({ from: 48, to: 50 });
  });

  it('treats a sliver as empty rather than drawing one stray bar', () => {
    expect(ghostWindow(0.2, 40, DUR, 'left')).toBeNull();
    expect(ghostWindow(160, DUR - 0.2, DUR, 'right')).toBeNull();
  });
});

describe('decorativeBars', () => {
  it('is stable for a seed, so a track never flickers between renders', () => {
    expect(decorativeBars(0, 60, 24, 'track-a')).toEqual(decorativeBars(0, 60, 24, 'track-a'));
  });

  it('differs between tracks', () => {
    expect(decorativeBars(0, 60, 24, 'track-a')).not.toEqual(decorativeBars(0, 60, 24, 'track-b'));
  });

  it('stays inside 0..1 so bar heights can never exceed the box', () => {
    const bars = decorativeBars(0, 240, 96, 'track-c');
    expect(bars).toHaveLength(96);
    expect(bars.every(v => v >= 0 && v <= 1)).toBe(true);
  });

  /**
   * These two are the reason the shape is synthetic at all. The anchored layout
   * sells trimming as a ZOOM, and that only works if the bars are a continuous
   * function of TIME. Index them by bar number instead and every window renders
   * an identical picture, so dragging a handle would animate nothing.
   */
  it('is anchored to absolute time, not to bar index', () => {
    // The same instant sampled by two different windows must agree.
    const wide = decorativeBars(0, 100, 100, 's');    // bar i covers [i, i+1]
    const narrow = decorativeBars(50, 60, 10, 's');   // bar j covers [50+j, 51+j]
    expect(narrow[0]).toBeCloseTo(wide[50]!, 10);
    expect(narrow[9]).toBeCloseTo(wide[59]!, 10);
  });

  it('zooming a window resamples it — the picture is not window-invariant', () => {
    const before = decorativeBars(20, 80, 40, 's');
    const after = decorativeBars(20, 50, 40, 's');
    expect(after).not.toEqual(before);
  });

  it('is continuous, so the zoom stretches rather than pops', () => {
    // A tiny step in time must not produce a jump in height.
    const a = decorativeAt(42, 's');
    const b = decorativeAt(42.001, 's');
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});
