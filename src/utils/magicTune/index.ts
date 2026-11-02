/**
 * Magic Tune — the Editor's pitch correction ("Auto-Tune" is a trademark; never show it).
 * On-device, after recording, pure TypeScript (ADR-0035 Route A spike): detect → snap to
 * the key → PSOLA shift. Nothing here touches an audio engine or the network.
 */
import { detectPitch, type PitchTrack } from './pitch';
import { psolaShift } from './psola';
import { hzToMidi, rankKeys, scaleOf, snapMidi, type Key } from './scale';

export * from './scale';
export { detectPitch, type PitchTrack } from './pitch';

export type TuneAnalysis = {
  track: PitchTrack;
  /** All 24 keys, best fit first. */
  keys: Key[];
};

export type TuneSettings = {
  key: Key;
  /** 0 = gentle polish … 1 = full robot (instant snap, full correction). */
  strength: number;
};

export type TuneCurve = {
  /** Pitch ratio per frame (1 = untouched). */
  ratio: Float32Array;
  /** Sung pitch per frame in MIDI, NaN when unvoiced. For the pitch-trail graph. */
  sungMidi: Float32Array;
  /** Pitch after correction per frame in MIDI, NaN when unvoiced. */
  tunedMidi: Float32Array;
};

export async function analyzeTake(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (fraction: number) => void,
): Promise<TuneAnalysis> {
  const track = await detectPitch(samples, sampleRate, onProgress);
  return { track, keys: rankKeys(track) };
}

/** Labels the strength slider shows. */
export function strengthLabel(s: number): string {
  return s < 0.34 ? 'Gentle polish' : s < 0.75 ? 'Pop vocal' : 'Full robot';
}

/** A note shorter than this is a slide or a blip, not a note: it joins the note before it. */
const MIN_NOTE_SEC = 0.08;

/**
 * Pulls every voiced frame onto a note line of the key — strictly: a held note always ends
 * up exactly on its line, whatever the strength. Strength only sets how the voice MOVES
 * between notes:
 * - robot (1): an instant jump, so the trail is flat lines joined by vertical steps
 * - gentle (0): a ≈80 ms glide, which also lets a little vibrato ride through
 * A small hysteresis keeps a note held between two scale notes from flapping, and notes
 * shorter than MIN_NOTE_SEC (the scoop into a note, a crack) take the previous note.
 */
export function correctionCurve(track: PitchTrack, settings: TuneSettings): TuneCurve {
  const n = track.f0.length;
  const ratio = new Float32Array(n).fill(1);
  const sungMidi = new Float32Array(n).fill(Number.NaN);
  const tunedMidi = new Float32Array(n).fill(Number.NaN);
  const s = Math.min(1, Math.max(0, settings.strength));
  const scale = scaleOf(settings.key);
  const hopSec = track.hop / track.sampleRate;

  // 1. The note each voiced frame belongs to.
  const note = new Float32Array(n).fill(Number.NaN);
  let held = Number.NaN;
  for (let k = 0; k < n; k++) {
    const hz = track.f0[k];
    if (hz <= 0) { held = Number.NaN; continue; }
    const midi = hzToMidi(hz);
    sungMidi[k] = midi;
    if (Number.isNaN(held) || Math.abs(midi - held) > 0.6 || !scale[((held % 12) + 12) % 12]) held = snapMidi(midi, scale);
    note[k] = held;
  }

  // 2. Short runs are not notes: give them the note before (or after, at a phrase start).
  const minFrames = Math.max(1, Math.round(MIN_NOTE_SEC / hopSec));
  for (let k = 0; k < n;) {
    if (Number.isNaN(note[k])) { k++; continue; }
    let e = k;
    while (e + 1 < n && note[e + 1] === note[k]) e++;
    const short = e - k + 1 < minFrames;
    const prev = k > 0 ? note[k - 1] : Number.NaN;
    const next = e + 1 < n ? note[e + 1] : Number.NaN;
    const into = !Number.isNaN(prev) ? prev : next;
    if (short && !Number.isNaN(into)) for (let j = k; j <= e; j++) note[j] = into;
    k = e + 1;
  }

  // 3. Move onto the notes: a jump at robot, a short glide at gentle.
  const tau = 0.001 + 0.08 * Math.pow(1 - s, 1.5);
  const alpha = 1 - Math.exp(-hopSec / tau);
  // A frame or two of "no pitch" where the voice changes note is not a new phrase: keep gliding.
  const bridge = Math.round(0.06 / hopSec);
  let out = Number.NaN;
  let gap = 0;
  for (let k = 0; k < n; k++) {
    if (Number.isNaN(note[k])) { if (++gap > bridge) out = Number.NaN; continue; }
    gap = 0;
    out = Number.isNaN(out) ? note[k] : out + alpha * (note[k] - out);
    const corr = out - sungMidi[k];
    ratio[k] = Math.min(1.5, Math.max(0.67, Math.pow(2, corr / 12)));
    tunedMidi[k] = sungMidi[k] + Math.log2(ratio[k]) * 12;
  }
  return { ratio, sungMidi, tunedMidi };
}

export function applyMagicTune(
  samples: Float32Array,
  analysis: TuneAnalysis,
  settings: TuneSettings,
): { tuned: Float32Array; curve: TuneCurve } {
  const curve = correctionCurve(analysis.track, settings);
  return { tuned: psolaShift(samples, analysis.track, curve.ratio), curve };
}
