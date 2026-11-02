/**
 * Click repair: finds single-sample glitches — one sample that jumps away while its
 * neighbours carry on smoothly — and puts back what the wave would have been there; then
 * short bursts (the same glitch after a sample-rate conversion smeared it), rebuilt from the
 * sound either side. Run it BEFORE any rate conversion: one sample wide is the easy case.
 *
 * Why: react-native-audio-api 0.12.2's iPhone recorder appended one stale sample to every
 * ~23 ms hardware buffer (see the patch notes), an audible tick ~14×/s in loud parts. Takes
 * recorded before the fix still have them; repair makes those clean too. Real sound can't
 * look like this at 44.1/48 kHz: a voice moves smoothly from one sample to the next.
 * Pure; keeps the length, so the take's timing doesn't move.
 */

/** Half-width of the window the local "normal roughness" is measured over, samples. */
const W = 256;

export type ClickRepairReport = { repaired: number; bursts: number };

/**
 * Bump when the repair finds more: takes repaired by an older version are repaired again
 * (once) when their draft opens. 1 = single samples; 2 = + bursts (2026-11-02).
 */
export const CLICK_REPAIR_VERSION = 2;

type State = { out: Float32Array; res: Float32Array; sum: number; k: number; end: number; repaired: number };

function begin(x: Float32Array): State {
  const n = x.length;
  const out = new Float32Array(x);
  const res = new Float32Array(n);
  if (n < 2 * W + 5) return { out, res, sum: 0, k: 0, end: 0, repaired: 0 };
  // Residual of each sample against a cubic through its 4 neighbours (exact for smooth audio).
  for (let k = 2; k < n - 2; k++) {
    const p = (-x[k - 2] + 4 * x[k - 1] + 4 * x[k + 1] - x[k + 2]) / 6;
    res[k] = Math.abs(x[k] - p);
  }
  // Running mean of the residual = how rough this stretch normally is (sibilants are rough
  // everywhere; a click is rough at ONE sample).
  let sum = 0;
  for (let k = 0; k < 2 * W + 1; k++) sum += res[k];
  return { out, res, sum, k: W, end: n - W - 1, repaired: 0 };
}

/** Scans up to `count` more samples; true when the whole take is done. */
function scan(x: Float32Array, st: State, count: number): boolean {
  const { out, res } = st;
  let { sum, k } = st;
  const stop = Math.min(st.end, k + count);
  for (; k < stop; k++) {
    const local = (sum - res[k]) / (2 * W);
    const e = res[k];
    // The glitch itself has the biggest residual; its neighbours within 2 samples only see a
    // share of it through the cubic — never "repair" them.
    const peak = e >= res[k - 1] && e >= res[k + 1] && e >= res[k - 2] && e >= res[k + 2];
    if (peak && e > 6 * local + 0.002 && e > 3 * Math.abs(x[k + 1] - x[k - 1])) {
      out[k] = (-out[k - 2] + 4 * out[k - 1] + 4 * x[k + 1] - x[k + 2]) / 6;
      st.repaired++;
      k++; // its neighbours' residuals were thrown off by this sample
      sum += res[k + W] - res[k - W - 1];
    }
    sum += res[k + W + 1] - res[k - W];
  }
  st.sum = sum;
  st.k = k;
  return k >= st.end;
}

export function repairClicks(x: Float32Array): { out: Float32Array; report: ClickRepairReport } {
  const st = begin(x);
  scan(x, st, Infinity);
  const bursts = repairBursts(st.out);
  return { out: st.out, report: { repaired: st.repaired, bursts } };
}

/** `repairClicks`, giving the screen a turn every ~1M samples (a long take on a phone). */
export async function repairClicksAsync(x: Float32Array): Promise<{ out: Float32Array; report: ClickRepairReport }> {
  const st = begin(x);
  await new Promise<void>(r => setTimeout(r, 0));
  while (!scan(x, st, 1 << 20)) await new Promise<void>(r => setTimeout(r, 0));
  const work = burstWork(st.out);
  let r = work.next();
  while (!r.done) { await new Promise<void>(res => setTimeout(res, 0)); r = work.next(); }
  return { out: st.out, report: { repaired: st.repaired, bursts: r.value } };
}

// ── bursts ──────────────────────────────────────────────────────────────────

/** Longest stretch treated as a click (samples); anything longer is real sound (a "p", a "t"). */
const MAX_BURST = 32;
/** Samples of real audio the gap is rebuilt from, on each side. */
const CONTEXT = 256;
const ORDER = 16;

