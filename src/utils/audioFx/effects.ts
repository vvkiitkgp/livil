/**
 * The Editor's per-voice effects — pitch and reverb — as plain settings plus the pure maths
 * the engine builds its audio from. No audio objects here, so it unit-tests.
 *
 * Echo and flanger were built and dropped (2026-10-31, owner: "not working properly, keep
 * only reverb"). Both need feedback, and react-native-audio-api REJECTS graph cycles.
 *
 * Reverb left the Editor too (2026-11-09, owner: "it's not working"). Its settings and the
 * engine's support stay, so drafts keep their shape, but nothing can switch it on: the
 * sheet shows Pitch only, and a draft saved with it on opens with it off (parseDraftFile).
 */

export type ReverbFx = {
  on: boolean;
  /** 0–1: small room → big hall (tail length). */
  size: number;
  mix: number;
};

export type VoiceFx = {
  /** Semitones up (+) or down (−), speed unchanged. 0 = as sung. */
  pitch: number;
  reverb: ReverbFx;
};

export const DEFAULT_FX: VoiceFx = {
  pitch: 0,
  reverb: { on: false, size: 0.5, mix: 0.3 },
};

/** The pitch slider's reach, in semitones each way (an octave). */
export const PITCH_RANGE = 12;

/** Is this voice changed from how it was sung? Lights the voice's PITCH button. */
export const anyFx = (fx: VoiceFx) => fx.pitch !== 0;

/** "+3 semitones", "−1 semitone", "As sung". */
export function pitchLabel(semitones: number): string {
  if (semitones === 0) return 'As sung';
  const n = Math.abs(semitones);
  return `${semitones > 0 ? '+' : '−'}${n} semitone${n === 1 ? '' : 's'}`;
}

/** Reverb tail length in seconds for a size 0–1. */
export function reverbSeconds(size: number): number {
  return 0.6 + 3 * Math.min(1, Math.max(0, size));
}

/**
 * A synthetic room: decaying noise, darker as it fades (a one-pole low-pass that closes over
 * the tail), with a short gap before it so the dry voice stays clear. Deterministic (seeded),
 * so the same size always sounds the same.
 */
export function reverbImpulse(seconds: number, sampleRate: number, seed = 7): Float32Array {
  const pre = Math.round(0.012 * sampleRate);
  const n = pre + Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  let s = seed >>> 0 || 1;
  let lp = 0;
  for (let i = pre; i < n; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const noise = (s / 0xffffffff) * 2 - 1;
    const t = (i - pre) / (n - pre);
    const env = Math.pow(1 - t, 2) * Math.exp(-3 * t);
    const cutoff = 0.9 - 0.75 * t;
    lp += cutoff * (noise - lp);
    out[i] = lp * env;
  }
  return out;
}

/** How far above full scale the live mix may go into the safety curve. */
export const HEADROOM = 3;
/** The volume sliders' top: 200% (+6 dB). Voices are levelled automatically, so more is never needed. */
export const VOLUME_MAX = 2;

/** The live safety curve's ceiling: the Editor's speaker output never goes past −1 dBFS. */
export const SAFETY_CEILING = 0.89;

/**
 * The LIVE Editor's safety net, for a WaveShaperNode fed at 1/headroom (a WaveShaper clamps
 * its input to ±1, so the mix is scaled down first and the curve scales it back up).
 * Untouched below 0.7 of full scale, then a smooth knee that levels off at SAFETY_CEILING, so
 * nothing ever reaches the library's full-scale "turn the whole moment down" (a buzz).
 *
 * It is NOT the master: a curve bends loud samples (distortion), so the posted song is never
 * rendered through it — renderMix masters with a real limiter (audioFx/master.ts, ADR-0037).
 * Levels are set so a normal mix stays under the knee here too.
 */
export function softLimitCurve(headroom = HEADROOM, points = 4097): Float32Array {
  const out = new Float32Array(points);
  const knee = 0.7;
  const room = SAFETY_CEILING - knee;
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * headroom;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    out[i] = Math.sign(x) * y;
  }
  return out;
}

/**
 * Where to start a pitch-shifted source so its sound lands ON the beat. The library's
 * time-stretcher (signalsmith, default preset) outputs everything `latency` seconds late
 * (~120 ms at 48 kHz) and nothing compensates for it, so a pitched voice drifted a 16th
 * behind the drums. Starts the source `latency` early; if that is already in the past,
 * starts now and skips ahead in the take by the same amount. The duration grows by
 * `latency` so the end of the segment is still heard (the extra input is never audible:
 * the node stops before it comes out).
 *
 * `when`/`offset`/`duration` are what an un-pitched source would get. Returns null when
 * nothing of the segment is left to hear.
 */
export function compensateLatency(
  when: number,
  offset: number,
  duration: number,
  now: number,
  latency: number,
): { when: number; offset: number; duration: number } | null {
  const start = when - latency;
  const late = Math.max(0, now - start);
  const d = duration + latency - late;
  if (d <= latency) return null;
  return { when: start + late, offset: offset + late, duration: d };
}
