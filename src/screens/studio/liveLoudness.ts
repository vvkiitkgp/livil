/**
 * How loud the live Editor mix is, estimated from the project — so the live master gain can do
 * to the Editor what mastering does to the post (loudness to TARGET_LUFS), and editing, "Your
 * song" and the posted file sound the same. A fixed trim could not: a real voice take left the
 * raw mix at −17.5 LUFS and the post at −11.6 (2026-11-10), 6 dB apart, and the gap moves with
 * every song.
 *
 * A take's PROFILE is its K-weighted power per 100 ms hop, measured once (one pass over the
 * take, async with yields; a few KB per minute of audio). The mix estimate then only adds hop
 * powers: each voice where it sits on the timeline, the drum pattern on its steps, each synth
 * part's hits — powers add because the parts are uncorrelated — then the meter's own 400 ms
 * gating. Left out on purpose: reverb (a little extra energy), pitch/latency shifts (well under
 * a hop), the limiter (it barely moves integrated loudness).
 *
 * Pure. The engine owns the profile cache (a WeakMap on the take data, so nothing here keeps a
 * take alive).
 */
import { gatedLufs, KFilter, TARGET_LUFS } from '../../utils/audioFx/master';
import { DRUM_IDS, STEPS, synthDrum } from '../../utils/drums';
import { renderSynth, synthHits, SYNTH_STEPS } from '../../utils/synth';
import type { SongRange } from './timeline';
import type { Project, VoiceLane } from './studioEngine';

export const HOP_SEC = 0.1;
/** What the render turns the mix down by before mastering (renderMix's RENDER_GAIN, 1/8)… */
const RENDER_GAIN_DB = 20 * Math.log10(1 / 8);
/** …and the most mastering may turn it back up (masterInPlace's cap). */
const MAX_MASTER_GAIN_DB = 24;
/** Every lane is mono and the speaker is stereo, so the meter hears the live mix as dual-mono. */
const DUAL_MONO_DB = 3.0103;

/** Mean K-weighted power per 100 ms hop. */
export type Profile = Float64Array;

const yieldUi = () => new Promise<void>(r => setTimeout(r, 0));

function profileInto(samples: Float32Array, sampleRate: number, hops: Float64Array, hopLen: number): void {
  const k = new KFilter(sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const v = k.step(samples[i]);
    hops[(i / hopLen) | 0] += v * v;
  }
  for (let j = 0; j < hops.length; j++) hops[j] /= hopLen;
}

/** A take's profile: one pass, yielding every ~260k samples so the screen stays live. */
export async function takeProfile(samples: Float32Array, sampleRate: number): Promise<Profile> {
  const hopLen = Math.round(sampleRate * HOP_SEC);
  const hops = new Float64Array(Math.ceil(samples.length / hopLen));
  const k = new KFilter(sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const v = k.step(samples[i]);
    hops[(i / hopLen) | 0] += v * v;
    if ((i & 0x3ffff) === 0x3ffff) await yieldUi();
  }
  for (let j = 0; j < hops.length; j++) hops[j] /= hopLen;
  return hops;
}

/** A one-shot sound's profile (drum hit, synth chord), synchronous: these are short. */
function shortProfile(samples: Float32Array, sampleRate: number): Profile {
  const hopLen = Math.round(sampleRate * HOP_SEC);
  const hops = new Float64Array(Math.ceil(samples.length / hopLen));
  profileInto(samples, sampleRate, hops, hopLen);
  return hops;
}

const drumProfiles = new Map<string, Profile>();
const synthProfiles = new Map<string, Profile>();
const SYNTH_PROFILES_MAX = 96;

function drumProfile(id: (typeof DRUM_IDS)[number], sampleRate: number): Profile {
  const key = `${id}@${sampleRate}`;
  let p = drumProfiles.get(key);
  if (!p) { p = shortProfile(synthDrum(id, sampleRate), sampleRate); drumProfiles.set(key, p); }
  return p;
}

/** The audio a lane plays: the tuned take when Magic Tune is on, else the raw one. */
export const takeData = (v: VoiceLane): Float32Array => (v.tuneOn && v.take.tuned ? v.take.tuned : v.take.raw);

/** Mirrors studioEngine's clipLength (not imported: that module imports this one). */
const clipLen = (v: VoiceLane) => Math.max(0.05, v.trimEnd - v.trimStart);

/** Adds `gain²` × `profile` into `hops`, the sound starting `atSec` into the song. */
function addShort(hops: Float64Array, profile: Profile, atSec: number, gain: number): void {
  const g2 = gain * gain;
  const j0 = Math.floor(atSec / HOP_SEC);
  for (let m = 0; m < profile.length; m++) {
    const j = j0 + m;
    if (j < 0) continue;
    if (j >= hops.length) break;
    hops[j] += g2 * profile[m];
  }
}

/**
 * Integrated loudness (LUFS) of the live mix of `p` over `range`, from the takes' profiles, or
 * null while a voice's profile is still missing (`takeProfile` it, then ask again).
 */
