import { EMPTY_SONG_SECONDS, endDragTime, roomPast, songEndAt, songLength, viewFor } from '../timeline';

// 120 BPM: a beat is 0.5 s, a bar 2 s, a drum step 0.125 s.
const BPM = 120;
const BAR = 2;
const MAX = 15 * 60;

describe('song length', () => {
  it('is as long as its clips, in whole bars', () => {
    expect(songLength(7.3, true, undefined, BPM)).toBe(8);
    expect(songLength(8, true, undefined, BPM)).toBe(8);
  });

  it('is 30 seconds with no voice, until its end is dragged', () => {
    expect(EMPTY_SONG_SECONDS).toBe(30);
    expect(songLength(0, false, undefined, BPM)).toBe(30);
    expect(songLength(0, false, undefined, 92)).toBeCloseTo(12 * (240 / 92)); // whole bars: 31.3 s
    expect(songLength(0, false, 12, BPM)).toBe(12);
  });

  it('can be dragged out past the clips, never in under them', () => {
    expect(songLength(8, true, 20, BPM)).toBe(20);
    expect(songLength(8, true, 4, BPM)).toBe(8);
  });
});

describe('dragging the end of the song', () => {
  const W = 300;
  const FULL = 30;
  const VIEW = FULL + roomPast(FULL, BAR); // 37.5: the song fills four fifths of the row

  it('keeps a quarter of the song, at least a bar, free past its end', () => {
    expect(roomPast(30, BAR)).toBe(7.5);
    expect(roomPast(4, BAR)).toBe(2);
  });

  it('is the time under the finger up to the song\'s old end', () => {
    expect(endDragTime(120, W, VIEW, FULL)).toBeCloseTo(15);
    expect(endDragTime(240, W, VIEW, FULL)).toBeCloseTo(30);
  });

  it('zooms the timeline out past that, with the handle still under the finger', () => {
    for (const x of [250, 270, 290]) {
      const t = endDragTime(x, W, VIEW, FULL);
      expect(t).toBeGreaterThan(30);
      // The row then shows the same room past the handle, which puts the handle back at x.
      expect((t / viewFor(t, VIEW, FULL)) * W).toBeCloseTo(x);
    }
    expect(endDragTime(270, W, VIEW, FULL)).toBeCloseTo(67.5);
  });

  it('does not jump where the zoom starts, and stops short of the row edge', () => {
    expect(endDragTime(240.01, W, VIEW, FULL) - endDragTime(239.99, W, VIEW, FULL)).toBeLessThan(0.02);
    expect(endDragTime(5000, W, VIEW, FULL)).toBeCloseTo(endDragTime(W - 6, W, VIEW, FULL));
  });
});

describe('letting go of the end of the song', () => {
  it('past the clips: the song gets that length, in whole bars, and no trim', () => {
    expect(songEndAt(44.7, 0, 8, BPM, MAX)).toEqual({ range: { start: 0, end: 44 }, full: 44, length: 44 });
    expect(songEndAt(45.1, 0, 0, BPM, MAX)).toEqual({ range: { start: 0, end: 46 }, full: 46, length: 46 });
  });

  it('back onto the clips: nothing of its own to remember', () => {
    expect(songEndAt(8.4, 0, 8, BPM, MAX)).toEqual({ range: { start: 0, end: 8 }, full: 8, length: undefined });
  });

  it('short of the last clip: a trim on the drum grid, the song keeps its clips', () => {
    expect(songEndAt(5.07, 0, 8, BPM, MAX)).toEqual({ range: { start: 0, end: 5.125 }, full: 8, length: undefined });
  });

  it('an empty song can be made short, but never shorter than a bar or its own start', () => {
    expect(songEndAt(0.2, 0, 0, BPM, MAX).length).toBe(2);
    expect(songEndAt(1, 6.5, 0, BPM, MAX).range.end).toBe(8);
  });

  it('stops at the 15 minute limit', () => {
    expect(songEndAt(5000, 0, 8, BPM, MAX).length).toBe(900);
  });
});
