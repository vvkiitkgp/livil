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

/** A song with no voice is this long until its end is dragged. */
export const EMPTY_SONG_SECONDS = 30;

/**
 * How long the song is, in whole bars: as long as its clips, or the length its end was dragged
 * out to when that is longer. With no voice and nothing dragged, EMPTY_SONG_SECONDS, so beats
 * and instruments have room.
 */
export function songLength(clipsEnd: number, hasVoice: boolean, length: number | undefined, bpm: number): number {
  const bar = (4 * 60) / bpm;
  const end = Math.max(clipsEnd, length ?? (hasVoice ? 0 : EMPTY_SONG_SECONDS));
  return Math.max(1, Math.ceil(end / bar - 1e-6)) * bar;
}

/** The room the timeline keeps past the song's end, to grab the end and pull: a quarter of the song, at least a bar. */
export const roomPast = (full: number, bar: number) => Math.max(bar, full / 4);

/**
 * The time under a finger dragging the song's END, `x` dp along a row `w` wide. When the drag
 * began the row showed `view` seconds and the song was `full` long. Up to the song's old end
 * it is simply the time under the finger. Past it the timeline zooms out instead (it keeps
 * showing the same room past the handle), so the handle stays under the finger and one pull
 * can make a song several times longer. `viewFor` gives the seconds the row must show for that.
 */
export function endDragTime(x: number, w: number, view: number, full: number): number {
  const room = view - full;
  if (room <= 0 || x <= (full / view) * w) return (Math.max(0, x) / w) * view;
  const xx = Math.min(x, w - 6);
  return (xx * room) / (w - xx);
}
export const viewFor = (end: number, view: number, full: number) => Math.max(view, end + (view - full));

/**
 * What letting go of the song's end at `t` means. At or past the last clip (`natural`: the
 * clips' length in whole bars, 0 with none) it is the song's LENGTH, in whole bars, and beats
 * and instruments play on to it. Short of the last clip it is a trim, on the drum grid.
 */
export function songEndAt(t: number, start: number, natural: number, bpm: number, max: number): { range: SongRange; full: number; length: number | undefined } {
  const bar = (4 * 60) / bpm;
  const least = start + minRangeSec(bpm);
  if (t < natural - 1e-3) {
    return { range: clampRange({ start, end: snapToStep(t, bpm) }, natural, bpm), full: natural, length: undefined };
  }
  const top = Math.max(bar, Math.floor(max / bar + 1e-6) * bar);
  const end = Math.min(top, Math.max(Math.ceil(least / bar - 1e-6) * bar, natural, Math.round(t / bar) * bar));
  // Exactly as long as the clips: nothing of its own to remember.
  return { range: { start, end }, full: end, length: natural > 0 && end - natural < 1e-3 ? undefined : end };
}
