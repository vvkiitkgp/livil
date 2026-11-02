/**
 * TD-PSOLA pitch shifting (pitch-synchronous overlap-add), time-varying ratio, no change
 * in length. Each grain is two periods of the take, Hann-windowed, centred on a pitch mark;
 * grains are re-laid at period/ratio spacing. Unvoiced stretches use a fixed grain and a
 * ratio of 1, which is an exact identity (a Hann window at half-overlap sums to one).
 *
 * The output is normalised by the summed window, so a ratio ≠ 1 does not change loudness.
 */
import { frameAt, type PitchTrack } from './pitch';

const UNVOICED_HZ = 200;
const WINDOW_FLOOR = 0.15;

export function pitchMarks(x: Float32Array, track: PitchTrack): { marks: Int32Array; gaps: Int32Array } {
  const N = x.length;
  const sr = track.sampleRate;
  const unvoicedP = Math.round(sr / UNVOICED_HZ);
  const marks: number[] = [];
  const gaps: number[] = [];
  let m = 0;
  while (m < N) {
    const hz = track.f0[frameAt(track, m)];
    const P = hz > 0 ? Math.max(8, Math.round(sr / hz)) : unvoicedP;
    let next = m + P;
    if (hz > 0 && next < N) {
      // Lock each mark to the waveform peak near the expected period, so every grain
      // starts on the same phase of its cycle.
      const q = P >> 2;
      const lo = Math.max(m + (P >> 1), next - q);
      const hi = Math.min(N - 1, next + q);
      let best = next;
      let bv = -Infinity;
      for (let i = lo; i <= hi; i++) if (x[i] > bv) { bv = x[i]; best = i; }
      next = best;
    }
    marks.push(m);
    gaps.push(Math.max(8, next - m));
    m = next;
  }
  return { marks: Int32Array.from(marks), gaps: Int32Array.from(gaps) };
}

/**
 * `ratio[k]` is the pitch ratio for frame k of `track` (1 = unchanged, 2 = up an octave).
 * Frames with f0 = 0 are never shifted.
 */
export function psolaShift(x: Float32Array, track: PitchTrack, ratio: Float32Array): Float32Array {
  const N = x.length;
  const y = new Float32Array(N);
  const w = new Float32Array(N);
  if (N === 0) return y;
  const { marks, gaps } = pitchMarks(x, track);
  let i = 0;
  let ts = marks[0];
  while (ts < N) {
    while (i + 1 < marks.length && Math.abs(marks[i + 1] - ts) <= Math.abs(marks[i] - ts)) i++;
    const mk = marks[i];
    const P = gaps[i];
    const fr = frameAt(track, mk);
    const r = track.f0[fr] > 0 ? ratio[fr] : 1;
    const centre = Math.round(ts);
    const step = Math.PI / P;
    for (let k = -P; k < P; k++) {
      const src = mk + k;
      const dst = centre + k;
      if (src < 0 || src >= N || dst < 0 || dst >= N) continue;
      const win = 0.5 + 0.5 * Math.cos(step * k);
      y[dst] += x[src] * win;
      w[dst] += win;
    }
    ts += P / (r > 0 ? r : 1);
  }
  for (let n = 0; n < N; n++) if (w[n] > WINDOW_FLOOR) y[n] /= w[n];
  return y;
}
