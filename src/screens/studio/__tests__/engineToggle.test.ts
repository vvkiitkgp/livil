jest.mock('react-native-audio-api', () => {
  const m = require('react-native-audio-api/src/mock/index');
  const noop = () => {};
  return { ...m, AudioManager: { setAudioSessionOptions: noop, setAudioSessionActivity: async () => true, getDevicesInfo: async () => ({ availableInputs: [], availableOutputs: [], currentInputs: [], currentOutputs: [] }), addSystemEventListener: () => ({ remove: noop }), setInputDevice: async () => true, getDevicePreferredSampleRate: () => 44100 } };
});
import { DEFAULT_FX } from '../../../utils/audioFx/effects';
import { DRUM_PRESETS, clonePattern } from '../../../utils/drums';
import { StudioEngine, type Project, type VoiceLane } from '../studioEngine';

const SR = 44100;
const take = (len: number, id: string) => {
  const x = new Float32Array(len).map((_, i) => 0.1 * Math.sin(i / 10));
  return { id, sampleRate: SR, raw: x, tuned: new Float32Array(x), original: x, tune: { key: { tonic: 8, mode: 'major' as const }, strength: 0.24, clean: true }, clicksRepaired: true };
};

// The Editor's Clean switch replaces a voice's take mid-session; playback afterwards must schedule
// the same handful of sounds as before (2026-11-02: the app was killed after this sequence).
it('play → clean toggle → play does not run away', async () => {
  const lane: VoiceLane = { id: 'v1', name: 'Voice 1', take: take(SR * 20, 't1'), start: 0, trimStart: 0, trimEnd: 20, loops: 1, volume: 1.5, level: 0.52, tuneOn: false, fx: { ...DEFAULT_FX, reverb: { ...DEFAULT_FX.reverb } } };
  const p: Project = {
    voices: [lane], drumsOn: true, pattern: clonePattern(DRUM_PRESETS[2].pattern), drumVolume: 0.87, masterVolume: 1.56, bpm: 77, range: null,
    synths: [
      { id: 's1', sound: 'pad', key: { tonic: 8, mode: 'major' }, volume: 0.06, chords: 'drive', notes: [] },
      { id: 's2', sound: 'keys', key: { tonic: 8, mode: 'major' }, volume: 0.32, chords: 'emotional', notes: [] },
    ],
  };
  const e = new StudioEngine(p);
  jest.useFakeTimers();
  await e.init();
  const ctx = (e as any).ctx;
  let sources = 0;
  const orig = ctx.createBufferSource.bind(ctx);
  ctx.createBufferSource = (o: any) => { sources++; if (sources > 5000) throw new Error('RUNAWAY'); return orig(o); };
  const advance = (sec: number) => { ctx._currentTime += sec; (e as any).tick(); };
  e.setProject(p);
  await e.play();
  for (let i = 0; i < 40; i++) advance(0.025);
  const before = sources;
  e.stop();
  const p2 = { ...p, voices: [{ ...lane, take: { ...take(SR * 20, 't2'), tune: { ...lane.take.tune, clean: false } }, level: 0.6 }] };
  e.setProject(p2);
  sources = 0;
  await e.play();
  for (let i = 0; i < 40; i++) advance(0.025);
  expect(sources).toBeLessThanOrEqual(before + 2);
  expect((e as any).buffers.size).toBe(1); // the voice's buffers were refilled, not re-made
  jest.useRealTimers();
});
