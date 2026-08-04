/**
 * Tests for the ANALYZER — the write path.
 *
 * `waveform.test.ts` covers `sampleFeatures`, the read path. The analyzer itself was
 * explicitly uncovered (`.claude/autonomy-config.yml`: "the sampling read path is covered;
 * the decoder is not"). It has just been extracted to `shared/` so the web dashboard runs
 * the identical algorithm, which raises the stakes: output from either client is persisted
 * to `tracks.waveform_peaks` and rendered by the mobile visualizer, so a drift here is
 * silent and cross-platform.
 *
 * These assert the contract the renderer depends on, not the exact float values — pinning
 * floats would make every legitimate tuning change look like a regression.
 */
import {
  analyzeDecodedAudio,
  WAVEFORM_HZ,
  WAVEFORM_VERSION,
  type DecodedAudio,
} from '../../../shared/services/waveformDsp';

/** Build a DecodedAudio from a per-sample generator. */
function buffer(
  seconds: number,
  sampleRate: number,
  gen: (t: number) => number,
  channels = 1,
): DecodedAudio {
  const length = Math.max(1, Math.round(seconds * sampleRate));
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = gen(i / sampleRate);
  return {
    length,
    numberOfChannels: channels,
    sampleRate,
    getChannelData: () => data,
  };
}

const tone = (hz: number, amp = 0.8) => (t: number) => Math.sin(2 * Math.PI * hz * t) * amp;

describe('analyzeDecodedAudio — rejects unusable input', () => {
  it('returns null for an empty buffer', async () => {
    expect(await analyzeDecodedAudio(buffer(0, 16000, () => 0))).toBeNull();
  });

  it('returns null when there are no channels', async () => {
    const b = { ...buffer(1, 16000, tone(200)), numberOfChannels: 0 };
    expect(await analyzeDecodedAudio(b)).toBeNull();
  });

  it('returns null for silence rather than animating quantization noise', async () => {
    expect(await analyzeDecodedAudio(buffer(2, 16000, () => 0))).toBeNull();
  });

  it('returns null for near-silence below the RMS floor', async () => {
    expect(await analyzeDecodedAudio(buffer(2, 16000, tone(200, 0.001)))).toBeNull();
  });

  it('skips tracks over the duration cap', async () => {
    // A tiny sample rate keeps this cheap: 10000 frames at 10 Hz is 1000 simulated
    // seconds, well past the 600 s cap, without allocating a 10-minute buffer.
    const long = { ...buffer(1, 10, tone(2)), length: 10000, sampleRate: 10 };
    expect(await analyzeDecodedAudio(long)).toBeNull();
  });
});

describe('analyzeDecodedAudio — output contract', () => {
  it('emits a v2 row the renderer can index by position', async () => {
    const data = await analyzeDecodedAudio(buffer(3, 16000, tone(120)));
    expect(data).not.toBeNull();
    expect(data!.version).toBe(WAVEFORM_VERSION);
    expect(data!.hz).toBe(WAVEFORM_HZ);
    expect(data!.sr).toBe(16000);
  });

  it('spans the full track at the declared bucket rate', async () => {
    const seconds = 4;
    const data = await analyzeDecodedAudio(buffer(seconds, 16000, tone(120)));
    // position→index is floor(positionSec * hz), so the array must cover the whole track.
    expect(data!.peaks.length).toBeGreaterThanOrEqual(seconds * WAVEFORM_HZ - 1);
    expect(data!.peaks.length).toBeLessThanOrEqual(seconds * WAVEFORM_HZ + 1);
  });

  it('populates every v2 channel at the same length', async () => {
    const data = await analyzeDecodedAudio(buffer(3, 16000, tone(120)));
    const n = data!.peaks.length;
    expect(data!.bass).toHaveLength(n);
    expect(data!.flux).toHaveLength(n);
    expect(data!.centroid).toHaveLength(n);
  });

  it('keeps every channel normalized to 0..1', async () => {
    const data = await analyzeDecodedAudio(buffer(3, 16000, tone(120)));
    for (const channel of [data!.peaks, data!.bass!, data!.flux!, data!.centroid!]) {
      for (const v of channel) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('downmixes multi-channel audio without changing the bucket count', async () => {
    const mono = await analyzeDecodedAudio(buffer(3, 16000, tone(120), 1));
    const stereo = await analyzeDecodedAudio(buffer(3, 16000, tone(120), 2));
    expect(stereo!.peaks).toHaveLength(mono!.peaks.length);
  });
});

/**
 * Every channel is normalized against ITS OWN 95th percentile, per track. So comparing a
 * channel's mean ACROSS two tracks proves nothing — a pure 100 Hz tone and a pure 5 kHz
 * tone both normalize to ~1.0 on every bucket, because each is constant within itself.
 *
 * The channels only carry meaning RELATIVE to the rest of the same track, which is exactly
 * how the renderer consumes them: it samples one track at the live position. So these
 * compare regions within a single track.
 */
describe('analyzeDecodedAudio — the channels mean what the renderer thinks', () => {
  const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;

  /** Four seconds: 100 Hz for the first half, 5 kHz for the second. */
  const twoHalves = () =>
    analyzeDecodedAudio(buffer(4, 16000, t => (t < 2 ? tone(100)(t) : tone(5000)(t))));

  it('puts the bass energy in the bass half', async () => {
    const data = await twoHalves();
    const half = Math.floor(data!.bass!.length / 2);
    // bass drives the wave's resting swell; inverted, a bass-heavy track renders flat.
    expect(mean(data!.bass!.slice(0, half))).toBeGreaterThan(
      mean(data!.bass!.slice(half)),
    );
  });

  it('puts the brightness in the treble half', async () => {
    const data = await twoHalves();
    const half = Math.floor(data!.centroid!.length / 2);
    // centroid drives scroll SPEED — "singer goes high → faster".
    expect(mean(data!.centroid!.slice(half))).toBeGreaterThan(
      mean(data!.centroid!.slice(0, half)),
    );
  });

  it('fires flux on attacks, not during sustain', async () => {
    // A repeating kick: sharp attack every 0.5 s, quiet sustain between. Repeated onsets
    // matter — with a single onset the 95th-percentile reference is drawn from the quiet
    // tail, which saturates most buckets to 1.0 and the channel stops discriminating.
    const period = 0.5;
    const data = await analyzeDecodedAudio(
      buffer(6, 16000, t => {
        const phase = t % period;
        return tone(120)(t) * (phase < 0.05 ? 1 : 0.15);
      }),
    );

    const at = (sec: number) => data!.flux![Math.floor(sec * WAVEFORM_HZ)] ?? 0;
    const onsets: number[] = [];
    const gaps: number[] = [];
    // Skip the first period: there is no previous frame to difference against.
    for (let k = 1; k * period < 6; k++) {
      onsets.push(at(k * period));
      gaps.push(at(k * period + period / 2));
    }
    expect(mean(onsets)).toBeGreaterThan(mean(gaps));
  });
});
