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
 * TARGET_LUFS (−11) with a true-peak limiter at −1 dBTP, and clean fades. The Editor's "Song volume"
 * does not apply here: it is for listening while you work.
 */
import { BiquadFilterNode, GainNode, OfflineAudioContext } from 'react-native-audio-api';
import { compensateLatency, reverbImpulse, reverbSeconds } from '../../utils/audioFx/effects';
import { edgeRamp, resample } from '../../utils/audioFx/level';
import { finishEnds, masterInPlace, yieldUi, type MasterReport } from '../../utils/audioFx/master';
import { DRUM_IDS, STEPS, synthDrum } from '../../utils/drums';
import { renderSynth, SYNTH_STEPS, synthHits } from '../../utils/synth';
import { clipLength, songRange, type Project } from './studioEngine';

export type Mix = { channels: Float32Array[]; sampleRate: number; seconds: number; master: MasterReport | null };

/** How far under full scale the graph renders, so no block ever reaches the destination's normaliser. */
const RENDER_GAIN = 1 / 8; // −18 dB
/** Reverb and synth release ring on past the trim by up to this much. */
const TAIL_SEC = 1;
/** Graph messages per batch, well under the library's queue of 1024 (see renderMix). */
export const MESSAGES_PER_BATCH = 700;
/** A batch is added this long before its first sound (two render quanta and some). */
const SUSPEND_LEAD_SEC = 0.01;
/** Batches start at least this far apart, so their suspends never share a 128-frame block. */
const MIN_BATCH_GAP_SEC = 0.02;

/**
 * Splits sounds (sorted by start time `at`, each costing `cost` graph messages) into batches of
 * at most `cap` messages; the first also carries `fixedCost`. A new batch may only begin at a
 * sound starting MIN_BATCH_GAP_SEC after the previous batch began and early enough to suspend
 * before (`at` < `endSec` − a lead), so suspend points stay distinct and inside the render. A
 * single moment costing more than `cap` stays whole (the queue still holds it: one moment is a
 * few dozen messages). Returns the sounds' indices per batch; never empty.
 */
export function planBatches(at: number[], cost: number[], cap: number, fixedCost: number, endSec: number): number[][] {
  const batches: number[][] = [[]];
  let used = fixedCost;
  let batchStart = 0;
  for (let i = 0; i < at.length; i++) {
    const canBreak = batches[batches.length - 1].length > 0
      && at[i] >= batchStart + MIN_BATCH_GAP_SEC
      && at[i] - SUSPEND_LEAD_SEC > 0
      && at[i] < endSec - 2 * MIN_BATCH_GAP_SEC;
    if (used + cost[i] > cap && canBreak) {
      batches.push([]);
      used = 0;
      batchStart = at[i];
    }
    batches[batches.length - 1].push(i);
    used += cost[i];
  }
  return batches;
}

