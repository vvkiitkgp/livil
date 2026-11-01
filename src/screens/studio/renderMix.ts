/**
 * Renders the Editor project to a finished, MASTERED stereo mix — what gets posted (ADR-0036 §7,
 * ADR-0037). Built on react-native-audio-api's OfflineAudioContext with the same pieces as the
 * live engine (studioEngine.ts): each voice's chosen version (Magic Tuned or raw), its level,
 * trim, loops, volume, pitch and reverb; the drum loop; the synth parts; and only the part of
 * the song inside the trim (plus up to a second of reverb/synth tail). Muted things are left
 * out of the graph, not set to zero.
 *
 * Mastering (src/utils/audioFx/master.ts): the graph renders 18 dB quiet with NO shaper — the
 * library scales down any 128-frame block that goes over full scale (a buzz), and the old
 * shaper "limiter" distorted every loud peak. Then, in JS: a rumble filter, loudness to
 * −14 LUFS with a true-peak limiter at −1 dBTP, and clean fades. The Editor's "Song volume"
 * does not apply here: it is for listening while you work.
 */
import { BiquadFilterNode, GainNode, OfflineAudioContext } from 'react-native-audio-api';
import { compensateLatency, reverbImpulse, reverbSeconds } from '../../utils/audioFx/effects';
import { edgeRamp, resample } from '../../utils/audioFx/level';
import { finishEnds, masterInPlace, type MasterReport } from '../../utils/audioFx/master';
import { DRUM_IDS, STEPS, synthDrum } from '../../utils/drums';
import { renderSynth, SYNTH_STEPS, synthHits } from '../../utils/synth';
import { clipLength, songRange, type Project } from './studioEngine';

export type Mix = { channels: Float32Array[]; sampleRate: number; seconds: number; master: MasterReport | null };

/** How far under full scale the graph renders, so no block ever reaches the destination's normaliser. */
const RENDER_GAIN = 1 / 8; // −18 dB
/** Reverb and synth release ring on past the trim by up to this much. */
const TAIL_SEC = 1;

