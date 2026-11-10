/**
 * renderMix against a fake react-native-audio-api that enforces the real library's rule: at
 * most 1024 graph messages (a node created, a connect) between two drains, and a drain only
 * happens while rendering. The owner's iPhone froze for good on a song that broke it
 * (2026-11-10). The fake also keeps the wrapper's single "is suspended" flag, so a resume the
 * real library would refuse fails here too.
 */
const QUEUE = 1024;
const RENDER_QUANTUM = 128;
const mockState = { pending: 0, maxPending: 0, frame: 0, sr: 48000, late: 0, started: 0 };

jest.mock('react-native-audio-api', () => {
  const note = () => {
    mockState.pending++;
    mockState.maxPending = Math.max(mockState.maxPending, mockState.pending);
    if (mockState.pending > QUEUE) throw new Error('graph queue overflow: the real library would hang here');
  };
  const param = (value = 1) => ({ value, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined });
  class Node { connect() { note(); } }
  class GainNode extends Node { gain: ReturnType<typeof param>; constructor(_c: unknown, o: { gain?: number } = {}) { super(); note(); this.gain = param(o.gain ?? 1); } }
  class BiquadFilterNode extends Node { constructor() { super(); note(); } }
  class Source extends Node {
    buffer: unknown = null; detune = param(0);
    constructor() { super(); note(); }
    getLatency() { return 0; }
    start(when: number) {
      mockState.started++;
      // A source must exist before the render passes its start.
      if (Math.round(when * mockState.sr) < mockState.frame) mockState.late++;
    }
  }
  class OfflineAudioContext {
    destination = {};
    private length: number;
    private suspends: { frame: number; resolve: () => void }[] = [];
    private isSuspended = false;
    private isRendering = false;
    private resumeFn: (() => void) | null = null;
    get currentTime() { return mockState.frame / mockState.sr; }
    constructor(o: { length: number; sampleRate: number }) {
      this.length = o.length; mockState.sr = o.sampleRate;
      Object.assign(mockState, { pending: 0, maxPending: 0, frame: 0, late: 0, started: 0 });
    }
    createBuffer() { return { copyToChannel: () => undefined }; }
    createBufferSource() { return new Source(); }
    createConvolver() { note(); return Object.assign(new Node(), { normalize: false, buffer: null }); }
    suspend(t: number) {
      if (t < this.currentTime || t > this.length / mockState.sr) return Promise.reject(new Error('bad suspend time'));
      this.isSuspended = true;
      const frame = Math.ceil((t * mockState.sr) / RENDER_QUANTUM) * RENDER_QUANTUM;
      return new Promise<void>(resolve => { this.suspends.push({ frame, resolve }); this.suspends.sort((a, b) => a.frame - b.frame); });
    }
    /** The wrapper's resume, with its single flag (the real one refuses the same way). */
    resume() {
      if (!this.isRendering || !this.isSuspended) return Promise.reject(new Error('resume refused'));
      this.isSuspended = false;
      return this.context.resume();
    }
    /** The native context underneath: resumes whenever the render is actually paused. */
    context = {
      resume: () => {
        const go = this.resumeFn; this.resumeFn = null;
        if (!go) return Promise.reject(new Error('native resume while not paused'));
        go();
        return Promise.resolve();
      },
    };
    startRendering() {
      this.isRendering = true;
      return new Promise(resolve => {
        const run = () => {
          mockState.pending = 0; // the render drains the queue
          const next = this.suspends.shift();
          if (next && next.frame < this.length) {
            mockState.frame = next.frame;
            this.resumeFn = run;
            next.resolve();
            return;
          }
          mockState.frame = this.length;
          resolve({ numberOfChannels: 2, getChannelData: () => new Float32Array(this.length) });
        };
        setTimeout(run, 0);
      });
    }
  }
  return { GainNode, BiquadFilterNode, OfflineAudioContext };
});

import { DRUM_PRESETS } from '../../../utils/drums';
import { planBatches, renderMix } from '../renderMix';
import type { Project, VoiceLane } from '../studioEngine';

const SR = 48000;
const voice = (seconds: number): VoiceLane => ({
  id: 'v1', name: 'Voice 1',
  take: { id: 't', sampleRate: SR, raw: new Float32Array(seconds * SR), tuned: null, original: new Float32Array(0), tune: null } as unknown as VoiceLane['take'],
  start: 1.853, trimStart: 0, trimEnd: seconds, loops: 1, volume: 1, level: 1, tuneOn: false,
  fx: { pitch: 0, reverb: { on: false, mix: 0, size: 0.5 } } as unknown as VoiceLane['fx'],
});

/** The owner's iPhone draft: a 44 s voice, drums on, a fingerpicked guitar and a pad, 106.4 BPM. */
const iphoneDraft = (): Project => ({
  voices: [voice(44.441)],
  drumsOn: true,
  pattern: DRUM_PRESETS[0].pattern,
  drumVolume: 0.9,
  masterVolume: 1,
  synths: [
    { id: 's1', sound: 'pick', key: { tonic: 0, mode: 'major' }, volume: 1, chords: 'pop', notes: [] },
    { id: 's2', sound: 'pad', key: { tonic: 0, mode: 'major' }, volume: 1, chords: 'pop', notes: [] },
  ] as unknown as Project['synths'],
  bpm: 106.4,
  range: null,
});

describe('renderMix and the graph queue', () => {
  beforeAll(() => { if (!process.env.MIXLOG) jest.spyOn(console, 'log').mockImplementation(() => undefined); });

  it('finishes the song that froze the iPhone, never over the queue, every sound in time', async () => {
    const mix = await renderMix(iphoneDraft());
    expect(mix.seconds).toBeGreaterThan(40);
    expect(mockState.maxPending).toBeLessThanOrEqual(QUEUE);
    expect(mockState.late).toBe(0);
    expect(mockState.started).toBeGreaterThan(500); // it really is a big song: drums + guitar + pad
  }, 60000);

  it('a long song (many batches) finishes, every batch under the queue, every sound in time', async () => {
    const p = iphoneDraft();
    p.voices = [{ ...voice(44.441), loops: 6 }];
    const mix = await renderMix(p);
    expect(mix.seconds).toBeGreaterThan(260);
    expect(mockState.maxPending).toBeLessThanOrEqual(QUEUE);
    expect(mockState.late).toBe(0);
    expect(mockState.started).toBeGreaterThan(2800);
  }, 120000);
});

describe('planBatches', () => {
  it('keeps every batch under the cap, the first one including the fixed cost', () => {
    const at = Array.from({ length: 1000 }, (_, i) => i * 0.05);
    const cost = at.map(() => 3);
    const b = planBatches(at, cost, 700, 100, 60);
    expect(b.flat()).toEqual(at.map((_, i) => i));
    expect(b[0].reduce((n, i) => n + cost[i], 100)).toBeLessThanOrEqual(700);
    for (const batch of b.slice(1)) expect(batch.reduce((n, i) => n + cost[i], 0)).toBeLessThanOrEqual(700);
  });

  it('never starts two batches at the same moment, or at the very start or end', () => {
    const at = Array.from({ length: 900 }, (_, i) => Math.floor(i / 300) * 2); // 300 sounds at each of 0, 2, 4 s
    const b = planBatches(at, at.map(() => 2), 100, 0, 5);
    const starts = b.slice(1).map(x => at[x[0]]);
    expect(new Set(starts).size).toBe(starts.length);
    for (const t of starts) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThan(5); }
  });
});
