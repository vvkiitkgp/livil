/** Pure timeline maths for the Editor — no audio imports, so it unit-tests. */

export type SongRange = { start: number; end: number };

/** The shortest song trim allowed: one beat. */
export const minRangeSec = (bpm: number) => 60 / bpm;

/** Snap a time to the drum grid (sixteenth notes), so a trimmed loop keeps the beat. */
export const snapToStep = (sec: number, bpm: number) => {
  const step = 60 / bpm / 4;
  return Math.round(sec / step) * step;
};

/**
 * The part of the song that plays (and loops, and will be posted): the owner's trim, kept
 * inside the song and at least a beat long — or the whole song when there is no trim.
 */
export function clampRange(range: SongRange | null, full: number, bpm: number): SongRange {
  if (!range) return { start: 0, end: full };
  const min = Math.min(full, minRangeSec(bpm));
  const start = Math.min(Math.max(0, range.start), full - min);
  const end = Math.min(full, Math.max(start + min, range.end));
  return { start, end };
}