export async function renderMix(project: Project, onProgress?: (fraction: number) => void): Promise<Mix> {
  // Step log: a mix that never finishes must say where it stopped (iPhone, 2026-11-10: "Mixing
  // your song…" forever, Back dead, the JS thread not even pausable from the debugger).
  const t0 = Date.now();
  const step = (what: string) => console.log(`[LIVIL][MIX] ${what} +${Date.now() - t0} ms`);
  step(`start: ${project.voices.length} voice(s), ${project.synths.length} synth part(s), drums ${project.drumsOn ? 'on' : 'off'}`);
  const sampleRate = project.voices[0]?.take.sampleRate ?? 48000;
  const { start: rs, end: re } = songRange(project);
  const seconds = re - rs;
  const songFrames = Math.max(1, Math.round(seconds * sampleRate));
  const length = songFrames + Math.round(TAIL_SEC * sampleRate);
  step(`offline context: ${length} frames at ${sampleRate} Hz`);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  step('offline context made');
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

  // EVERY node and EVERY connect is a message on the library's graph queue, which holds 1024 and
  // is emptied only while the context renders (AudioDestinationNode → preProcessGraph). A full
  // queue makes the next call busy-wait on the JS thread for room — and before startRendering
  // nothing ever makes room, so the app froze for good (owner's iPhone, 2026-11-10: 47 s of
  // drums ≈ 1000 messages, plus a fingerpicked guitar ≈ 700, Back dead, the JS thread not even
  // pausable). So the graph is built in BATCHES of at most MESSAGES_PER_BATCH: the first before
  // rendering, each later one from a suspend just before its first sound, then resume.
  type Job = { at: number; cost: number; run: () => void };
  const jobs: Job[] = [];
  let firstError: unknown = null;

  await yieldUi();
  onProgress?.(0.02);
  for (const v of project.voices) {
    await yieldUi();
    step(`voice ${v.id}: pitch ${v.fx.pitch}, reverb ${v.fx.reverb.on ? 'on' : 'off'}, loops ${v.loops}`);
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
      const t0s = a - rs, t1 = b - rs;
      // A pitched source starts a little early to cover its latency: batch it by that start.
      jobs.push({ at: Math.max(0, t0s - 0.25), cost: 4, run: () => {
        const src = v.fx.pitch ? ctx.createBufferSource({ pitchCorrection: true }) : ctx.createBufferSource();
        if (v.fx.pitch) src.detune.value = v.fx.pitch * 100;
        src.buffer = buf;
        // A 4 ms fade at each end of the segment: a trim or loop seam mid-waveform clicks.
        const env = new GainNode(ctx, { ...own, gain: 0 });
        const ramp = edgeRamp(t1 - t0s);
        env.gain.setValueAtTime(0, t0s);
        env.gain.linearRampToValueAtTime(1, t0s + ramp);
        env.gain.setValueAtTime(1, t1 - ramp);
        env.gain.linearRampToValueAtTime(0, t1);
        src.connect(env);
        env.connect(lane);
        const c = v.fx.pitch
          ? compensateLatency(t0s, v.trimStart + (a - segS), b - a, 0, src.getLatency())
          : { when: t0s, offset: v.trimStart + (a - segS), duration: b - a };
        if (c) src.start(c.when, c.offset, c.duration);
      } });
    }
  }
  step('voices planned');

  const hasBeat = project.drumsOn && DRUM_IDS.some(id => project.pattern[id].some(Boolean));
  if (hasBeat) {
    const drums = new GainNode(ctx, { ...own, gain: project.drumVolume });
    drums.connect(master);
    const bufs = Object.fromEntries(DRUM_IDS.map(id => [id, buffer(synthDrum(id, sampleRate), sampleRate)]));
    const stepSec = 60 / project.bpm / 4;
    const firstStep = Math.round(rs / stepSec);
    for (let k = 0; k * stepSec < seconds - 1e-6; k++) {
      const stepNo = (firstStep + k) % STEPS;
      for (const id of DRUM_IDS) {
        if (!project.pattern[id][stepNo]) continue;
        const at = k * stepSec;
        jobs.push({ at, cost: 2, run: () => {
          const src = ctx.createBufferSource();
          src.buffer = bufs[id];
          src.connect(drums);
          src.start(at);
        } });
      }
    }
  }

  // Synth parts: the same 4-bar loop as the Editor, in step with the song like the drums.
  if (project.synths.length) {
    const stepSec = 60 / project.bpm / 4;
    const firstStep = Math.round(rs / stepSec);
    const rendered = new Map<string, ReturnType<typeof buffer>>();
    for (const part of project.synths) {
      await yieldUi();
      step(`synth ${part.sound}: planning its chords`);
      const hits = synthHits(part);
      const gain = new GainNode(ctx, { ...own, gain: part.volume });
      gain.connect(master);
      for (let k = 0; k * stepSec < seconds - 1e-6; k++) {
        for (const h of hits[(firstStep + k) % SYNTH_STEPS]) {
          const at = Math.max(0, k * stepSec + (h.shift ?? 0));
          const stroke = h.gain !== undefined && h.gain !== 1;
          jobs.push({ at, cost: stroke ? 4 : 2, run: () => {
            const key = `${part.sound}|${h.midis.join(',')}|${h.len}|${h.gap || ''}${h.mute ? 'x' : ''}${h.cut ? 'c' : ''}${h.hard !== undefined && h.hard < 1 ? `h${h.hard}` : ''}`;
            let b = rendered.get(key);
            if (!b) { b = buffer(renderSynth(part.sound, h.midis, h.len * stepSec, sampleRate, h), sampleRate); rendered.set(key, b); }
            const src = ctx.createBufferSource();
            src.buffer = b;
            // A guitar stroke's own loudness and timing, exactly as the Editor plays it (fireSynth).
            if (stroke) {
              const g = new GainNode(ctx, { ...own, gain: h.gain });
              src.connect(g);
              g.connect(gain);
            } else {
              src.connect(gain);
            }
            src.start(at);
          } });
        }
      }
    }
  }

  // Everything so far (the buses, lanes, part gains) went straight onto the queue: count it
  // against the first batch. 4 for master + rumble, 3–6 per voice, 2 for drums, 2 per part.
  const fixedCost = 4 + project.voices.reduce((n, v) => n + (v.fx.reverb.on ? 6 : 2), 0) + (hasBeat ? 2 : 0) + 2 * project.synths.length;
  jobs.sort((x, y) => x.at - y.at);
  const batches = planBatches(jobs.map(j => j.at), jobs.map(j => j.cost), MESSAGES_PER_BATCH, fixedCost, length / sampleRate);
  const runBatch = (b: number[]) => { for (const i of b) jobs[i].run(); };
  step(`${jobs.length} sounds in ${batches.length} batch(es)`);
  runBatch(batches[0]);
  // Each pause adds its batch, registers the NEXT pause (before resuming, so the render can't
  // run past it), then resumes. A pause sits a little before the batch's first sound: the
  // render stops at the next 128-frame boundary, which must not pass a source's start before
  // the source exists.
  //
  // Resume goes to the native context, not the wrapper: the wrapper keeps ONE "is suspended"
  // flag, set by suspend() when it is CALLED and cleared by resume(), so with three or more
  // batches its last resume() is refused and the render stays paused for good. The native
  // resume checks the render's real state.
  const nativeResume = () => (ctx.context as unknown as { resume(): Promise<void> }).resume();
  const pauseFor = (n: number): void => {
    if (n >= batches.length) return;
    const b = batches[n];
    ctx.suspend(jobs[b[0]].at - SUSPEND_LEAD_SEC).then(() => {
      try { runBatch(b); } catch (e) { firstError = firstError ?? e; }
      try { pauseFor(n + 1); } catch (e) { firstError = firstError ?? e; }
      return nativeResume();
    }).catch(e => {
      // A refused pause leaves the render running without the later batches: it still ends,
      // and the error is thrown then. A refused resume is caught by the watchdog below.
      firstError = firstError ?? e;
    });
  };
  pauseFor(1);

  await yieldUi();
  onProgress?.(0.1);
  step('graph built, rendering');
  // Never spin forever again: a render that stops progressing (a refused resume, a lost
  // suspend) ends in an error, which "Your song" shows as "Couldn't mix the song".
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const limitMs = 60_000 + seconds * 1000;
  const out = await Promise.race([
    ctx.startRendering(),
    new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(firstError ?? new Error(`mix did not finish in ${limitMs} ms`)), limitMs); }),
  ]).finally(() => clearTimeout(watchdog));
  step('rendered');
  if (firstError) throw firstError;
  onProgress?.(0.3);
  const channels = [new Float32Array(out.getChannelData(0)), new Float32Array(out.getChannelData(out.numberOfChannels > 1 ? 1 : 0))];
  step('mastering');
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
