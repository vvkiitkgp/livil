/**
 * Breath reduction: finds the breaths between sung lines and turns them DOWN (−12 dB), never
 * out — a vocal with its breaths deleted sounds cut-and-pasted. Pure; keeps the length.
 *
 * A breath, frame by frame (10 ms): noise-like (many zero crossings — air, not a pitched
 * note), well under the singing level (a sung "s" is loud; an inhale is soft), and it lasts
 * a while (≥ 80 ms; consonants are shorter). Fades of 20 ms at each end so the dip itself
 * is inaudible.
 */

const FRAME_SEC = 0.01;
/** How far a breath is turned down. */
const DIP_DB = -12;
/** Quieter than the singing by at least this much (and not below the room). */
const UNDER_VOICE_DB = 15;
const ABOVE_ROOM_DB = 6;
/** Zero crossings per second above which a frame sounds like air rather than a note. */
const NOISY_ZCR = 2500;
const MIN_SEC = 0.08;
const MAX_SEC = 1.2;
const FADE_SEC = 0.02;

export type BreathReport = { breaths: number; seconds: number };

/** `inPlace`: write into `x` itself (no second full-length copy) — for a buffer you own. */
export function reduceBreaths(x: Float32Array, sampleRate: number, inPlace = false): { out: Float32Array; report: BreathReport } {
  const out = inPlace ? x : new Float32Array(x);
  const F = Math.max(1, Math.round(FRAME_SEC * sampleRate));
  const nf = Math.floor(x.length / F);
  if (nf < 20) return { out, report: { breaths: 0, seconds: 0 } };
  const db = new Float64Array(nf);
  const zcr = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    let e = 0, z = 0;
    for (let i = f * F; i < (f + 1) * F; i++) {
      e += x[i] * x[i];
      if (i > 0 && (x[i] >= 0) !== (x[i - 1] >= 0)) z++;
    }
    db[f] = 10 * Math.log10(e / F + 1e-12);
    zcr[f] = (z / F) * sampleRate;
  }
  const sorted = Array.from(db).sort((a, b) => b - a);
  const voice = sorted[Math.floor(nf * 0.1)]; // the singing: loudest 10 % of frames
  const room = sorted[Math.floor(nf * 0.95)]; // the room: quietest 5 %
  const isBreath = (f: number) => db[f] < voice - UNDER_VOICE_DB && db[f] > room + ABOVE_ROOM_DB && zcr[f] > NOISY_ZCR;

  const gain = new Float32Array(nf).fill(1);
  let breaths = 0, frames = 0;
  for (let f = 0; f < nf; ) {
    if (!isBreath(f)) { f++; continue; }
    let g = f;
    // A breath may flicker for a frame (a tiny voiced moment); bridge one-frame gaps.
    while (g + 1 < nf && (isBreath(g + 1) || (g + 2 < nf && isBreath(g + 2)))) g++;
    const len = g - f + 1;
    if (len * FRAME_SEC >= MIN_SEC && len * FRAME_SEC <= MAX_SEC) {
      for (let k = f; k <= g; k++) gain[k] = Math.pow(10, DIP_DB / 20);
      breaths++;
      frames += len;
    }
    f = g + 1;
  }
  if (!breaths) return { out, report: { breaths: 0, seconds: 0 } };
  // Per-sample gain with fades, centred on frames.
  const fade = Math.max(1, Math.round(FADE_SEC * sampleRate));
  let cur = 1;
  const step = (1 - Math.pow(10, DIP_DB / 20)) / fade;
  for (let i = 0; i < x.length; i++) {
    const target = gain[Math.min(nf - 1, Math.floor(i / F))];
    cur = cur > target ? Math.max(target, cur - step) : Math.min(target, cur + step);
    out[i] = x[i] * cur;
  }
  return { out, report: { breaths, seconds: frames * FRAME_SEC } };
}
