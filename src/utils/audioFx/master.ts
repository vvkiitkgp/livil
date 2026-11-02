/**
 * Mastering for a posted Editor song (ADR-0037): measure loudness the way streaming services
 * do (ITU-R BS.1770-4 integrated LUFS), bring the song to the target with a look-ahead
 * TRUE-PEAK limiter, then clean fades. Pure and in place on the rendered channels, so a
 * 15-minute song needs no second full-length copy; async with yields so the screen stays live.
 *
 * Why a real limiter: the old master "limiter" was a WaveShaper curve — it bent every loud
 * sample instantly (distortion baked into the post). A limiter turns the GAIN down for a few
 * milliseconds around a peak instead, which you don't hear as fuzz.
 */

/** Owner decision 2026-11-02: the streaming standard (Spotify/YouTube), not "loud". */
export const TARGET_LUFS = -14;
/** True-peak ceiling: −1 dBTP keeps the AAC copy listeners stream from clipping. */
export const CEILING_DBTP = -1;
/** At most this much limiting at the loud moments — ship quieter rather than squash. */
export const MAX_LIMIT_DB = 4;

const dbToGain = (db: number) => Math.pow(10, db / 20);
const gainToDb = (g: number) => 20 * Math.log10(g);

// ── loudness (BS.1770-4) ────────────────────────────────────────────────────

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two K-weighting filters for any sample rate (libebur128's analogue prototypes). */
export function kWeighting(fs: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  let Q = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

/** One channel's K-weighting (both stages), inlined — this runs on every sample. */
class KFilter {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private u1 = 0; private u2 = 0; private v1 = 0; private v2 = 0;
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  private c1: number; private c2: number;
  constructor(fs: number) {
    const [s, h] = kWeighting(fs);
    this.b0 = s.b0; this.b1 = s.b1; this.b2 = s.b2; this.a1 = s.a1; this.a2 = s.a2;
    this.c1 = h.a1; this.c2 = h.a2;
  }
  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    const v = y - 2 * this.u1 + this.u2 - this.c1 * this.v1 - this.c2 * this.v2;
    this.u2 = this.u1; this.u1 = y; this.v2 = this.v1; this.v1 = v;
    return v;
  }
}

/**
 * Integrated loudness from 100 ms hop energies (Σ K-weighted y² over channels, `hopLen`
 * frames each): 400 ms blocks = 4 hops, absolute gate −70 LUFS, relative gate −10 LU.
 */
function gatedLufs(hops: ArrayLike<number>, count: number, hopLen: number): number {
  const L = (p: number) => -0.691 + 10 * Math.log10(p);
  const z: number[] = [];
  for (let j = 0; j + 3 < count; j++) z.push((hops[j] + hops[j + 1] + hops[j + 2] + hops[j + 3]) / (4 * hopLen));
  const abs = z.filter(p => p > 0 && L(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter(p => L(p) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** Integrated loudness of `channels` scaled by `gain`, LUFS. */
export async function measureLufs(channels: Float32Array[], sampleRate: number, gain = 1): Promise<number> {
  const hopLen = Math.round(sampleRate * 0.1);
  const n = channels[0].length;
  const hops = new Float64Array(Math.ceil(n / hopLen));
  for (const x of channels) {
    const k = new KFilter(sampleRate);
    for (let i = 0; i < n; i++) {
      const v = k.step(x[i] * gain);
      hops[(i / hopLen) | 0] += v * v;
      if ((i & 0x3ffff) === 0x3ffff) await yieldUi();
    }
  }
  return gatedLufs(hops, Math.floor(n / hopLen), hopLen);
}

// ── true peak (BS.1770-4 Annex 2) ───────────────────────────────────────────

const H0 = [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625,
  0.97216796875, -0.102294921875, 0.047607421875, -0.0266113281250, 0.0148925781250, -0.00830078125];
const H1 = [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
  0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375];
/** The three 4×-oversampling phases that fall between sample i and i+1 (phase 0 ≈ the sample), flat. */
const PH = new Float64Array([...H1, ...[...H1].reverse(), ...[...H0].reverse()]);

/**
 * The true peak around frame i: when i is a local maximum of |x| (the only place the wave
 * can peak between samples) and at least `near`, the reconstructed peak over [i−1, i+1];
 * otherwise just |x[i]|. Skipping everything else makes it ~10× cheaper than interpolating
 * every sample, which matters on a phone.
 */
function peakNear(x: Float32Array, i: number, near: number): number {
  const a = x[i] < 0 ? -x[i] : x[i];
  if (a < near) return a;
  const prev = i > 0 ? Math.abs(x[i - 1]) : 0;
  const next = i + 1 < x.length ? Math.abs(x[i + 1]) : 0;
  if (a < prev || a < next) return a;
  const left = i > 0 ? truePeakAt(x, i - 1) : a;
  const right = truePeakAt(x, i);
  return left > right ? left : right;
}

/** Peak of the reconstructed waveform over [i, i+1]. Reads 0 past the ends. */
function truePeakAt(x: Float32Array, i: number): number {
  let m = x[i] < 0 ? -x[i] : x[i];
  const base = i + 6;
  if (i >= 6 && base < x.length) {
    // The common case, without bounds checks (this is the hottest loop in mastering).
    for (let o = 0; o < 36; o += 12) {
      let y = 0;
      for (let k = 0; k < 12; k++) y += PH[o + k] * x[base - k];
      if (y < 0) y = -y;
      if (y > m) m = y;
    }
    return m;
  }
  for (let o = 0; o < 36; o += 12) {
    let y = 0;
    for (let k = 0; k < 12; k++) {
      const j = base - k;
      if (j >= 0 && j < x.length) y += PH[o + k] * x[j];
    }
    if (y < 0) y = -y;
    if (y > m) m = y;
  }
  return m;
}

/**
 * Highest true peak in `channels`, dBTP. Interpolates only around samples at or above
 * `from` (default: 4.5 dB under the sample peak — music's overshoot between samples is smaller).
 */
export async function measureTruePeak(channels: Float32Array[], from?: number): Promise<number> {
  let sp = 0;
  for (const x of channels) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > sp) sp = a; }
  const near = from ?? sp * dbToGain(-4.5);
  let tp = sp;
  for (const x of channels) {
    for (let i = 0; i < x.length; i++) {
      const p = peakNear(x, i, near);
      if (p > tp) tp = p;
      if ((i & 0x3ffff) === 0x3ffff) await yieldUi();
    }
  }
  return gainToDb(tp);
}

// ── the limiter ─────────────────────────────────────────────────────────────

/** Look-ahead (= attack), hold and release of the limiter, seconds. */
const LOOKAHEAD = 0.003, HOLD = 0.01, RELEASE = 0.1;

/**
 * The limiter's gain path (Signalsmith's design), fed one raw gain at a time: sliding
 * minimum over look-ahead + hold → release (drop at once, recover over RELEASE) → moving
 * average as long as the look-ahead. The average can never rise above the raw gain at a
 * peak, so nothing goes over; the audio must be delayed by `delay` steps to line up.
 * `step` is in frames, or in blocks of frames for the quick dry runs.
 */
class GainPath {
  readonly delay: number;
  private la: number; private lh: number; private rel: number;
  private dqV: Float64Array; private dqI: Float64Array;
  private head = 0; private len = 0; private i = 0;
  private avg: Float64Array; private sum: number; private r = 1;
  constructor(stepsPerSec: number) {
    this.la = Math.max(2, Math.round(LOOKAHEAD * stepsPerSec));
    this.lh = this.la + Math.max(1, Math.round(HOLD * stepsPerSec));
    this.rel = 1 - Math.exp(-1 / (RELEASE * stepsPerSec));
    this.delay = this.la - 1;
    this.dqV = new Float64Array(this.lh + 1);
    this.dqI = new Float64Array(this.lh + 1);
    this.avg = new Float64Array(this.la).fill(1);
    this.sum = this.la;
  }
  /** Push the raw gain for step i; returns the smoothed gain for step i − delay. */
  push(raw: number): number {
    // Fast path: no limiting anywhere in the window (most of a song) — nothing to track.
    if (raw === 1 && this.len === 0 && this.r === 1 && this.sum === this.la) { this.i++; return 1; }
    const size = this.lh + 1;
    while (this.len > 0) {
      let last = this.head + this.len - 1;
      if (last >= size) last -= size;
      if (this.dqV[last] < raw) break;
      this.len--;
    }
    if (raw < 1 || this.len > 0) {
      let t = this.head + this.len;
      if (t >= size) t -= size;
      this.dqV[t] = raw; this.dqI[t] = this.i; this.len++;
    }
    while (this.len > 0 && this.dqI[this.head] <= this.i - this.lh) { this.head = this.head + 1 === size ? 0 : this.head + 1; this.len--; }
    const held = this.len > 0 ? this.dqV[this.head] : 1;
    this.r = held < this.r ? held : this.r + (held - this.r) * this.rel;
    if (this.r > 1 - 1e-9) this.r = 1;
    const slot = this.i % this.la;
    this.sum += this.r - this.avg[slot];
    this.avg[slot] = this.r;
    if (Math.abs(this.sum - this.la) < 1e-9 && this.r === 1) this.sum = this.la;
    this.i++;
    return Math.min(1, this.sum / this.la);
  }
}

/** Frames per analysis block: the dry runs work on blocks, ~0.7 ms each at 48 kHz. */
const BLOCK = 32;

/** One look at the song: per block, the loudest sample and the K-weighted energy. */
type Analysis = { peak: Float32Array; energy: Float64Array; hopBlocks: number };

async function analyse(ch: Float32Array[], fs: number): Promise<Analysis> {
  const n = ch[0].length;
  const nb = Math.ceil(n / BLOCK);
  const peak = new Float32Array(nb);
  const energy = new Float64Array(nb);
  for (const x of ch) {
    const k = new KFilter(fs);
    for (let i = 0; i < n; i++) {
      const s = x[i];
      const b = (i / BLOCK) | 0;
      const a = s < 0 ? -s : s;
      if (a > peak[b]) peak[b] = a;
      const v = k.step(s);
      energy[b] += v * v;
      if ((i & 0x3ffff) === 0x3ffff) await yieldUi();
    }
  }
  return { peak, energy, hopBlocks: Math.max(1, Math.round((fs * 0.1) / BLOCK)) };
}

/** Loudness of the analysed song at `gainDb` with each block scaled by `blockGain` (or 1). */
function blockLufs(a: Analysis, g: number, blockGain?: Float32Array): number {
  const nh = Math.floor(a.energy.length / a.hopBlocks);
  const hops = new Float64Array(nh);
  for (let b = 0; b < nh * a.hopBlocks; b++) {
    const gg = g * (blockGain ? blockGain[b] : 1);
    hops[(b / a.hopBlocks) | 0] += a.energy[b] * gg * gg;
  }
  return gatedLufs(hops, nh, a.hopBlocks * BLOCK);
}

type DryRun = { lufs: number; limitDb: number };

/**
 * What limiting at `gainDb` WOULD do, from the block summary — fast enough to try several
 * gains on a 15-minute song. Uses the block's sample peak against a ceiling 0.3 dB lower than
 * the real one to stand in for the peaks between samples. "How hard it limited" = the gain
 * reduction exceeded in the loudest 1 % of blocks with sound.
 */
function dryRun(a: Analysis, fs: number, gainDb: number, ceilingDb: number): DryRun {
  const g = dbToGain(gainDb);
  const ceil = dbToGain(ceilingDb - 0.3);
  const nb = a.peak.length;
  const path = new GainPath(fs / BLOCK);
  const gains = new Float32Array(nb);
  for (let i = 0; i < nb + path.delay; i++) {
    const pk = i < nb ? a.peak[i] * g : 0;
    const s = path.push(pk > ceil ? ceil / pk : 1);
    const o = i - path.delay;
    if (o >= 0) gains[o] = s;
  }
  const hist = new Float64Array(481);
  let counted = 0;
  for (let b = 0; b < nb; b++) {
    if (a.energy[b] * g * g < 1e-8 * BLOCK) continue;
    hist[Math.min(480, Math.round(-gainToDb(gains[b]) / 0.05))]++;
    counted++;
  }
  let limitDb = 0;
  for (let b = 480, seen = 0; b >= 0 && counted; b--) {
    seen += hist[b];
    if (seen >= counted * 0.01) { limitDb = b * 0.05; break; }
  }
  return { lufs: blockLufs(a, g, gains), limitDb };
}

/**
 * The real thing, on every frame, in place: true-peak detection (interpolated only near the
 * ceiling), the gain path, and the audio delayed by the look-ahead (each frame is written back
 * `delay` frames late — the reads ahead of it are still the input). Stereo-linked: one gain
 * for both channels, so the image never shifts.
 */
async function limitInPlace(ch: Float32Array[], fs: number, gainDb: number, ceilingDb: number): Promise<{ lufs: number; truePeak: number }> {
  const g = dbToGain(gainDb);
  const ceil = dbToGain(ceilingDb);
  const near = (ceil * dbToGain(-3)) / g; // input level below which no inter-sample peak can reach the ceiling
  const n = ch[0].length;
  const c0 = ch[0], c1 = ch.length > 1 ? ch[1] : null;
  const path = new GainPath(fs);
  const hopLen = Math.round(fs * 0.1);
  const hops = new Float64Array(Math.ceil(n / hopLen) + 1);
  const k0 = new KFilter(fs), k1 = new KFilter(fs);
  // Each frame's peak (before gain) waits here until its gain is known: the output's true peak
  // comes out of the same pass, no second scan of the song.
  const ring = new Float64Array(path.delay + 1);
  let outPeak = 0;
  for (let i = 0; i < n + path.delay; i++) {
    let raw = 1;
    if (i < n) {
      let pk = 0;
      for (let c = 0; c < 2; c++) {
        const x = c === 0 ? c0 : c1;
        if (!x) break;
        const p = peakNear(x, i, near);
        if (p > pk) pk = p;
      }
      ring[i % ring.length] = pk;
      pk *= g;
      if (pk > ceil) raw = ceil / pk;
    }
    const s = path.push(raw);
    const o = i - path.delay;
    if (o < 0) continue;
    const gain = g * s;
    const op = ring[o % ring.length] * gain;
    if (op > outPeak) outPeak = op;
    const y0 = c0[o] * gain;
    c0[o] = y0;
    let v = k0.step(y0);
    let e = v * v;
    if (c1) {
      const y1 = c1[o] * gain;
      c1[o] = y1;
      v = k1.step(y1);
      e += v * v;
    }
    hops[(o / hopLen) | 0] += e;
    if ((i & 0x3ffff) === 0x3ffff) await yieldUi();
  }
  return { lufs: gatedLufs(hops, Math.floor(n / hopLen), hopLen), truePeak: gainToDb(outPeak) };
}

export type MasterReport = {
  inputLufs: number;
  lufs: number;
  truePeakDb: number;
  gainDb: number;
  limitDb: number;
  ms: number;
};

/**
 * Masters `channels` in place: loudness to TARGET_LUFS (or quieter, if getting there would
 * need more than MAX_LIMIT_DB of limiting), true peak ≤ CEILING_DBTP. A silent song is left
 * alone. `onProgress` gets 0..1.
 */
export async function masterInPlace(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Promise<MasterReport> {
  const t0 = Date.now();
  // Dual-mono (everything in the Editor is mono today): master one channel, copy it over.
  const same = channels.length === 2 && sameSamples(channels[0], channels[1]);
  const work = same ? [channels[0]] : channels;
  const monoOffset = same ? 3.0103 : 0; // a mono meter misses the other channel's half
  const a = await analyse(work, sampleRate);
  onProgress?.(0.3);
  const inputLufs = blockLufs(a, 1) + monoOffset;
  if (!Number.isFinite(inputLufs)) return { inputLufs, lufs: inputLufs, truePeakDb: -Infinity, gainDb: 0, limitDb: 0, ms: Date.now() - t0 };
  const ceilingDb = CEILING_DBTP - 0.2; // margin for the smoothing; verified below

  // Aim at the target, but never limit harder than MAX_LIMIT_DB. Raising the gain by Δ raises
  // the limiting by up to Δ, so a step up is capped at the room left under the cap.
  let gainDb = Math.min(24, TARGET_LUFS - inputLufs);
  let res = dryRun(a, sampleRate, gainDb, ceilingDb);
  let best = res.limitDb <= MAX_LIMIT_DB + 0.1 ? { gainDb, res } : null;
  for (let k = 0; k < 6; k++) {
    const need = TARGET_LUFS - (res.lufs + monoOffset);
    let step: number;
    if (res.limitDb > MAX_LIMIT_DB + 0.1) step = MAX_LIMIT_DB - res.limitDb - 0.1;
    else if (need > 0.2) step = Math.min(need, Math.max(0, MAX_LIMIT_DB - res.limitDb));
    else if (need < -0.2) step = need;
    else break;
    if (Math.abs(step) < 0.1) break;
    gainDb = Math.min(24, gainDb + step);
    res = dryRun(a, sampleRate, gainDb, ceilingDb);
    const ok = res.limitDb <= MAX_LIMIT_DB + 0.1 && res.lufs + monoOffset <= TARGET_LUFS + 0.3;
    if (ok && (!best || res.lufs > best.res.lufs)) best = { gainDb, res };
  }
  if (best) { gainDb = best.gainDb; res = best.res; }
  onProgress?.(0.4);

  const out = await limitInPlace(work, sampleRate, gainDb, ceilingDb);
  const lufs = out.lufs + monoOffset;
  onProgress?.(0.95);
  // If the smoothing let anything past the ceiling, turn the whole song down by that much.
  let tp = out.truePeak;
  if (tp > CEILING_DBTP) {
    const fix = dbToGain(CEILING_DBTP - tp - 0.05);
    for (const x of work) for (let i = 0; i < x.length; i++) x[i] *= fix;
    tp = CEILING_DBTP - 0.05;
  }
  if (same) channels[1].set(channels[0]);
  onProgress?.(1);
  return { inputLufs, lufs, truePeakDb: tp, gainDb, limitDb: res.limitDb, ms: Date.now() - t0 };
}

/**
 * The song's ends: a 5 ms fade-in, then the reverb/synth tail kept until it falls below
 * −60 dBFS (at most `tailSec`), finished with a 50 ms raised-cosine fade. Returns the new
 * length in frames (≥ `songFrames`, the length of the trim).
 */
export function finishEnds(channels: Float32Array[], sampleRate: number, songFrames: number): number {
  const total = channels[0].length;
  const quiet = dbToGain(-60);
  let end = songFrames;
  for (const x of channels) for (let i = total - 1; i >= songFrames; i--) if (Math.abs(x[i]) > quiet) { end = Math.max(end, i + 1); break; }
  const fadeOut = Math.min(end, Math.round(0.05 * sampleRate));
  end = Math.min(total, end + Math.round(fadeOut / 2));
  const fadeIn = Math.min(end, Math.round(0.005 * sampleRate));
  for (const x of channels) {
    for (let i = 0; i < fadeIn; i++) x[i] *= i / fadeIn;
    for (let i = 0; i < fadeOut; i++) x[end - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  }
  return end;
}

function sameSamples(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const yieldUi = () => new Promise<void>(r => setTimeout(r, 0));
