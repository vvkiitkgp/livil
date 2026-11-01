/**
 * Levels before the mix: a take's automatic level (so a quiet take and a loud one sit the same
 * in the song without anyone pushing a slider to 300%), and short edge ramps. Pure.
 */

/** Where a voice sits: its singing at about −20 dBFS on average… */
const ACTIVE_DBFS = -20;
/** …but its loudest peak never above −3 dBFS. */
const PEAK_DBFS = -3;

/**
 * The gain that brings a take's ACTIVE level (the 20 ms frames with singing in them, not the
 * silence between phrases) to ACTIVE_DBFS, held back so the peak stays under PEAK_DBFS.
 * Stored as a setting on the voice, never baked into the recording. 1 for silence.
 */
export function autoLevel(samples: Float32Array, sampleRate: number): number {
  const frame = Math.max(1, Math.round(0.02 * sampleRate));
  const energies: number[] = [];
  let peak = 0;
  for (let s = 0; s + frame <= samples.length; s += frame) {
    let e = 0;
    for (let i = s; i < s + frame; i++) {
      const x = samples[i];
      e += x * x;
      const a = x < 0 ? -x : x;
      if (a > peak) peak = a;
    }
    energies.push(e / frame);
  }
  if (!energies.length || peak < 1e-4) return 1;
  // Singing = frames within 30 dB of the loudest 5 %: breaths and room tone don't count.
  const sorted = [...energies].sort((a, b) => b - a);
  const loud = sorted[Math.floor(sorted.length * 0.05)];
  const active = energies.filter(e => e > loud * 1e-3);
  const rms = Math.sqrt(active.reduce((a, b) => a + b, 0) / active.length);
  const toActive = Math.pow(10, ACTIVE_DBFS / 20) / rms;
  const toPeak = Math.pow(10, PEAK_DBFS / 20) / peak;
  return Math.min(8, Math.max(0.125, Math.min(toActive, toPeak)));
}

/** A segment's fade length: 4 ms, or half the segment if it is shorter than that. */
export const edgeRamp = (seconds: number) => Math.max(0, Math.min(0.004, seconds / 2));

/**
 * Resamples `data` from one rate to another with a windowed-sinc (Lanczos, 16 lobes) filter,
 * low-passed below the lower rate's Nyquist so nothing folds back. For takes made at a
 * different rate than the phone now plays at (a draft from another session): played as-is
 * they ran fast and sharp, because the audio library does not convert rates itself.
 */
export function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data;
  const ratio = to / from;
  const out = new Float32Array(Math.round(data.length * ratio));
  const cutoff = Math.min(1, ratio); // as a fraction of the input Nyquist
  const A = 16;
  const half = Math.ceil(A / cutoff);
  for (let i = 0; i < out.length; i++) {
    const t = i / ratio;
    const c = Math.floor(t);
    let acc = 0, wsum = 0;
    for (let j = c - half + 1; j <= c + half; j++) {
      if (j < 0 || j >= data.length) continue;
      const x = (t - j) * cutoff;
      const w = x === 0 ? 1 : Math.abs(x) >= A ? 0 : (A * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / A)) / (Math.PI * Math.PI * x * x);
      acc += data[j] * w;
      wsum += w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}


/**
 * `resample`, for long takes: polyphase (the filter for each of the few fractional positions a
 * rational rate change visits is worked out once, not per sample — far faster on a phone) and
 * async, giving the screen a turn every ~0.25 s of output. 44.1 → 48 kHz visits 160 positions.
 * A rate pair with no small ratio falls back to `resample`.
 */
export async function resampleAsync(data: Float32Array, from: number, to: number): Promise<Float32Array> {
  if (from === to) return data;
  const g = gcd(Math.round(from), Math.round(to));
  const up = Math.round(to) / g; // output positions per cycle
  const down = Math.round(from) / g; // input samples per cycle
  if (up > 2000) return resample(data, from, to);
  const ratio = to / from;
  const cutoff = Math.min(1, ratio);
  const A = 8;
  const half = Math.ceil(A / cutoff);
  const taps = 2 * half;
  // table[p][k]: weight of input sample (c − half + 1 + k) for output phase p.
  const table = new Float32Array(up * taps);
  for (let p = 0; p < up; p++) {
    const frac = (p * down) / up - Math.floor((p * down) / up);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = (frac - (k - half + 1)) * cutoff;
      const w = x === 0 ? 1 : Math.abs(x) >= A ? 0 : (A * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / A)) / (Math.PI * Math.PI * x * x);
      table[p * taps + k] = w;
      sum += w;
    }
    for (let k = 0; k < taps; k++) table[p * taps + k] /= sum;
  }
  const out = new Float32Array(Math.round(data.length * ratio));
  const n = data.length;
  const chunk = Math.max(1, Math.round(to / 4));
  for (let i = 0; i < out.length; i++) {
    const p = i % up;
    const c = Math.floor((i * down) / up);
    const base = c - half + 1;
    const row = p * taps;
    let acc = 0;
    if (base >= 0 && base + taps <= n) {
      for (let k = 0; k < taps; k++) acc += data[base + k] * table[row + k];
    } else {
      for (let k = 0; k < taps; k++) { const j = base + k; if (j >= 0 && j < n) acc += data[j] * table[row + k]; }
    }
    out[i] = acc;
    if (i % chunk === chunk - 1) await new Promise<void>(r => setTimeout(r, 0));
  }
  return out;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
