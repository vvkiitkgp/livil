import { measureLufs } from '../../../utils/audioFx/master';
import { DRUM_IDS, DRUM_PRESETS, STEPS, synthDrum } from '../../../utils/drums';
import { estimateMixLufs, levelWord, liveMakeupDb, postLufs, takeProfile, type Profile } from '../liveLoudness';
import type { Project, VoiceLane } from '../studioEngine';

const SR = 48000;
const DUAL_MONO = 3.0103;

/** A voice-like take: phrases of a harmonic tone, 2 s on, 0.7 s off. */
function voiceTake(seconds: number, amp = 0.2): Float32Array {
  const x = new Float32Array(seconds * SR);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const phrase = (t % 2.7) < 2.0 ? 1 : 0;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * 220 * h * t) / h;
    x[i] = amp * v * phrase;
  }
  return x;
}

const lane = (raw: Float32Array, over: Partial<VoiceLane> = {}): VoiceLane => ({
  id: 'v1', name: 'Voice 1',
  take: { sampleRate: SR, raw, tuned: null, tune: null } as unknown as VoiceLane['take'],
  start: 0, trimStart: 0, trimEnd: raw.length / SR, loops: 1, volume: 1, level: 1, tuneOn: false,
  fx: { pitch: 0, reverb: { on: false, mix: 0, size: 0.5 } } as unknown as VoiceLane['fx'],
  ...over,
});

const project = (voices: VoiceLane[], over: Partial<Project> = {}): Project => ({
  voices, drumsOn: false, pattern: DRUM_PRESETS[0].pattern, drumVolume: 0.9, masterVolume: 1, synths: [], bpm: 92, range: null,
  ...over,
});

describe('live loudness estimate', () => {
  const raw = voiceTake(12);
  const profiles = new WeakMap<Float32Array, Profile>();
  beforeAll(async () => { profiles.set(raw, await takeProfile(raw, SR)); });

  it('is null until the voice has a profile', () => {
    expect(estimateMixLufs(project([lane(raw)]), { start: 0, end: 12 }, SR, new WeakMap())).toBeNull();
  });

  it('agrees with the meter on a single voice (dual-mono)', async () => {
    const est = estimateMixLufs(project([lane(raw)]), { start: 0, end: 12 }, SR, profiles)!;
    const metered = (await measureLufs([raw], SR)) + DUAL_MONO;
    expect(Math.abs(est - metered)).toBeLessThan(0.5);
  });

  it('follows the lane volume and level', () => {
    const full = estimateMixLufs(project([lane(raw)]), { start: 0, end: 12 }, SR, profiles)!;
    const half = estimateMixLufs(project([lane(raw, { volume: 0.5 })]), { start: 0, end: 12 }, SR, profiles)!;
    const lvl = estimateMixLufs(project([lane(raw, { level: 0.25 })]), { start: 0, end: 12 }, SR, profiles)!;
    expect(half).toBeCloseTo(full - 6.02, 1);
    expect(lvl).toBeCloseTo(full - 12.04, 1);
  });

  it('follows the trim and placement, and the song range', () => {
    // The same 12 s voice looped twice from 3 s in: the song is louder than silence + voice.
    const whole = estimateMixLufs(project([lane(raw)]), { start: 0, end: 12 }, SR, profiles)!;
    const placed = estimateMixLufs(project([lane(raw, { start: 3, trimStart: 2, trimEnd: 8, loops: 2 })]), { start: 0, end: 15 }, SR, profiles)!;
    expect(Math.abs(placed - whole)).toBeLessThan(1.5); // gating ignores the leading silence
    const outside = estimateMixLufs(project([lane(raw)]), { start: 20, end: 30 }, SR, profiles)!;
    expect(outside).toBe(-Infinity);
  });

  it('agrees with the meter on the drum pattern alone', async () => {
    // The same beat the render schedules: every step of the first preset at 92 BPM, hits summed.
    const seconds = 12, stepSec = 60 / 92 / 4;
    const x = new Float32Array(seconds * SR);
    const hits = Object.fromEntries(DRUM_IDS.map(id => [id, synthDrum(id, SR)]));
    for (let k = 0; k * stepSec < seconds; k++) {
      const at = Math.round(k * stepSec * SR);
      for (const id of DRUM_IDS) {
        if (!DRUM_PRESETS[0].pattern[id][k % STEPS]) continue;
        const h = hits[id];
        for (let i = 0; i < h.length && at + i < x.length; i++) x[at + i] += 0.9 * h[i];
      }
    }
    const est = estimateMixLufs(project([], { drumsOn: true }), { start: 0, end: seconds }, SR, profiles)!;
    const metered = (await measureLufs([x], SR)) + DUAL_MONO;
    expect(Math.abs(est - metered)).toBeLessThan(0.7);
  });

  it('adds the drums as power, so a beat makes the song louder and a muted beat changes nothing', () => {
    const quiet = estimateMixLufs(project([lane(raw)]), { start: 0, end: 12 }, SR, profiles)!;
    const beat = estimateMixLufs(project([lane(raw)], { drumsOn: true }), { start: 0, end: 12 }, SR, profiles)!;
    expect(beat).toBeGreaterThan(quiet + 0.3);
    const muted = estimateMixLufs(project([lane(raw)], { drumsOn: true, drumVolume: 0 }), { start: 0, end: 12 }, SR, profiles)!;
    expect(muted).toBeCloseTo(quiet, 3);
  });
});

describe('the level word', () => {
  it('says what the post will come out at', () => {
    expect(postLufs(-17.5)).toBeCloseTo(-11.56, 1); // the owner's mix: 0.6 dB short of the target
    expect(postLufs(-14)).toBe(-11);
    expect(postLufs(-22)).toBeCloseTo(-16.06, 1);
  });
  it('is Good when the post lands on target and the peaks stay under the limiter cap', () => {
    expect(levelWord(-1, -11)).toBe('Good');
    expect(levelWord(2.9, -11.5)).toBe('Good');
  });
  it('is Low when the post would come out quiet, whatever the peaks', () => {
    expect(levelWord(-1, -13)).toBe('Low');
    expect(levelWord(-20, -16)).toBe('Low');
  });
  it('is Too loud when the peaks run past the limiter cap, before anything else', () => {
    expect(levelWord(3.5, -11)).toBe('Too loud');
    expect(levelWord(6, -14)).toBe('Too loud');
  });
  it('falls back to the peak alone before the estimate is in', () => {
    expect(levelWord(-20, null)).toBe('Low');
    expect(levelWord(-10, null)).toBe('Good');
    expect(levelWord(0, null)).toBe('Too loud');
  });
});

describe('liveMakeupDb', () => {
  it('copies mastering: up to the target, capped by what the render can add back', () => {
    expect(liveMakeupDb(-17.5)).toBeCloseTo(24 - 18.06, 1); // the owner's real mix: gain cap
    expect(liveMakeupDb(-13)).toBeCloseTo(2, 5);
    expect(liveMakeupDb(-8)).toBeCloseTo(-3, 5);
    expect(liveMakeupDb(-40)).toBeCloseTo(5.94, 1);
    expect(liveMakeupDb(20)).toBe(-12);
    expect(liveMakeupDb(-Infinity)).toBe(0);
  });
});
