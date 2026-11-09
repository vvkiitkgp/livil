/**
 * Tempo detection for the Recorder: what BPM is this person singing at, and where do their
 * beats fall, so the beat grid (drums, instruments) can be lined up with the voice.
 *
 * Streaming and pure TypeScript: it is fed the recorder's PCM chunks as they arrive and never
 * touches an audio engine or the OS audio session (ADR-0034). It keeps NO audio — only an
 * onset envelope at ~100 values per second (a 15-minute take is ~360 KB), so it adds no
 * full-length copy of the take.
 *
 * Method: band-wise spectral flux (a syllable or a new note is a rise in some band), then the
 * rhythm spectrum of that envelope. A sung line repeats bar by bar, so its spectrum has peaks at
 * multiples of the BAR rate (a real take at 77 BPM: peaks at 58, 77, 96, 116, 135 and 154 — the
 * 3rd to 8th multiples of 19.3). Each candidate tempo is scored by the peaks on its own
 * multiples. Tuned on a real recording: an autocorrelation comb, which a click-like test signal
 * passes easily, scored that take at 0.05–0.15 and heard nothing.
 *   live:  the last 20 s, twice a second
 *   take:  the first 90 s, then a single-frequency Fourier fit around the winner, whose
 *          magnitude gives the tempo to 0.1 BPM and whose angle gives the beat position.
 * Hermes has no JIT, so the analysis runs on a ~12 kHz decimated copy with a 256-point FFT.
 */

import { fft, nextPow2 } from '../audioClean/fft';

export const MIN_TEMPO = 60;
export const MAX_TEMPO = 180;

const ANALYSIS_TARGET_RATE = 12000;
const FRAME = 256;
const HOP = 120;
const BANDS = 16;
const BAND_LOW_HZ = 100;
const BAND_HIGH_HZ = 5500;
/** Compression before the flux: log(1 + GAIN·amplitude), so room noise stays near zero. */
const GAIN = 100;
/** Frame RMS below this (about −46 dBFS) is silence. */
const SILENCE_RMS = 0.005;
const WINDOW_SEC = 20;
/** Before this much singing a tempo is only a guess: shown as it changes, never trusted. */
const MIN_SEC = 6;
const FIRST_GUESS_SEC = 2;
/** Windows a second. */
const PER_SEC = 2;
/** A live window with less singing than this gives no reading. */
const MIN_LOUD = 0.2;
/**
 * The part of the rhythm spectrum that is read, as BPM. Below it is phrasing, not rhythm.
 * Above it is vibrato (5–7 Hz = 300–420 "BPM"), which a held note would turn into a tempo.
 */
const SPECTRUM_LOW = 45;
const SPECTRUM_HIGH = 290;
/**
 * Confidence = how far the best tempo stands above the others, in robust standard deviations.
 * Measured on a real 90 s take: 3–10 for a 20 s window, 7 after 10 s of the whole take and 15
 * by the end. Noise, speech and a singer who speeds up stay under 5.7 however long they go on.
 */
const SURE_LIVE = 5.5;
/** A weaker live reading counts once three in a row agree (within AGREE). */
const MIN_LIVE = 3.2;
const AGREE = 0.03;
const MIN_TAKE = 6.3;
/**
 * A real singer drifts a little (96 → 98 over half a minute), which blurs the whole take's
 * spectrum (three real takes scored 4.0–5.5) while every 20 s window stays clear. So the live
 * readings also count: agreeing on one tempo for this share of the take makes it sure, and
 * for the smaller share it is still offered.
 */
const LIVE_SURE = 0.7;
const LIVE_OFFER = 0.33;
/**
 * The envelope must move at least this much (its standard deviation). Singing measures 0.35
 * (quiet) to 1.5; a fan 0.2, a held note with heavy vibrato 0.25, a plain held note 0.01.
 */
const MIN_MOVEMENT = 0.3;
/** How strongly a candidate an octave away from the reference tempo is discounted. */
const PRIOR_OCTAVES = 0.7;
/** The whole-take fit reads this much of the take: the grid has to line up from the start. */
const FIT_SEC = 90;
const MAX_SEC = 16 * 60;
/** Estimates within this ratio of the take's median count as "the same tempo". */
const STEADY_RATIO = 0.04;