export async function renderMix(project: Project, onProgress?: (fraction: number) => void): Promise<Mix> {
  const sampleRate = project.voices[0]?.take.sampleRate ?? 48000;
  const { start: rs, end: re } = songRange(project);
  const seconds = re - rs;
  const songFrames = Math.max(1, Math.round(seconds * sampleRate));
  const length = songFrames + Math.round(TAIL_SEC * sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  // 'explicit': each node gets its own buffer (see studioEngine's notes on in-place processing).
  const own = { channelCountMode: 'explicit' as const };
  const master = new GainNode(ctx, { ...own, gain: RENDER_GAIN });
  // 30 Hz high-pass: rumble nobody hears on a phone still eats the limiter's headroom.
  const rumble = new BiquadFilterNode(ctx, { ...own, type: 'highpass', frequency: 30, Q: Math.SQRT1_2 });
  master.connect(rumble);
  rumble.connect(ctx.destination);

  const buffer = (data: Float32Array, rate: number) => {
    const b = ctx.createBuffer(1, data.length, rate);
    b.copyToChannel(data, 0);
    return b;
  };

  for (const v of project.voices) {
    const chosen = v.tuneOn && v.take.tuned ? v.take.tuned : v.take.raw;
    // Every take should already be at this rate (drafts are converted on open); never play one
    // at the wrong speed.
    const data = resample(chosen, v.take.sampleRate, sampleRate);
    const buf = buffer(data, sampleRate);
    const lane = new GainNode(ctx, { ...own, gain: v.volume * v.level });
    lane.connect(master);
    if (v.fx.reverb.on) {
      // The impulse goes in before the convolver is wired (a convolver with none crashes).
      const conv = ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = buffer(reverbImpulse(reverbSeconds(Math.round(v.fx.reverb.size * 10) / 10), sampleRate), sampleRate);
      const wet = new GainNode(ctx, { ...own, gain: v.fx.reverb.mix * 1.4 });
      conv.connect(wet);
      wet.connect(master);
      lane.connect(conv);
    }
    const len = clipLength(v);
    for (let rep = 0; rep < v.loops; rep++) {
      const segS = v.start + rep * len;
      const a = Math.max(segS, rs);
      const b = Math.min(segS + len, re);
      if (b <= a) continue;
      const src = v.fx.pitch ? ctx.createBufferSource({ pitchCorrection: true }) : ctx.createBufferSource();
      if (v.fx.pitch) src.detune.value = v.fx.pitch * 100;
      src.buffer = buf;
      // A 4 ms fade at each end of the segment: a trim or loop seam mid-waveform clicks.
      const env = new GainNode(ctx, { ...own, gain: 0 });
      const t0 = a - rs, t1 = b - rs, ramp = edgeRamp(t1 - t0);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(1, t0 + ramp);
      env.gain.setValueAtTime(1, t1 - ramp);
      env.gain.linearRampToValueAtTime(0, t1);
      src.connect(env);
      env.connect(lane);
      const c = v.fx.pitch
        ? compensateLatency(t0, v.trimStart + (a - segS), b - a, 0, src.getLatency())
        : { when: t0, offset: v.trimStart + (a - segS), duration: b - a };
      if (c) src.start(c.when, c.offset, c.duration);
    }
  }

  const hasBeat = project.drumsOn && DRUM_IDS.some(id => project.pattern[id].some(Boolean));
  if (hasBeat) {
    const drums = new GainNode(ctx, { ...own, gain: project.drumVolume });
    drums.connect(master);
    const bufs = Object.fromEntries(DRUM_IDS.map(id => [id, buffer(synthDrum(id, sampleRate), sampleRate)]));
    const stepSec = 60 / project.bpm / 4;
    const firstStep = Math.round(rs / stepSec);
    for (let k = 0; k * stepSec < seconds - 1e-6; k++) {
      const step = (firstStep + k) % STEPS;
      for (const id of DRUM_IDS) {
        if (!project.pattern[id][step]) continue;
        const src = ctx.createBufferSource();
        src.buffer = bufs[id];
        src.connect(drums);
        src.start(k * stepSec);
      }
    }
  }

  // Synth parts: the same 4-bar loop as the Editor, in step with the song like the drums.
  if (project.synths.length) {
    const stepSec = 60 / project.bpm / 4;
    const firstStep = Math.round(rs / stepSec);
    const rendered = new Map<string, ReturnType<typeof buffer>>();
    for (const part of project.synths) {
      const hits = synthHits(part);
      const gain = new GainNode(ctx, { ...own, gain: part.volume });
      gain.connect(master);
      for (let k = 0; k * stepSec < seconds - 1e-6; k++) {
        for (const h of hits[(firstStep + k) % SYNTH_STEPS]) {
          const key = `${part.sound}|${h.midis.join(',')}|${h.len}`;
          let b = rendered.get(key);
          if (!b) { b = buffer(renderSynth(part.sound, h.midis, h.len * stepSec, sampleRate), sampleRate); rendered.set(key, b); }
          const src = ctx.createBufferSource();
          src.buffer = b;
          src.connect(gain);
          src.start(k * stepSec);
        }
      }
    }
  }

  const out = await ctx.startRendering();
  onProgress?.(0.3);
  const channels = [new Float32Array(out.getChannelData(0)), new Float32Array(out.getChannelData(out.numberOfChannels > 1 ? 1 : 0))];
  const report = await masterInPlace(channels, sampleRate, f => onProgress?.(0.3 + 0.7 * f));
  console.log(`[LIVIL][MASTER] ${JSON.stringify({ ...report, inputLufs: +report.inputLufs.toFixed(1), lufs: +report.lufs.toFixed(1), truePeakDb: +report.truePeakDb.toFixed(2), gainDb: +report.gainDb.toFixed(1), limitDb: +report.limitDb.toFixed(1) })}`);
  const end = finishEnds(channels, sampleRate, songFrames);
  // `channels` is NOT enumerable: the mix is a React prop ("Your song"), and React 19 dev
  // builds walk every element of arrays in changed props for DevTools — two full-length
  // channels turned into gigabytes (see ClipTrack's Clip). Own copies, not subarray views: the
  // library's copyToChannel reads a view's WHOLE backing buffer and writes past the end.
  const mix = { sampleRate, seconds: end / sampleRate, master: report } as Mix;
  Object.defineProperty(mix, 'channels', { value: channels.map(c => c.slice(0, end)), enumerable: false });
  return mix;
}