/**
 * Bursts: a click that is a few samples wide rather than one — what a one-sample glitch
 * becomes once the take is converted to another sample rate (44.1 → 48 kHz smears it into
 * a short ripple; 2026-11-02, 1,653 of them survived the one-sample repair). Each burst is
 * cut out and the gap rebuilt from the sound either side (linear prediction forward from the
 * left, backward from the right, cross-faded) — the standard way audio restoration fills
 * a short gap. In place on `x`; returns how many it rebuilt.
 */
export function repairBursts(x: Float32Array): number {
  const work = burstWork(x);
  let r = work.next();
  while (!r.done) r = work.next();
  return r.value;
}

/** The same, yielding (`yield`) every ~0.5M samples / 200 bursts so a caller can give the screen a turn. */
export function* burstWork(x: Float32Array): Generator<void, number> {
  const n = x.length;
  if (n < 2 * (CONTEXT + W)) return 0;
  const res = new Float32Array(n);
  for (let k = 2; k < n - 2; k++) res[k] = Math.abs(x[k] - (-x[k - 2] + 4 * x[k - 1] + 4 * x[k + 1] - x[k + 2]) / 6);
  let sum = 0;
  for (let k = 0; k < 2 * W + 1; k++) sum += res[k];
  // Mark rough samples against the local roughness, then group them into bursts.
  const bursts: [number, number][] = [];
  let a = -1, b = -1;
  for (let k = W; k < n - W - 1; k++) {
    const local = sum / (2 * W + 1);
    if (res[k] > 6 * local + 0.0015) {
      if (a >= 0 && k - b <= 4) b = k;
      else { if (a >= 0) bursts.push([a, b]); a = b = k; }
    }
    sum += res[k + W + 1] - res[k - W];
    if ((k & 0x7ffff) === 0) yield;
  }
  if (a >= 0) bursts.push([a, b]);
  let rebuilt = 0;
  const coef = new Float64Array(ORDER);
  for (const [s, e] of bursts) {
    if (e - s > MAX_BURST) continue;
    const g0 = s - 6, g1 = e + 6; // the gap, with margin for the ripple's fading tail
    if (g0 - CONTEXT < 0 || g1 + CONTEXT >= n) continue;
    const G = g1 - g0 + 1;
    const fwd = predict(x, g0 - CONTEXT, g0, G, 1, coef);
    const bwd = predict(x, g1 + CONTEXT, g1, G, -1, coef);
    if (!fwd || !bwd) continue;
    for (let i = 0; i < G; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 1)) / (G + 1));
      x[g0 + i] = (1 - w) * fwd[i] + w * bwd[G - 1 - i];
    }
    rebuilt++;
    if (rebuilt % 200 === 0) yield;
  }
  return rebuilt;
}

/**
 * Linear prediction of `count` samples continuing x[from…to) in direction `dir` (+1 forward
 * from just before `to`; −1 backward from just after `to`). Coefficients by Burg's method —
 * accurate on a short stretch of audio, where plain autocorrelation smears the estimate.
 */
function predict(x: Float32Array, from: number, to: number, count: number, dir: 1 | -1, a: Float64Array): Float64Array | null {
  const len = Math.abs(to - from);
  const seg = new Float64Array(len);
  for (let i = 0; i < len; i++) seg[i] = x[dir === 1 ? from + i : from - i]; // in time order, toward the gap
  // Burg: forward/backward errors, reflection coefficients, Levinson update of `a`
  // (convention: prediction = Σ a[j] · past[j]).
  const f = Float64Array.from(seg), b = Float64Array.from(seg);
  a.fill(0);
  const tmp = new Float64Array(ORDER);
  for (let m = 0; m < ORDER; m++) {
    let num = 0, den = 0;
    for (let i = m + 1; i < len; i++) { num += f[i] * b[i - 1]; den += f[i] * f[i] + b[i - 1] * b[i - 1]; }
    if (den <= 1e-20) return null;
    const k = (2 * num) / den;
    tmp.set(a);
    a[m] = k;
    for (let j = 0; j < m; j++) a[j] = tmp[j] - k * tmp[m - 1 - j];
    for (let i = len - 1; i > m; i--) {
      const fi = f[i];
      f[i] = fi - k * b[i - 1];
      b[i] = b[i - 1] - k * fi;
    }
  }
  const hist = new Float64Array(ORDER);
  for (let j = 0; j < ORDER; j++) hist[j] = seg[len - 1 - j]; // most recent first
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let y = 0;
    for (let j = 0; j < ORDER; j++) y += a[j] * hist[j];
    out[i] = y;
    for (let j = ORDER - 1; j > 0; j--) hist[j] = hist[j - 1];
    hist[0] = y;
  }
  return out;
}