const HANN = new Float64Array(FRAME);
for (let i = 0; i < FRAME; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

export type SungTempo = {
  /** The one tempo that fits the take best, to 0.1 BPM. */
  bpm: number;
  /** Seconds from the take's first sample to a beat (0 ≤ phase < 60 / bpm). */
  phase: number;
  /** False when the tempo wandered: no single BPM follows the whole take. */
  steady: boolean;
  /** The range the live readings moved in (10th–90th percentile), whole BPM. */
  low: number;
  high: number;
  /** Seconds from the take's first sample to where the singing starts. */
  voiceAt: number;
  /**
   * False when the take as a whole gave no clear answer and this is the tempo the live
   * readout showed for a good part of it: worth suggesting, not worth applying unasked.
   */
  sure: boolean;
};

const log2 = (x: number) => Math.log(x) / Math.LN2;

/** `bpm`, doubled or halved if that lands nearer `reference` (60 and 120 are the same pulse). */
export function foldTempo(bpm: number, reference: number): number {
  let best = bpm;
  for (const c of [bpm * 2, bpm / 2]) if (Math.abs(log2(c / reference)) < Math.abs(log2(best / reference))) best = c;
  return best;
}

/** Is the singer on the set tempo? Within 3% counts as on it. */
export function tempoHint(sung: number, set: number): 'on' | 'fast' | 'slow' {
  const ratio = foldTempo(sung, set) / set;
  if (ratio > 1.03) return 'fast';
  if (ratio < 0.97) return 'slow';
  return 'on';
}

/**
 * How far to move a take so its beats land on the grid. `beatAt` is the timeline time of one
 * sung beat. Moves it earlier when that is the shorter way and the take has the room (`start`
 * is where the take sits now; it cannot go before 0), later otherwise.
 */
export function gridShift(beatAt: number, bpm: number, start: number): number {
  const beat = 60 / bpm;
  const later = (beat - (((beatAt % beat) + beat) % beat)) % beat;
  const earlier = later - beat;
  return -earlier < later && start + earlier >= 0 ? earlier : later;
}

/** A syllable is heard this long before the beat it is sung on. */
const SYLLABLE_LEAD = 0.06;
/** Never cut closer to the first sung sound than this. */
const VOICE_GUARD = 0.03;

/**
 * Where to put a take so its first line starts on the first beat of a bar, without losing
 * anything that was sung. Returns the take's offset: negative = that much silent lead-in is
 * cropped, positive = that much silence is added in front. The first beat the singing covers
 * goes on the earliest bar line that still leaves the first sound (a pickup before the beat,
 * the attack of the first syllable) inside the song. `beatAt` and `voiceAt` are seconds into
 * the take.
 */
export function firstLineOffset(beatAt: number, voiceAt: number, bpm: number): number {
  const beat = 60 / bpm;
  const first = beatAt + Math.ceil((voiceAt - SYLLABLE_LEAD - beatAt) / beat) * beat;
  let offset = -first;
  while (offset < VOICE_GUARD - voiceAt) offset += 4 * beat;
  return offset;
}

export class TempoTracker {
  private readonly dec: number;
  /** Envelope values per second. */
  private readonly envRate: number;
  private readonly reference: number;
  private readonly bandOf: Int8Array;
  private decSum = 0;
  private decCount = 0;
  private readonly frame = new Float32Array(FRAME);
  private fill = 0;
  private readonly re = new Float64Array(FRAME);
  private readonly im = new Float64Array(FRAME);
  private readonly band = new Float64Array(BANDS);
  private readonly prev = new Float64Array(BANDS);
  private primed = false;
  private env = new Float32Array(4096);
  /** RMS of each frame: where the singing is, and where it starts. */
  private level = new Float32Array(4096);
  private n = 0;
  private readonly maxFrames: number;
  private readonly winFrames: number;
  private readonly specRe: Float64Array;
  private readonly specIm: Float64Array;
  private lastEstimateAt = 0;
  /** One per window (PER_SEC a second); NaN = no tempo heard in that window. */
  private estimates: number[] = [];
  private lastGuess: number | null = null;
  /** The best tempo of the last few windows, sure or not, to see whether they agree. */
  private guesses: number[] = [];

  /** `reference` is the project's BPM: of two tempos an octave apart, the nearer one wins. */
  constructor(sampleRate: number, reference = 100) {
    this.dec = Math.max(1, Math.round(sampleRate / ANALYSIS_TARGET_RATE));
    const rate = sampleRate / this.dec;
    this.envRate = rate / HOP;
    this.reference = reference;
    this.maxFrames = Math.ceil(MAX_SEC * this.envRate);
    this.winFrames = Math.round(WINDOW_SEC * this.envRate);
    const size = nextPow2(4 * this.winFrames);
    this.specRe = new Float64Array(size);
    this.specIm = new Float64Array(size);
    // Log-spaced bands: one syllable lights up a few of them, vibrato stays inside one.
    this.bandOf = new Int8Array(FRAME / 2).fill(-1);
    const span = Math.log(BAND_HIGH_HZ / BAND_LOW_HZ);
    for (let k = 1; k < FRAME / 2; k++) {
      const hz = (k * rate) / FRAME;
      if (hz < BAND_LOW_HZ || hz >= BAND_HIGH_HZ) continue;
      this.bandOf[k] = Math.min(BANDS - 1, Math.floor((Math.log(hz / BAND_LOW_HZ) / span) * BANDS));
    }
  }

  /** Feed the next piece of the take. The chunk is read, never kept. */
  push(chunk: Float32Array): void {
    const { dec, frame } = this;
    for (let i = 0; i < chunk.length; i++) {
      this.decSum += chunk[i];
      if (++this.decCount < dec) continue;
      frame[this.fill++] = this.decSum / dec;
      this.decSum = 0;
      this.decCount = 0;
      if (this.fill === FRAME) {
        this.analyse();
        frame.copyWithin(0, HOP);
        this.fill = FRAME - HOP;
      }
    }
  }

  /**
   * The detector's best guess right now, sure or not: it shows from the first seconds and
   * moves around until the rhythm is clear. Null in silence. Never use it to set anything.
   */
  get guess(): number | null {
    return this.bpm ?? this.lastGuess;
  }

  /** The tempo of the last few seconds, whole BPM; null until one is heard (or when it is lost). */
  get bpm(): number | null {
    const recent = this.estimates.slice(-2 * PER_SEC);
    const heard = recent.filter(e => !Number.isNaN(e)).sort((a, b) => a - b);
    if (!heard.length || recent.slice(-PER_SEC).every(Number.isNaN)) return null;
    return Math.round(heard[Math.floor(heard.length / 2)]);
  }

  private analyse(): void {
    const { frame, re, im, band, prev, bandOf } = this;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const x = frame[i];
      energy += x * x;
      re[i] = x * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    band.fill(0);
    for (let k = 1; k < FRAME / 2; k++) {
      const b = bandOf[k];
      if (b >= 0) band[b] += re[k] * re[k] + im[k] * im[k];
    }
    let flux = 0;
    for (let b = 0; b < BANDS; b++) {
      const c = Math.log(1 + (GAIN * Math.sqrt(band[b])) / (FRAME / 4));
      if (c > prev[b]) flux += c - prev[b];
      prev[b] = c;
    }
    // The first frame has nothing before it: everything in it would count as an onset.
    if (!this.primed) { this.primed = true; flux = 0; }
    if (this.n >= this.maxFrames) return;
    if (this.n === this.env.length) {
      const env = new Float32Array(this.env.length * 2);
      env.set(this.env);
      this.env = env;
      const level = new Float32Array(this.level.length * 2);
      level.set(this.level);
      this.level = level;
    }
    this.env[this.n] = flux;
    this.level[this.n] = Math.sqrt(energy / FRAME);
    this.n++;
    if (this.n >= FIRST_GUESS_SEC * this.envRate && this.n - this.lastEstimateAt >= this.envRate / PER_SEC) {
      this.lastEstimateAt = this.n;
      this.estimates.push(this.estimate());
    }
  }

  /** Tempo of the last window, or NaN. */
  private estimate(): number {
    const w = Math.min(this.n, this.winFrames);
    const start = this.n - w;
    let loud = 0;
    for (let i = 0; i < w; i++) if (this.level[start + i] > SILENCE_RMS) loud++;
    if (loud < MIN_LOUD * w) { this.lastGuess = null; return NaN; }
    const heard = this.pulse(start, w, this.specRe, this.specIm, 0.5, this.bpm);
    this.lastGuess = Math.round(heard.bpm);
    const guesses = this.guesses;
    guesses.push(heard.bpm);
    if (guesses.length > 3 * PER_SEC) guesses.shift();
    if (w < MIN_SEC * this.envRate || heard.movement < MIN_MOVEMENT) return NaN;
    // "Three in a row" is three seconds' worth: windows half a second apart barely differ.
    const agree = guesses.length === 3 * PER_SEC && guesses.every(g => Math.abs(g / heard.bpm - 1) <= AGREE);
    return heard.confidence >= SURE_LIVE || (agree && heard.confidence >= MIN_LIVE) ? heard.bpm : NaN;
  }

  /**
   * The tempo whose bar best explains the rhythm of `frames` envelope values from `start`.
   * `re`/`im` are scratch for the transform; `stay` is a tempo to prefer when it is close.
   */
  private pulse(start: number, frames: number, re: Float64Array, im: Float64Array, step: number, stay: number | null): { bpm: number; confidence: number; movement: number } {
    const { env, envRate } = this;
    let mean = 0;
    for (let i = 0; i < frames; i++) mean += env[start + i];
    mean /= frames;
    re.fill(0);
    im.fill(0);
    let movement = 0;
    for (let i = 0; i < frames; i++) {
      const e = env[start + i] - mean;
      re[i] = e;
      movement += e * e;
    }
    movement = Math.sqrt(movement / frames);
    fft(re, im);
    // From here the spectrum is addressed in BPM: bin i is i·perBin beats a minute.
    const perBin = (60 * envRate) / re.length;
    const first = Math.floor(SPECTRUM_LOW / perBin);
    const last = Math.min(re.length / 2 - 2, Math.ceil(SPECTRUM_HIGH / perBin));
    const mag = new Float32Array(last + 2);
    for (let i = first; i <= last + 1; i++) mag[i] = Math.hypot(re[i], im[i]);
    // What a bin holds when nothing repeats at its rate: only what stands above that counts.
    const floor = Float32Array.from(mag.subarray(first, last + 1)).sort()[Math.floor((last + 1 - first) / 2)];
    const at = (bpm: number) => {
      const x = bpm / perBin;
      const i = Math.floor(x);
      const f = x - i;
      return Math.max(0, mag[i] * (1 - f) + mag[i + 1] * f - floor);
    };
    const scores: number[] = [];
    let best = NaN;
    let bestWeighted = -Infinity;
    let bestAt = 0;
    for (let bpm = MIN_TEMPO; bpm <= MAX_TEMPO + 1e-6; bpm += step) {
      const bar = bpm / 4;
      let score = 0;
      for (let k = Math.ceil(SPECTRUM_LOW / bar); k * bar <= SPECTRUM_HIGH; k++) {
        // The beat and its halves (k = 4, 8, …) say the most about the tempo; the multiples
        // between them are the bar's pattern and tell 77 from 154, but any bar length has some.
        const weight = k % 4 === 0 ? 1 : k % 2 === 0 ? 0.6 : 0.4;
        score += weight * at(k * bar);
      }
      scores.push(score);
      const octaves = log2(bpm / this.reference) / PRIOR_OCTAVES;
      let weighted = score * Math.exp(-0.5 * octaves * octaves);
      // Stay with the tempo already showing unless another is clearly stronger.
      if (stay != null && Math.abs(log2(bpm / stay)) < 0.06) weighted *= 1.2;
      if (weighted > bestWeighted) { bestWeighted = weighted; best = bpm; bestAt = scores.length - 1; }
    }
    const top = scores[bestAt];
    scores.sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];
    const spread = scores.map(v => Math.abs(v - median)).sort((a, b) => a - b)[Math.floor(scores.length / 2)];
    return { bpm: best, confidence: (top - median) / Math.max(1e-12, 1.4826 * spread), movement };
  }

  /**
   * The take as a whole, once it is over: the single tempo that fits it best and where its
   * beats fall. Null when no steady pulse was heard (speech, one long note, a very short take).
   */
  finish(): SungTempo | null {
    const frames = Math.min(this.n, Math.round(FIT_SEC * this.envRate));
    if (frames < MIN_SEC * this.envRate) return null;
    let loud = 0;
    for (let i = 0; i < frames; i++) if (this.level[i] > SILENCE_RMS) loud++;
    if (loud < MIN_LOUD * frames) return null;
    const size = nextPow2(2 * frames);
    const whole = this.pulse(0, frames, new Float64Array(size), new Float64Array(size), 0.1, null);
    if (whole.movement < MIN_MOVEMENT) return null;
    // What the live readout showed, and for how much of the take it agreed with itself.
    const live = this.estimates.filter(e => !Number.isNaN(e)).sort((a, b) => a - b);
    const shown = live.length ? live[Math.floor(live.length / 2)] : NaN;
    const agreeing = live.filter(e => Math.abs(foldTempo(e, shown) / shown - 1) <= STEADY_RATIO).length;
    const share = agreeing >= 4 * PER_SEC ? agreeing / this.estimates.length : 0;
    const clear = whole.confidence >= MIN_TAKE;
    if (!clear && share < LIVE_OFFER) return null;
    // The whole take's own answer when it is clear or says the same; else what was shown.
    const centre = clear || Math.abs(foldTempo(whole.bpm, shown) / shown - 1) <= AGREE ? whole.bpm : shown;
    const sure = clear || share >= LIVE_SURE;

    let mean = 0;
    for (let i = 0; i < frames; i++) mean += this.env[i];
    mean /= frames;
    /** The envelope's strength at `hz` and at twice it (syllables on the half beat). */
    const fit = (bpm: number) => {
      const hz = bpm / 60;
      const one = this.fourier(hz, frames, mean);
      const two = this.fourier(hz * 2, frames, mean);
      return { one, two, score: one.mag + 0.5 * two.mag };
    };
    let bpm = centre;
    let top = -Infinity;
    for (let c = centre - 0.3; c <= centre + 0.3; c += 0.02) { const s = fit(c).score; if (s > top) { top = s; bpm = c; } }
    bpm = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(bpm * 10) / 10));

    const { one, two } = fit(bpm);
    const beat = 60 / bpm;
    // The angle of the fit is where the pulse sits. With every syllable on the half beat the
    // beat itself cancels out, so then the half-beat pulse places it.
    const phase = one.mag >= 0.3 * two.mag
      ? (((-one.angle / (2 * Math.PI)) * beat) % beat + beat) % beat
      : (((-two.angle / (2 * Math.PI)) * (beat / 2)) % (beat / 2) + beat / 2) % (beat / 2);

    // Did the singer hold that tempo? 70 and 140 are the same pulse, so fold before comparing.
    const heard = this.estimates.filter(e => !Number.isNaN(e)).map(e => foldTempo(e, bpm)).sort((a, b) => a - b);
    const voiceAt = this.voiceStart(frames);
    if (heard.length < 3) return { bpm, phase, steady: true, low: Math.round(bpm), high: Math.round(bpm), voiceAt, sure };
    const near = heard.filter(e => Math.abs(e / bpm - 1) <= STEADY_RATIO).length;
    const low = Math.round(heard[Math.floor((heard.length - 1) * 0.1)]);
    const high = Math.round(heard[Math.ceil((heard.length - 1) * 0.9)]);
    return { bpm, phase, steady: near >= heard.length * 0.7, low, high, voiceAt, sure };
  }

  /** Where the singing starts, in seconds: the first 150 ms that is mostly at singing level. */
  private voiceStart(frames: number): number {
    const { level, envRate } = this;
    const sorted = Float32Array.from(level.subarray(0, frames)).sort();
    // A breath or the room before the first line is far below the voice itself.
    const singing = Math.max(SILENCE_RMS, 0.15 * sorted[Math.floor((frames - 1) * 0.95)]);
    const run = Math.max(1, Math.round(0.15 * envRate));
    let above = 0;
    for (let i = 0; i < frames; i++) {
      if (level[i] > singing) above++;
      if (i >= run && level[i - run] > singing) above--;
      if (above >= 0.8 * run) return Math.max(0, (i - run + 1 + FRAME / HOP / 2) / envRate);
    }
    return 0;
  }

  /** One Fourier coefficient of the envelope's first `frames` values, in real seconds. */
  private fourier(hz: number, frames: number, mean: number): { mag: number; angle: number } {
    const { env, envRate } = this;
    // Frame i reports what changed going into it: about one window minus half a hop in.
    const t0 = ((FRAME - HOP / 2) / HOP) / envRate;
    const step = (-2 * Math.PI * hz) / envRate;
    const cs = Math.cos(step);
    const sn = Math.sin(step);
    let c = Math.cos(-2 * Math.PI * hz * t0);
    let s = Math.sin(-2 * Math.PI * hz * t0);
    let re = 0;
    let im = 0;
    for (let i = 0; i < frames; i++) {
      const e = env[i] - mean;
      re += e * c;
      im += e * s;
      const nc = c * cs - s * sn;
      s = c * sn + s * cs;
      c = nc;
    }
    return { mag: Math.hypot(re, im) / Math.max(1, frames), angle: Math.atan2(im, re) };
  }
}
