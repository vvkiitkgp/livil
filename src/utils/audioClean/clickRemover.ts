/**
 * Removes the metronome click from a take recorded with the click on the PHONE SPEAKER.
 *
 * Echo cancellation done after the fact, keeping full voice quality (the OS's live echo
 * cancellation would make the voice sound like a phone call). It does NOT model the click
 * as the clean tone we played: a small phone speaker adds its own buzz and the room adds
 * ring, and a clean-tone model leaves both behind (owner's first iPhone test, 2026-10-30:
 * "very much audible"). Instead:
 *
 * 1. Find the real timing. The time the app THINKS recording started can be off by
 *    hundreds of ms (the iPhone mic warms up), so the count-in recording is
 *    cross-correlated with where the clicks should be, over ±MAX_LAG.
 * 2. Learn the click AS RECORDED: average the count-in clicks of each kind (accent / beat).
 *    Nobody is singing yet, so that average is exactly what the mic hears for one click,
 *    speaker distortion and room included.
 * 3. Subtract that recording at every click, on the exact grid the engine played them on.
 * Only the click's own sound is subtracted, so a voice under a click is not cut.
 */
import { fft, nextPow2 } from './fft';

export type ClickEvent = {
  /**
   * Where the click was scheduled, in take samples: the engine's start frame
   * (`floor(when·sr)`) minus the frame the recording started on. May be fractional, but
   * by the same amount for every click.
   */
  at: number;
  accent: boolean;
};

export type ClickReport = {
  removed: number;
  /** Measured offset between scheduled and recorded clicks, ms (+ = heard later). */
  lagMs: number;
  /** Count-in clicks the templates were learned from (accent, beat). */
  learned: { accent: number; beat: number };
  /** How much quieter the click windows got, dB (includes any voice in them). */
  reductionDb: number;
  /** Why nothing was removed, when nothing was. */
  skipped?: string;
};

/** Widest timing error searched for. */
const MAX_LAG_SEC = 0.6;
/** Template window: starts a little before the click arrives, runs through the room ring. */
const PRE_SEC = 0.01;
const TEMPLATE_SEC = 0.2;

/** Lag (samples, may be negative) that best lines the count-in recording up with `ref`. */
function findLag(y: Float32Array, ref: Float32Array, maxLag: number): number {
  const n = nextPow2(y.length + maxLag * 2);
  const yr = new Float64Array(n), yi = new Float64Array(n);
  const rr = new Float64Array(n), ri = new Float64Array(n);
  yr.set(y); rr.set(ref);
  fft(yr, yi); fft(rr, ri);
  for (let i = 0; i < n; i++) {
    // Y · conj(R): peak at the lag where y matches ref shifted right.
    const re = yr[i] * rr[i] + yi[i] * ri[i];
    const im = yi[i] * rr[i] - yr[i] * ri[i];
    yr[i] = re; yi[i] = im;
  }
  fft(yr, yi, true);
  let best = 0, bestV = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const v = Math.abs(yr[(lag + n) % n]);
    if (v > bestV) { bestV = v; best = lag; }
  }
  return best;
}

/** Linear interpolation of x at a fractional index; 0 outside. */
function sampleAt(x: Float32Array, p: number): number {
  const i = Math.floor(p);
  const f = p - i;
  const a = i >= 0 && i < x.length ? x[i] : 0;
  const b = i + 1 >= 0 && i + 1 < x.length ? x[i + 1] : 0;
  return a + (b - a) * f;
}

/**
 * Template value landing on sample `floor(pos) + k` when the template starts at the
 * fractional position `pos`.
 */
function templateAt(e: Float32Array, k: number, pos: number): number {
  return sampleAt(e, k - (pos - Math.floor(pos)));
}