export function estimateMixLufs(p: Project, range: SongRange, sampleRate: number, profiles: WeakMap<Float32Array, Profile>): number | null {
  const rs = range.start, re = range.end;
  const seconds = re - rs;
  const nHops = Math.max(1, Math.ceil(seconds / HOP_SEC));
  const hops = new Float64Array(nHops);

  for (const v of p.voices) {
    const prof = profiles.get(takeData(v));
    if (!prof) return null;
    const g2 = (v.volume * v.level) ** 2;
    const len = clipLen(v);
    for (let rep = 0; rep < v.loops; rep++) {
      const segS = v.start + rep * len;
      const a = Math.max(segS, rs), b = Math.min(segS + len, re);
      if (b <= a) continue;
      for (let j = Math.floor((a - rs) / HOP_SEC); j < nHops && rs + j * HOP_SEC < b; j++) {
        const takeSec = v.trimStart + (rs + j * HOP_SEC - segS);
        const idx = Math.floor(takeSec / HOP_SEC);
        if (idx >= 0 && idx < prof.length) hops[j] += g2 * prof[idx];
      }
    }
  }

  const stepSec = 60 / p.bpm / 4;
  const firstStep = Math.round(rs / stepSec);
  const hasBeat = p.drumsOn && DRUM_IDS.some(id => p.pattern[id].some(Boolean));
  if (hasBeat) {
    for (let k = 0; k * stepSec < seconds - 1e-6; k++) {
      const step = (firstStep + k) % STEPS;
      for (const id of DRUM_IDS) {
        if (p.pattern[id][step]) addShort(hops, drumProfile(id, sampleRate), k * stepSec, p.drumVolume);
      }
    }
  }

  for (const part of p.synths) {
    const hits = synthHits(part);
    for (let k = 0; k * stepSec < seconds - 1e-6; k++) {
      for (const h of hits[(firstStep + k) % SYNTH_STEPS]) {
        const key = `${part.sound}|${h.midis.join(',')}|${h.len}|${h.gap || ''}${h.mute ? 'x' : ''}${h.cut ? 'c' : ''}${h.hard !== undefined && h.hard < 1 ? `h${h.hard}` : ''}@${sampleRate}@${stepSec.toFixed(4)}`;
        let prof = synthProfiles.get(key);
        if (!prof) {
          prof = shortProfile(renderSynth(part.sound, h.midis, h.len * stepSec, sampleRate, h), sampleRate);
          if (synthProfiles.size >= SYNTH_PROFILES_MAX) synthProfiles.delete(synthProfiles.keys().next().value!);
          synthProfiles.set(key, prof);
        }
        addShort(hops, prof, k * stepSec + (h.shift ?? 0), part.volume * (h.gain ?? 1));
      }
    }
  }

  const lufs = gatedLufs(hops, nHops, 1);
  return Number.isFinite(lufs) ? lufs + DUAL_MONO_DB : lufs;
}

/**
 * The gain (dB) mastering would add to a mix this loud, for the live master to copy: up to the
 * target, never more than the render can add back (its −18 dB in, +24 dB cap out), and never
 * a cut deeper than 12 dB. Silence (−Infinity) gets 0.
 */
export function liveMakeupDb(mixLufs: number): number {
  if (!Number.isFinite(mixLufs)) return 0;
  return Math.max(-12, Math.min(MAX_MASTER_GAIN_DB + RENDER_GAIN_DB, TARGET_LUFS - mixLufs));
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** How loud the post will come out (LUFS) for a mix this loud: the target, unless the render's gain cap leaves it short. */
export function postLufs(mixLufs: number): number {
  return Math.min(TARGET_LUFS, mixLufs + MAX_MASTER_GAIN_DB + RENDER_GAIN_DB);
}

/** The post will land this far under the target before the readout says so. */
const LOW_SHORTFALL_DB = 1.5;
/** Peaks this far over the safety curve's full scale: 4 dB past the ceiling, the master's limiting cap. */
const TOO_LOUD_PEAK_DB = 3;

export type LevelWord = 'Low' | 'Good' | 'Too loud';

/**
 * The Editor's level word. `peakDb` is the live peak relative to the safety curve's full scale
 * (engine.level()); `post` is postLufs(estimate), or null before the estimate is in.
 * - Low: the post will come out quieter than the target (the render can only add so much) —
 *   turn things up.
 * - Too loud: the peaks run past the limiter's cap, so the post would be squashed or shipped
 *   quieter, and the live safety curve is bending them — turn the loudest part down.
 * - Good: everything in between. Loudness itself is no longer the question: the live master
 *   already plays the mix as loud as the post will be.
 * Before the estimate is in, the old peak-only rule holds.
 */
export function levelWord(peakDb: number, post: number | null): LevelWord {
  if (post == null) return peakDb < -18 ? 'Low' : peakDb <= -3 ? 'Good' : 'Too loud';
  if (peakDb > TOO_LOUD_PEAK_DB) return 'Too loud';
  if (post < TARGET_LUFS - LOW_SHORTFALL_DB) return 'Low';
  return 'Good';
}