export function removeClicks(
  take: Float32Array,
  sampleRate: number,
  clicks: ClickEvent[],
  sounds: { accent: Float32Array; beat: Float32Array },
  /** End of the count-in (sample index): before it, only clicks were recorded. */
  calibrationEnd: number,
): { cleaned: Float32Array; removed: number; report: ClickReport } {
  const y = new Float32Array(take);
  const none = (skipped: string) => ({ cleaned: y, removed: 0, report: { removed: 0, lagMs: 0, learned: { accent: 0, beat: 0 }, reductionDb: 0, skipped } });
  if (!clicks.length || calibrationEnd <= 0) return none('no count-in recorded');

  const maxLag = Math.round(MAX_LAG_SEC * sampleRate);
  const pre = Math.round(PRE_SEC * sampleRate);
  const T = Math.round(TEMPLATE_SEC * sampleRate);
  const segLen = Math.min(take.length, calibrationEnd);

  // 1. Timing.
  const ref = new Float32Array(segLen);
  for (const c of clicks) {
    const s = c.accent ? sounds.accent : sounds.beat;
    const p = Math.round(c.at);
    for (let k = 0; k < s.length; k++) { const i = p + k; if (i >= 0 && i < segLen) ref[i] += s[k]; }
  }
  const lag = findLag(take.subarray(0, segLen), ref, maxLag);

  // 2. Templates from the count-in. Every click is placed at `at + lag − pre` with NO
  //    per-click search: the engine starts each click on a whole frame of its clock
  //    (`floor(when·sr)`, react-native-audio-api AudioUtils.timeToSampleFrame) and the
  //    recorder runs on the same clock, so the spacing between clicks is exact and only
  //    one constant offset is unknown — the `lag` found above, measured while nobody was
  //    singing. A per-click fit would be pulled off by the voice (tested: it capped the
  //    removal near 20 dB, against >100 dB with the fixed grid).
  const pos = (c: ClickEvent) => c.at + lag - pre;
  // The singer comes in on the beat they HEAR, so the voice starts `lag` after the
  // scheduled end of the count-in, not at it.
  const voiceFree = Math.min(take.length, calibrationEnd + lag);
  const learnFrom = clicks.filter(c => pos(c) >= 0 && pos(c) + T + 1 <= voiceFree);
  const tmpl = { accent: new Float32Array(T), beat: new Float32Array(T) };
  const count = { accent: 0, beat: 0 };
  for (const c of learnFrom) {
    const kind = c.accent ? 'accent' : 'beat';
    const t = tmpl[kind];
    const p = pos(c);
    for (let k = 0; k < T; k++) t[k] += sampleAt(take, p + k);
    count[kind]++;
  }
  if (!count.accent && !count.beat) return none('count-in clicks not found in the recording');
  for (const kind of ['accent', 'beat'] as const) if (count[kind]) for (let k = 0; k < T; k++) tmpl[kind][k] /= count[kind];
  // A kind never heard in the count-in borrows the other's recording, scaled by how much
  // louder the played sound is — better than leaving it in.
  if (!count.accent || !count.beat) {
    const have = count.accent ? 'accent' : 'beat';
    const miss = have === 'accent' ? 'beat' : 'accent';
    const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const g = peak(sounds[miss]) / (peak(sounds[have]) || 1);
    for (let k = 0; k < T; k++) tmpl[miss][k] = tmpl[have][k] * g;
  }
  // Fade the template's last 20% so a subtraction never leaves an edge.
  const fade = Math.floor(T * 0.8);
  for (const kind of ['accent', 'beat'] as const) for (let k = fade; k < T; k++) tmpl[kind][k] *= (T - k) / (T - fade);

  // 3. Subtract the recorded click at every click position.
  let before = 0, after = 0, removed = 0;
  for (const c of clicks) {
    const e = c.accent ? tmpl.accent : tmpl.beat;
    const p = pos(c);
    if (p + T < 0 || p >= y.length) continue;
    const i0 = Math.floor(p);
    for (let k = -1; k <= T; k++) {
      const i = i0 + k;
      if (i < 0 || i >= y.length) continue;
      before += y[i] * y[i];
      y[i] -= templateAt(e, k, p);
      after += y[i] * y[i];
    }
    removed++;
  }
  const reductionDb = after > 0 ? 10 * Math.log10(before / after) : 0;
  return {
    cleaned: y,
    removed,
    report: { removed, lagMs: Math.round((lag / sampleRate) * 1000), learned: count, reductionDb: Math.round(reductionDb * 10) / 10 },
  };
}
