/**
 * The Editor's audio engine (internal code name "Studio", ADR-0034).
 *
 * One `react-native-audio-api` AudioContext that records takes and plays the project:
 * voice lanes (each with a raw and a Magic Tuned copy, flipped by gain so the switch is
 * instant, an optional pitch shift and reverb) plus a one-bar drum loop on a look-ahead
 * scheduler.
 *
 * OWNERSHIP RULE (ADR-0034): this engine only exists while GlobalAudioPlayer is unmounted
 * (`setEngineDriving(true)` in StudioScreen). It never posts a notification, never touches
 * the lock screen, and is fully torn down — context closed, session released — on exit.
 */
import {
  AnalyserNode,
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioManager,
  AudioParam,
  AudioRecorder,
  ConvolverNode,
  FileFormat,
  FilePreset,
  GainNode,
  WaveShaperNode,
} from 'react-native-audio-api';
import {
  compensateLatency,
  HEADROOM,
  reverbImpulse,
  reverbSeconds,
  softLimitCurve,
  type VoiceFx,
} from '../../utils/audioFx/effects';
import { Platform } from 'react-native';
import { androidLikelyMic, toMics, type Mic, type RawDevice } from '../../utils/audioDevices';
import { clampRange, type SongRange } from './timeline';
import { edgeRamp } from '../../utils/audioFx/level';
import type { Key } from '../../utils/magicTune';
import { DRUM_IDS, isPrivateOutput, STEPS, synthClick, synthDrum, type DrumId, type DrumPattern } from '../../utils/drums';
import {
  degreeToMidi,
  guitarStroke,
  isGuitar,
  keyboardDegrees,
  renderSynth,
  SYNTH_STEPS,
  synthHits,
  type Stroke,
  type SynthHit,
  type SynthPart,
  type SynthSound,
  type Touch,
} from '../../utils/synth';

export type Take = {
  id: string;
  sampleRate: number;
  /** What the lane plays as "raw" — background-cleaned when that was on. */
  raw: Float32Array;
  tuned: Float32Array | null;
  /** The take exactly as recorded, before any cleanup — what Magic Tune reopens from. */
  original: Float32Array;
  /** The Magic Tune settings it was last made with (null: never tuned). */
  tune: TuneChoice;
  /**
   * Which click repair (CLICK_REPAIR_VERSION in clickRepair.ts) all its versions have had.
   * Older takes are repaired again, once, when their draft opens — before any rate conversion.
   */
  clickRepair?: number;
};

export type TuneChoice = {
  key: Key | null;
  strength: number;
  clean: boolean;
  /** Which cleanup (CLEAN_VERSION) made the cleaned audio; missing = 1, from before breaths. */
  cleanVersion?: number;
};

export type VoiceLane = {
  id: string;
  name: string;
  take: Take;
  /** Where the clip starts on the timeline, seconds. */
  start: number;
  /** Trim window inside the take, seconds. */
  trimStart: number;
  trimEnd: number;
  /** How many times the trimmed clip repeats back to back. */
  loops: number;
  volume: number;
  /**
   * The take's automatic level (autoLevel in audioFx/level.ts): its singing at about −20 dBFS
   * whatever the mic distance. A setting, never baked into the audio; × `volume`.
   */
  level: number;
  tuneOn: boolean;
  /** Pitch and reverb on this voice. */
  fx: VoiceFx;
};

export type Project = {
  voices: VoiceLane[];
  drumsOn: boolean;
  pattern: DrumPattern;
  drumVolume: number;
  /** The whole song's volume, before the limiter (1 = 100%, up to HEADROOM). */
  masterVolume: number;
  /** Instruments: synth parts looping every 4 bars (src/utils/synth.ts). */
  synths: SynthPart[];
  bpm: number;
  /** The song trim: only this part plays, loops and gets posted. null = the whole song. */
  range: SongRange | null;
};

/**
 * One voice's reverb, built the first time it is switched on. The voice's `lane` gain feeds
 * it only while it is on (an idle convolver still costs CPU); it sums into the master bus
 * beside the dry voice.
 */
type LaneFx = {
  /** Built on first use — see `ensureReverb` for why it can't be built up front. */
  reverb: { conv: ConvolverNode; wet: GainNode; linked: boolean; builtSize: number; ready: boolean } | null;
};
type LaneNodes = { lane: GainNode; raw: GainNode; tuned: GainNode; fx: LaneFx | null };
/**
 * A playing source; `env` is its own gain (an edge fade, a guitar stroke's loudness), when it
 * has one. A synth part's source also says whose it is and when it starts.
 */
type Scheduled = { src: AudioBufferSourceNode; end: number; env?: GainNode; part?: string; at?: number };
/** A guitar stroke its keyboard has sounding, or about to: `stop` fades it out, `cancel` drops it unheard. */
type LiveStroke = { at: number; stop: (fade: number) => void; cancel: () => void };
/**
 * A guitar chord held on the keyboard. `anchor` is the loop step (with its fraction) the song
 * was at, at context time `t0` — the grid its strokes fall on; `last`, the time of the latest
 * step already dealt with.
 */
type Hold = { part: SynthPart; degree: number; anchor: number; t0: number; last: number };

/**
 * Let go of a finished source's audio now. Setting a buffer makes the library COPY it into the
 * node (a 1-minute take is ~11 MB; a pitched voice gets a copy plus its own time-stretcher), and
 * that copy otherwise lives until the garbage collector gets round to the node — so restarting
 * playback over and over (dragging the pitch, tap-seeking) stacked copies until iOS closed the app.
 */
function free(src: AudioBufferSourceNode, env?: GainNode): void {
  try { src.disconnect(); } catch { /* already */ }
  try { src.buffer = null; } catch { /* already empty */ }
  if (env) { try { env.disconnect(); } catch { /* already */ } }
}

/** Glide a gain to `v` over ~15 ms instead of jumping (a jump is a click — "zipper" noise while dragging). */
function glide(param: AudioParam, v: number, now: number): void {
  const from = param.value;
  if (Math.abs(from - v) < 1e-6) return;
  // Anchor the glide at the current value first: react-native-audio-api 0.12.2 starts a
  // param's FIRST automation from its default (1.0), not from the value set before, so the
  // first volume change jumped to 100% and slid back.
  param.setValueAtTime(from, now);
  param.setTargetAtTime(v, now, 0.015);
}

/** The live mix sits this far under the safety curve at Song volume 100% (−6 dB). */
const LIVE_TRIM = 0.5;
/** Samples the level meter reads each time (~43 ms at 48 kHz). */
const METER_FRAMES = 2048;

/** Every take, buffer and mix in the Editor runs at this rate. */
export const STUDIO_SAMPLE_RATE = 48000;

const LOOKAHEAD_SEC = 0.15;
/** The longest a held keyboard key sounds. */
const PRESS_SEC = 4;
/** A held guitar chord is strummed only this far ahead, so letting go stops the hand at once. */
const HOLD_AHEAD_SEC = 0.06;
/** …but its coming strokes are synthesised this many 16ths ahead (see tickHolds). */
const RENDER_AHEAD_STEPS = 6;
/**
 * How long a stroke strummed from the keyboard is rendered to ring, seconds: nothing says when
 * the next one will damp it, so it gets its full ring (guitarStroke's `ring`), up to this — a
 * full or bass stroke, and the lighter ones. These bound the keyboard's memory: at most four
 * strokes a chord, ~1.6 MB together at 48 kHz.
 */
const RING_SEC = { long: 2.5, short: 1.25 };
const liveSeconds = (k: Stroke, stepSec: number) => Math.min(k.ring * stepSec, k.ring > 8 ? RING_SEC.long : RING_SEC.short);
const synthKey = (sound: SynthSound, midis: number[], seconds: number, touch: Touch = {}, tag = '') =>
  `${tag}${sound}|${midis.join(',')}|${seconds.toFixed(4)}|${touch.gap || ''}${touch.mute ? 'x' : ''}${touch.cut ? 'c' : ''}${touch.hard !== undefined && touch.hard < 1 ? `h${touch.hard}` : ''}`;
const TICK_MS = 25;

export const clipLength = (v: Pick<VoiceLane, 'trimStart' | 'trimEnd'>) => Math.max(0.05, v.trimEnd - v.trimStart);
export const clipEnd = (v: Pick<VoiceLane, 'start' | 'trimStart' | 'trimEnd' | 'loops'>) => v.start + clipLength(v) * v.loops;
export const barSeconds = (bpm: number) => (4 * 60) / bpm;

/** Project length: the last clip end, rounded up to whole bars (at least one bar). */
/** The part of the song that plays — the trim, or everything. */
export const songRange = (p: Project): SongRange => clampRange(p.range, projectLength(p), p.bpm);

/** Every clip's full length, rounded up to whole bars (ignores the trim). */
export function projectLength(p: Project): number {
  const bar = barSeconds(p.bpm);
  const end = p.voices.reduce((m, v) => Math.max(m, clipEnd(v)), 0);
  return Math.max(1, Math.ceil(end / bar - 1e-6)) * bar;
}

export class StudioEngine {
  private ctx: AudioContext | null = null;
  /**
   * Each voice's playable audio, by VOICE id, refilled in place when its take changes. Native
   * buffers are invisible to the garbage collector (it sees a tiny handle, not the ~11 MB a
   * minute behind it), so a new pair per Clean / Magic Tune change piled up until iOS killed
   * the app (2026-11-02). Same length → the existing buffer is overwritten, never re-made.
   */
  private buffers = new Map<string, { raw: AudioBuffer; rawSrc: Float32Array; tuned: AudioBuffer | null; tunedSrc: Float32Array | null }>();
  private laneNodes = new Map<string, LaneNodes>();
  private drumBuffers = new Map<DrumId, AudioBuffer>();
  /**
   * The Listen / Magic Tune previews' audio, reused by sample array. Each copy is a full-take
   * native buffer (≈8 MB a minute) the garbage collector can't see the size of, so making one
   * per play/seek grew the app past a gigabyte on a phone.
   */
  private previewBufs = new Map<Float32Array, AudioBuffer>();
  private reverbPending = new Set<object>();
  private lastFxLog = new WeakMap<object, string>();
  /** The preview playing now — one at a time; a newer previewAB() stops it. */
  private activePreview: { stop: () => void } | null = null;
  /** Bumped per previewAB() call, so one still waiting on resume() knows it was superseded. */
  private previewGen = 0;
  private drumGain: GainNode | null = null;
  /** One gain (the part's volume) per synth part, into the master bus. */
  private synthGains = new Map<string, GainNode>();
  private synthHitMap = new Map<string, SynthHit[][]>();
  /** Rendered synth notes/chords by sound+notes+length — only what the project still plays. */
  private synthBufs = new Map<string, AudioBuffer>();
  /** Per guitar part, the strokes its keyboard has sounding (or sent for the next moment). */
  private ringing = new Map<string, LiveStroke[]>();
  /** Per guitar part, the chord held on its keyboard: strummed in the part's pattern until let go. */
  private holds = new Map<string, Hold>();
  private holdTimer: ReturnType<typeof setInterval> | null = null;
  private project: Project;
  private sources: Scheduled[] = [];
  /**
   * Sources just stopped by a seek/pause, still referenced for a moment. Dropping the last JS
   * reference lets the garbage collector free the native node while the audio thread may still be
   * rendering its final quantum — and seeking (tap, tap, tap) makes a lot of them very fast.
   */
  private retired: Scheduled[] = [];
  /** Bumped by every play()/stop(), so a play() still waiting on resume() can tell it was superseded. */
  private playGen = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;
  /** Seconds that play per pass: the song trim's length. */
  private length = 0;
  /** Where the trim starts in the song; playback time 0 of each pass is this song time. */
  private rangeStart = 0;
  private stepCycle = 0;
  private meter: AnalyserNode | null = null;
  private meterBuf = new Float32Array(METER_FRAMES);
  private meterHold = { db: -Infinity, at: 0 };

  /** Everything audible goes here → limiter → speaker (except the metronome and previews). */
  private master: GainNode | null = null;
  private lastCycle = -1;
  private stepCounter = 0;
  private pausedAt = 0;
  private recorder: AudioRecorder | null = null;
  private chunks: Float32Array[] = [];
  private recordRate = 44100;
  private clickGain: GainNode | null = null;
  private clicks: { accent: AudioBuffer; beat: AudioBuffer } | null = null;
  private metronome = false;
  /** Click on the PHONE SPEAKER: the mic hears it, so the take is cleaned afterwards. */
  private speakerClick = false;
  /**
   * Every click played while recording on the speaker, for the click remover, as the
   * engine frame it starts on (`floor(when·sr)`, same rule as the native scheduler).
   */
  private clickLog: { frame: number; accent: boolean }[] = [];
  private firstChunk: ((len: number) => void) | null = null;
  private logClicks = false;
  /** Context time the recorder actually started, for lining the take up with the beat. */
  private recordStartedAt = 0;
  playing = false;

  constructor(project: Project) {
    this.project = project;
  }

  /** Session + context. Call once, before anything else. */
  async init(): Promise<void> {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
    });
    await AudioManager.setAudioSessionActivity(true);
    // A FIXED rate, not the phone's current one: the hardware flips between 44.1 and 48 kHz
    // (speaker, headphones, a rebuild), and a draft made at the other rate then had to be
    // converted on every open (the library never converts buffers itself). The OS converts
    // the output to whatever the hardware runs at.
    this.ctx = new AudioContext({ sampleRate: STUDIO_SAMPLE_RATE });
    // Master bus → safety curve (fed at 1/HEADROOM, its curve scales back up). LIVE_TRIM keeps
    // a normal mix 6 dB under the curve at Song volume 100%, so the slider is audible all the
    // way to 200% instead of just pressing a loud mix harder into the ceiling (2026-11-02).
    // 'explicit' = its own buffer (see ensureReverb on in-place processing).
    this.master = new GainNode(this.ctx, { channelCountMode: 'explicit', gain: LIVE_TRIM / HEADROOM });
    const limiter = new WaveShaperNode(this.ctx, { curve: softLimitCurve() });
    this.master.connect(limiter);
    limiter.connect(this.ctx.destination);
    // The level meter listens to the master before the curve. Fed into a silent gain so the
    // graph actually runs it (a node nothing pulls from is never processed).
    this.meter = new AnalyserNode(this.ctx, { fftSize: METER_FRAMES, channelCountMode: 'explicit' });
    const sink = new GainNode(this.ctx, { channelCountMode: 'explicit', gain: 0 });
    this.master.connect(this.meter);
    this.meter.connect(sink);
    sink.connect(this.ctx.destination);
    this.drumGain = this.ctx.createGain();
    this.drumGain.connect(this.master);
    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = 0;
    // Through the master like everything else: added on top of it at the speaker, a click on
    // a loud bar went over full scale, and the library then turns that whole moment down (a buzz).
    this.clickGain.connect(this.master);
    const mk = (accent: boolean) => {
      const c = synthClick(accent, this.ctx!.sampleRate);
      const b = this.ctx!.createBuffer(1, c.length, this.ctx!.sampleRate);
      b.copyToChannel(c, 0);
      return b;
    };
    this.clicks = { accent: mk(true), beat: mk(false) };
    for (const id of DRUM_IDS) {
      const s = synthDrum(id, this.ctx.sampleRate);
      const b = this.ctx.createBuffer(1, s.length, this.ctx.sampleRate);
      b.copyToChannel(s, 0);
      this.drumBuffers.set(id, b);
    }
    this.setProject(this.project);
  }

  /**
   * The live mix's peak level, dB relative to the safety curve's full scale (0 dB = where
   * it would be squashed flat), held for 1.5 s so a single loud hit stays readable. Reads one
   * reused buffer — nothing is allocated per call. null when not playing.
   */
  level(): number | null {
    if (!this.playing || !this.meter || !this.ctx) return null;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) { const a = Math.abs(this.meterBuf[i]); if (a > peak) peak = a; }
    // The meter hears the master scaled by 1/HEADROOM; scale back to what the curve sees.
    const db = 20 * Math.log10(peak * HEADROOM + 1e-9);
    const now = this.ctx.currentTime;
    if (db >= this.meterHold.db || now - this.meterHold.at > 1.5) this.meterHold = { db, at: now };
    return this.meterHold.db;
  }

  /**
   * DIAGNOSTIC: the JS heap and the typed-array memory Hermes knows about, in the log. Native
   * AudioBuffers are NOT in these numbers — count them by hand (see CLAUDE.md, Editor memory).
   */
  logMemory(tag: string): void {
    const stats = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } }).HermesInternal?.getInstrumentedStats?.();
    if (!stats) return;
    const mb = (k: string) => Math.round((stats[k] ?? 0) / 1048576);
    console.log(`[LIVIL][MEM] ${tag}: heap ${mb('js_heapSize')} MB, typed arrays ${mb('js_externalBytes')} MB, voices ${this.project.voices.length}, native voice buffers ${this.buffers.size * 2}`);
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  async dispose(): Promise<void> {
    this.stop();
    this.holds.clear();
    this.endHolds();
    this.previewBufs.clear();
    this.buffers.clear();
    this.synthBufs.clear();
    try { this.recorder?.clearOnAudioReady(); this.recorder?.stop(); } catch { /* not recording */ }
    this.recorder = null;
    const ctx = this.ctx;
    this.ctx = null;
    // Time-boxed: a shutdown that never finished kept the feed player switched off and the next
    // Editor waiting. Past the limit we move on; the OS reclaims what is left.
    const within = (p: Promise<unknown>, ms: number, what: string) =>
      Promise.race([p.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), ms))])
        .then(done => { if (!done) console.log(`[LIVIL][STUDIO] ${what} took over ${ms} ms — moving on`); });
    try { if (ctx) await within(ctx.close(), 1500, 'closing the audio'); } catch { /* already closed */ }
    try { await within(AudioManager.setAudioSessionActivity(false), 1000, 'releasing the audio session'); } catch { /* best effort */ }
  }

  // ── project ────────────────────────────────────────────────────────────────

  private bufferFor(laneId: string, take: Take) {
    const ctx = this.ctx!;
    const fill = (into: AudioBuffer | null, data: Float32Array) => {
      // Sources copy their buffer when they start, so overwriting one that is playing is safe.
      if (into && into.length === data.length && into.sampleRate === take.sampleRate) {
        into.copyToChannel(data, 0);
        return into;
      }
      const b = ctx.createBuffer(1, data.length, take.sampleRate);
      b.copyToChannel(data, 0);
      return b;
    };
    let entry = this.buffers.get(laneId);
    if (!entry) {
      entry = { raw: fill(null, take.raw), rawSrc: take.raw, tuned: null, tunedSrc: null };
      this.buffers.set(laneId, entry);
    } else if (entry.rawSrc !== take.raw) {
      entry.raw = fill(entry.raw, take.raw);
      entry.rawSrc = take.raw;
    }
    if (take.tuned && entry.tunedSrc !== take.tuned) {
      entry.tuned = fill(entry.tuned, take.tuned);
      entry.tunedSrc = take.tuned;
    } else if (!take.tuned) {
      entry.tunedSrc = null; // the buffer stays, for the next tuned version to reuse
    }
    return entry;
  }

  /**
   * Replace the project. Gains (volume, raw/tuned) apply immediately; timing changes
   * (drag, trim, loop) apply from the next pass — call `restart()` to hear them now.
   */
  setProject(p: Project): void {
    this.project = p;
    const ctx = this.ctx;
    if (!ctx) return;
    const live = new Set(p.voices.map(v => v.id));
    for (const id of this.buffers.keys()) if (!live.has(id)) this.buffers.delete(id);
    for (const [id, nodes] of this.laneNodes) {
      if (!live.has(id)) { this.dropFx(nodes); nodes.lane.disconnect(); this.laneNodes.delete(id); }
    }
    for (const v of p.voices) {
      let nodes = this.laneNodes.get(v.id);
      if (!nodes) {
        const lane = ctx.createGain();
        const raw = ctx.createGain();
        const tuned = ctx.createGain();
        raw.connect(lane);
        tuned.connect(lane);
        lane.connect(this.master!);
        nodes = { lane, raw, tuned, fx: null };
        this.laneNodes.set(v.id, nodes);
      }
      const hasTuned = !!v.take.tuned;
      const now = ctx.currentTime;
      glide(nodes.lane.gain, v.volume * v.level, now);
      glide(nodes.raw.gain, v.tuneOn && hasTuned ? 0 : 1, now);
      glide(nodes.tuned.gain, v.tuneOn && hasTuned ? 1 : 0, now);
      this.applyFx(nodes, v.fx);
      this.bufferFor(v.id, v.take);
    }
    if (this.drumGain) glide(this.drumGain.gain, p.drumsOn ? p.drumVolume : 0, ctx.currentTime);
    if (this.master) glide(this.master.gain, (p.masterVolume * LIVE_TRIM) / HEADROOM, ctx.currentTime);
    this.syncSynths(p);
    const r = songRange(p);
    this.rangeStart = r.start;
    this.length = r.end - r.start;
  }

  /** Synth parts → their gains and note lists; renders any chord the project now needs. */
  private syncSynths(p: Project): void {
    const ctx = this.ctx!;
    const live = new Set(p.synths.map(s => s.id));
    for (const [id, g] of this.synthGains) {
      if (!live.has(id)) { g.disconnect(); this.synthGains.delete(id); this.synthHitMap.delete(id); }
    }
    const stepSec = 60 / p.bpm / 4;
    const needed = new Set<string>();
    for (const part of p.synths) {
      let g = this.synthGains.get(part.id);
      if (!g) {
        g = ctx.createGain();
        g.connect(this.master!);
        this.synthGains.set(part.id, g);
      }
      glide(g.gain, part.volume, ctx.currentTime);
      const hits = synthHits(part);
      this.synthHitMap.set(part.id, hits);
      // Render now, not in the scheduler: a pad chord takes a few ms to synthesise.
      for (const step of hits) for (const h of step) needed.add(this.synthBuffer(part.sound, h.midis, h.len * stepSec, h).key);
    }
    // Keyboard notes are rendered on first press; keep only the ones a part can still play.
    for (const part of p.synths) {
      for (const d of keyboardDegrees(part.sound)) {
        if (!isGuitar(part.sound)) {
          needed.add(synthKey(part.sound, [degreeToMidi(part.key, part.sound, d)], PRESS_SEC, {}, 'tap|'));
          continue;
        }
        // A guitar key sounds the strokes of the part's pattern, and the one a new chord starts on.
        for (let pos = 0; pos < 16; pos++) {
          for (const fresh of [false, true]) {
            const k = guitarStroke(part, d, pos, fresh);
            if (k) needed.add(synthKey(part.sound, k.midis, liveSeconds(k, stepSec), k));
          }
        }
      }
    }
    for (const k of this.synthBufs.keys()) if (!needed.has(k)) this.synthBufs.delete(k);
  }

  private synthBuffer(sound: SynthSound, midis: number[], seconds: number, touch: Touch = {}, tag = ''): { key: string; buf: AudioBuffer } {
    const key = synthKey(sound, midis, seconds, touch, tag);
    let buf = this.synthBufs.get(key);
    if (!buf) {
      const ctx = this.ctx!;
      const t = Date.now();
      const data = renderSynth(sound, midis, seconds, ctx.sampleRate, touch);
      // Synthesis runs on the JS thread; a slow one is heard as a late note. Say so when it is.
      if (Date.now() - t >= 30) console.log(`[LIVIL][SYNTH] ${sound} x${midis.length} ${(data.length / ctx.sampleRate).toFixed(2)}s took ${Date.now() - t} ms`);
      buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data, 0);
      this.synthBufs.set(key, buf);
    }
    return { key, buf };
  }

  // ── effects ────────────────────────────────────────────────────────────────

  /** Feed `input` into `node` only while `on` — connect/disconnect just on a change. */
  private link(input: GainNode, node: ConvolverNode, linked: boolean, on: boolean): boolean {
    if (on === linked) return linked;
    try { if (on) input.connect(node); else input.disconnect(node); } catch { /* graph already in that state */ }
    return on;
  }

  private applyFx(nodes: LaneNodes, fx: VoiceFx): void {
    if (!fx.reverb.on && !nodes.fx) return;
    const f = (nodes.fx ??= { reverb: null });
    // Reverb — the impulse is rebuilt only when the size moves a whole notch (0.1).
    const r = this.ensureReverb(f, nodes, fx.reverb.size);
    r.wet.gain.value = fx.reverb.on ? fx.reverb.mix * 1.4 : 0;
    if (r.ready) r.linked = this.link(nodes.lane, r.conv, r.linked, fx.reverb.on);
    // DIAGNOSTIC (2026-10-31, "reverb changes don't apply"): what the engine actually applied.
    const sig = `${fx.reverb.on} ${r.builtSize} ${fx.reverb.mix.toFixed(2)} ${r.ready} ${r.linked}`;
    if (sig !== this.lastFxLog.get(nodes)) {
      this.lastFxLog.set(nodes, sig);
      console.log(`[LIVIL][FX] reverb on=${fx.reverb.on} room=${r.builtSize} level=${fx.reverb.mix.toFixed(2)} → wet ${r.wet.gain.value.toFixed(2)} · ready=${r.ready} linked=${r.linked}`);
    }
  }

  /**
   * The reverb (a convolver). It must never be wired into the speaker before its impulse is
   * loaded: react-native-audio-api's ConvolverNode processes even with no input, and with no
   * impulse its thread pool is null → SIGSEGV on the audio thread (crashed the app on the
   * first Echo toggle, 2026-10-31, when all three effects were built together). The impulse
   * is handed to the audio thread as an async event, so the outputs are connected a moment
   * later, once it has surely landed. Later impulse swaps happen on the audio thread — safe.
   */
  private ensureReverb(f: LaneFx, nodes: LaneNodes, size: number): NonNullable<LaneFx['reverb']> {
    const ctx = this.ctx!;
    const notch = Math.round(size * 10) / 10;
    if (!f.reverb) {
      const conv = ctx.createConvolver();
      conv.normalize = true;
      // 'explicit' = its own buffer. With the default ('max') react-native-audio-api hands a
      // node its input's OWN buffer to process in place, so a node fed by a shared signal
      // rewrites that signal for its siblings too (it silenced the voice under the old echo).
      const wet = new GainNode(ctx, { channelCountMode: 'explicit', gain: 0 });
      f.reverb = { conv, wet, linked: false, builtSize: -1, ready: false };
    }
    const r = f.reverb;
    if (notch !== r.builtSize) {
      const ir = reverbImpulse(reverbSeconds(notch), ctx.sampleRate);
      const b = ctx.createBuffer(1, ir.length, ctx.sampleRate);
      b.copyToChannel(ir, 0);
      r.conv.buffer = b;
      r.builtSize = notch;
    }
    if (!r.ready && !this.reverbPending.has(r)) {
      this.reverbPending.add(r);
      setTimeout(() => {
        this.reverbPending.delete(r);
        if (nodes.fx?.reverb !== r || this.ctx !== ctx) return;
        r.conv.connect(r.wet);
        r.wet.connect(this.master!);
        r.ready = true;
        // Catch up with whatever the switch says now.
        const v = this.project.voices.find(x => this.laneNodes.get(x.id) === nodes);
        if (v) r.linked = this.link(nodes.lane, r.conv, r.linked, v.fx.reverb.on);
      }, 150);
    }
    return r;
  }

  private dropFx(nodes: LaneNodes): void {
    const r = nodes.fx?.reverb;
    if (r) for (const n of [r.conv, r.wet]) { try { n.disconnect(); } catch { /* already */ } }
    nodes.fx = null;
  }

  // ── transport ──────────────────────────────────────────────────────────────

  /** Playhead in seconds within the project loop. */
  position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt;
    const t = this.ctx.currentTime - this.t0;
    return this.rangeStart + (((t % this.length) + this.length) % this.length);
  }

  get loopLength(): number {
    return this.length;
  }

  async play(from = this.pausedAt, leadIn = 0): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stop(false);
    const gen = ++this.playGen;
    await ctx.resume();
    // A newer play() or a stop() ran while we waited: starting now would leave two transports
    // (two timers, every voice scheduled twice), and the older timer could never be cleared.
    if (gen !== this.playGen || this.ctx !== ctx) return;
    const r = songRange(this.project);
    this.rangeStart = r.start;
    this.length = r.end - r.start;
    // `from` is song time; `pos` is time into the trimmed pass.
    const pos = Math.min(Math.max(r.start, from), r.end - 0.001) - r.start;
    this.t0 = ctx.currentTime + 0.06 + leadIn - pos;
    this.lastCycle = -1;
    const stepSec = 60 / this.project.bpm / 4;
    this.stepCycle = 0;
    this.stepCounter = Math.ceil(pos / stepSec - 1e-6);
    // DIAGNOSTIC (2026-10-31, "drums go off beat after reopening a draft").
    console.log(`[LIVIL][PLAY] bpm=${this.project.bpm} range=${r.start.toFixed(3)}–${r.end.toFixed(3)} from=${pos.toFixed(3)} ctxRate=${ctx.sampleRate} voices=${JSON.stringify(this.project.voices.map(v => ({
      start: +v.start.toFixed(3), trim: [+v.trimStart.toFixed(3), +v.trimEnd.toFixed(3)], loops: v.loops,
      rate: v.take.sampleRate, len: v.take.raw.length, buf: this.buffers.get(v.id)?.raw.sampleRate ?? null,
    })))}`);
    this.playing = true;
    this.logMemory('play');
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop and remember the playhead (or rewind with `keep = false`). */
  stop(keep = true): void {
    if (keep) this.pausedAt = this.playing ? this.position() : this.pausedAt;
    this.playGen++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of this.sources) { try { s.src.stop(); } catch { /* already ended */ } }
    const now = this.ctx?.currentTime ?? 0;
    this.pruneRetired(now);
    this.retired = this.retired.concat(this.sources.map(s => ({ src: s.src, end: now + 2, env: s.env })));
    this.sources = [];
    this.playing = false;
  }

  seek(sec: number): void {
    this.pausedAt = Math.max(0, sec);
    if (this.playing) void this.play(this.pausedAt);
  }

  /** Free the stopped sources whose moment has passed (see `retired`). */
  private pruneRetired(now: number): void {
    const keep: Scheduled[] = [];
    for (const s of this.retired) if (s.end > now) keep.push(s); else free(s.src, s.env);
    this.retired = keep;
  }

  restart(): void {
    if (this.playing) void this.play(this.position());
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD_SEC;
    const L = this.length;
    // Voices: schedule each project pass ("cycle") as it comes into the look-ahead window.
    const cycle = Math.floor((horizon - this.t0) / L);
    for (let k = this.lastCycle + 1; k <= cycle; k++) this.scheduleCycle(this.t0 + k * L, now);
    this.lastCycle = Math.max(this.lastCycle, cycle);
    // Drums: the one-bar pattern, in step with the SONG — each pass restarts at the step the
    // trim starts on, so a trim that doesn't land on a bar line still loops on the beat.
    const p = this.project;
    const stepSec = 60 / p.bpm / 4;
    const stepsPerPass = Math.max(1, Math.ceil(L / stepSec - 1e-6));
    const firstStep = Math.round(this.rangeStart / stepSec);
    for (;;) {
      if (this.stepCounter >= stepsPerPass) { this.stepCycle++; this.stepCounter = 0; }
      const when = this.t0 + this.stepCycle * L + this.stepCounter * stepSec;
      if (when >= horizon) break;
      if (when >= now - 0.005) {
        const step = (firstStep + this.stepCounter) % STEPS;
        if (p.drumsOn) for (const id of DRUM_IDS) if (p.pattern[id][step]) this.fire(id, when);
        if (this.metronome && step % 4 === 0) this.fireClick(step === 0, when);
        const sStep = (firstStep + this.stepCounter) % SYNTH_STEPS;
        for (const part of p.synths) {
          if (this.holds.has(part.id)) continue; // its keyboard has the guitar: one guitar, one chord
          for (const h of this.synthHitMap.get(part.id)?.[sStep] ?? []) this.fireSynth(part, h, when, stepSec);
        }
      }
      this.stepCounter++;
    }
    const live: Scheduled[] = [];
    for (const s of this.sources) if (s.end > now - 0.5) live.push(s); else free(s.src, s.env);
    this.sources = live;
    this.pruneRetired(now);
  }

  /** One pass of the voices; `cycleStart` is the context time the trim's start plays at. */
  private scheduleCycle(cycleStart: number, now: number): void {
    const ctx = this.ctx!;
    const rs = this.rangeStart;
    const re = rs + this.length;
    for (const v of this.project.voices) {
      const nodes = this.laneNodes.get(v.id);
      const buf = this.buffers.get(v.id);
      if (!nodes || !buf) continue;
      const len = clipLength(v);
      for (let rep = 0; rep < v.loops; rep++) {
        // The segment in song time, cut to the trim.
        const segS = v.start + rep * len;
        const a = Math.max(segS, rs);
        const b = Math.min(segS + len, re);
        if (b <= a) continue;
        const segStart = cycleStart + (a - rs);
        const segEnd = cycleStart + (b - rs);
        if (segEnd <= now) continue;
        const skip = Math.max(0, now - segStart);
        const when = Math.max(segStart, now);
        // Only the version you hear: the silent one used to play too (twice the memory, and a
        // second time-stretcher when pitched). Switching Magic Tune on/off restarts playback.
        const tuned = v.tuneOn && !!v.take.tuned && buf.tunedSrc === v.take.tuned;
        const bf = tuned ? buf.tuned! : buf.raw;
        const g = tuned ? nodes.tuned : nodes.raw;
        // Pitch: the library's own time-stretcher shifts it without changing speed. Only
        // when asked — it adds CPU and a little latency, so a voice "as sung" skips it.
        const src = v.fx.pitch ? ctx.createBufferSource({ pitchCorrection: true }) : ctx.createBufferSource();
        if (v.fx.pitch) src.detune.value = v.fx.pitch * 100;
        src.buffer = bf;
        // A 4 ms fade at each end (also when starting mid-segment after a seek): a trim, a loop
        // seam or a seek that lands mid-waveform otherwise clicks.
        const env = ctx.createGain();
        const ramp = edgeRamp(segEnd - when);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(1, when + ramp);
        env.gain.setValueAtTime(1, segEnd - ramp);
        env.gain.linearRampToValueAtTime(0, segEnd);
        src.connect(env);
        env.connect(g);
        const offset = v.trimStart + (a - segS) + skip;
        if (v.fx.pitch) {
          // The stretcher plays late; start it early so the voice stays on the beat.
          const c = compensateLatency(when, offset, b - a - skip, now, src.getLatency());
          if (!c) { free(src, env); continue; }
          src.start(c.when, c.offset, c.duration);
        } else {
          src.start(when, offset, b - a - skip);
        }
        this.sources.push({ src, end: segEnd, env });
      }
    }
  }

  private fire(id: DrumId, when: number): void {
    const ctx = this.ctx;
    const b = this.drumBuffers.get(id);
    if (!ctx || !b || !this.drumGain) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.drumGain);
    src.start(when);
    this.sources.push({ src, end: when + b.duration });
  }

  private fireSynth(part: SynthPart, hit: SynthHit, when: number, stepSec: number): void {
    const ctx = this.ctx;
    const g = this.synthGains.get(part.id);
    if (!ctx || !g) return;
    const { buf } = this.synthBuffer(part.sound, hit.midis, hit.len * stepSec, hit);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // A guitar stroke has its own loudness, and lands a few ms off the grid, as a hand does.
    let env: GainNode | undefined;
    if (hit.gain !== undefined && hit.gain !== 1) {
      env = ctx.createGain();
      env.gain.value = hit.gain;
      src.connect(env);
      env.connect(g);
    } else {
      src.connect(g);
    }
    const at = Math.max(ctx.currentTime, when + (hit.shift ?? 0));
    src.start(at);
    this.sources.push({ src, end: at + buf.duration, env, part: part.id, at });
    // The song's strumming takes the guitar back from a chord its keyboard left ringing.
    if (part.sound === 'strum') this.dampLive(part.id, at, hit.mute ? 0.03 : 0.05);
  }

  /**
   * A keyboard key held down. A note sounds until `release()` (up to PRESS_SEC), then fades
   * out like a real let-go. A guitar key is a chord: it is strummed at once, then in the
   * part's pattern for as long as it is held — on the song's beat while the song plays — and
   * its last stroke rings on after the key is let go, as a strummed chord does, until the
   * guitar's next stroke damps it. Plays even when the song is stopped.
   */
  async pressSynth(part: SynthPart, degree: number): Promise<{ release: () => void }> {
    const ctx = this.ctx;
    const none = { release: () => {} };
    if (!ctx || !this.master) return none;
    await ctx.resume();
    if (this.ctx !== ctx) return none;
    if (isGuitar(part.sound)) return this.holdChord(part, degree);
    const { buf } = this.synthBuffer(part.sound, [degreeToMidi(part.key, part.sound, degree)], PRESS_SEC, {}, 'tap|');
    const g = ctx.createGain();
    g.gain.value = part.volume;
    g.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start();
    let done = false;
    const end = () => { free(src); try { g.disconnect(); } catch { /* already */ } };
    const timer = setTimeout(() => { done = true; end(); }, (buf.duration + 0.2) * 1000);
    return {
      release: () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const t = ctx.currentTime;
        g.gain.setValueAtTime(part.volume, t);
        g.gain.linearRampToValueAtTime(0, t + 0.12);
        try { src.stop(t + 0.15); } catch { /* ended */ }
        setTimeout(end, 400);
      },
    };
  }

  /** The loop step (a 16th; 0 = the song's start) the playhead is at, with its fraction. */
  private stepNow(): number {
    const stepSec = 60 / this.project.bpm / 4;
    return Math.round(this.rangeStart / stepSec) + (this.position() - this.rangeStart) / stepSec;
  }

  /**
   * The step of the 4-bar loop a guitar chord pressed now starts on: the nearest 8th, where a
   * strumming hand's strokes fall. What the Editor records for it.
   */
  chordStep(): number {
    return (((2 * Math.round(this.stepNow() / 2)) % SYNTH_STEPS) + SYNTH_STEPS) % SYNTH_STEPS;
  }

  private holdChord(part: SynthPart, degree: number): { release: () => void } {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const stepSec = 60 / this.project.bpm / 4;
    // On the song's grid while it plays; with "beat 1 is now" while it doesn't.
    const sNow = this.playing ? this.stepNow() : 0;
    const start = 2 * Math.round(sNow / 2);
    const hold: Hold = { part, degree, anchor: sNow, t0: now, last: now + (start - sNow) * stepSec };
    // One guitar, one chord: this one takes over from the chord held before it, and from the
    // song's own strokes for the part — those already sent for the next moment would land on it.
    this.holds.set(part.id, hold);
    for (const s of this.sources) {
      if (s.part !== part.id || s.at === undefined) continue;
      if (s.at > now) {
        try { s.src.stop(); } catch { /* ended */ }
        try { s.src.disconnect(); } catch { /* already */ }
      } else if (s.env) {
        // Sounding now: the new chord damps it, as the next stroke of the song would have.
        s.env.gain.setValueAtTime(s.env.gain.value, now);
        s.env.gain.linearRampToValueAtTime(0, now + 0.05);
      }
    }
    for (const k of [...(this.ringing.get(part.id) ?? [])]) if (k.at > now) k.cancel();
    const first = guitarStroke(part, degree, start, true);
    if (first) this.strumLive(hold, first, now, true);
    if (!this.holdTimer) this.holdTimer = setInterval(() => this.tickHolds(), TICK_MS);
    this.tickHolds();
    return {
      release: () => {
        if (this.holds.get(part.id) !== hold) return; // a newer chord has the guitar
        this.holds.delete(part.id);
        // The hand stops: strokes not sounding yet never will; the last one rings on.
        const t = this.ctx?.currentTime ?? 0;
        for (const k of [...(this.ringing.get(part.id) ?? [])]) if (k.at > t) k.cancel();
        this.endHolds();
      },
    };
  }

  /** Strum the held guitar chords: every stroke of their patterns that falls in the next moment. */
  private tickHolds(): void {
    const ctx = this.ctx;
    if (!ctx || !this.holds.size) { this.endHolds(); return; }
    const now = ctx.currentTime;
    const stepSec = 60 / this.project.bpm / 4;
    for (const h of this.holds.values()) {
      const sNow = this.playing ? this.stepNow() : h.anchor + (now - h.t0) / stepSec;
      for (let k = Math.ceil(sNow - 1e-6); ; k++) {
        const when = now + (k - sNow) * stepSec;
        if (when >= now + HOLD_AHEAD_SEC) break;
        if (when <= h.last + stepSec / 2) continue; // dealt with (or the step the chord started on)
        h.last = when;
        const stroke = guitarStroke(h.part, h.degree, k, false);
        if (stroke) this.strumLive(h, stroke, Math.max(now, when + stroke.shift), false);
      }
      // Synthesise the strokes coming up before they are due — one a tick, the nearest first.
      // Done as each fell, the first pass through a chord's pattern would land every new
      // stroke late by however long it takes to make. (Once per stroke: they are kept.)
      for (let k = Math.ceil(sNow - 1e-6); k < sNow + RENDER_AHEAD_STEPS; k++) {
        const stroke = guitarStroke(h.part, h.degree, k, false);
        if (!stroke || this.synthBufs.has(synthKey(h.part.sound, stroke.midis, liveSeconds(stroke, stepSec), stroke))) continue;
        this.synthBuffer(h.part.sound, stroke.midis, liveSeconds(stroke, stepSec), stroke);
        break;
      }
    }
  }

  private endHolds(): void {
    if (this.holds.size || !this.holdTimer) return;
    clearInterval(this.holdTimer);
    this.holdTimer = null;
  }

  /**
   * Sound one stroke of a held chord at `when`. Rendered to ring out (liveSeconds), because
   * only the next stroke knows when this one ends: as that lands it fades this out — every
   * string for a strum or a new chord (`fresh`); a picked string leaves its chord ringing.
   * Its source copies the buffer, so it is freed as soon as it has faded or run out.
   */
  private strumLive(hold: Hold, k: Stroke, when: number, fresh: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const { part } = hold;
    const { buf } = this.synthBuffer(part.sound, k.midis, liveSeconds(k, 60 / this.project.bpm / 4), k);
    const level = part.volume * k.gain;
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start(when);
    const list = this.ringing.get(part.id) ?? [];
    this.ringing.set(part.id, list);
    let done = false;
    const end = () => {
      free(src);
      try { g.disconnect(); } catch { /* already */ }
      const i = list.indexOf(me);
      if (i >= 0) list.splice(i, 1);
    };
    const finish = (afterMs: number) => {
      done = true;
      clearTimeout(timer);
      clearTimeout(damper);
      setTimeout(end, afterMs);
    };
    const me: LiveStroke = {
      at: when,
      stop: fade => {
        if (done) return;
        const t = ctx.currentTime;
        g.gain.setValueAtTime(level, t);
        g.gain.linearRampToValueAtTime(0, t + fade);
        try { src.stop(t + fade + 0.03); } catch { /* ended */ }
        finish(400);
      },
      cancel: () => {
        if (done) return;
        try { src.stop(); } catch { /* ended */ }
        finish(0);
      },
    };
    const wait = Math.max(0, when - ctx.currentTime);
    const damps = fresh || part.sound === 'strum';
    const damper = setTimeout(() => {
      if (!damps) return;
      for (const o of [...list]) if (o !== me && o.at <= when) o.stop(k.mute ? 0.03 : 0.05);
    }, wait * 1000);
    const timer = setTimeout(() => { done = true; end(); }, (wait + buf.duration + 0.2) * 1000);
    list.push(me);
  }

  /** Fade out what a guitar's keyboard left ringing, as a stroke of the song lands at `when`. */
  private dampLive(partId: string, when: number, fade: number): void {
    const ctx = this.ctx;
    const list = this.ringing.get(partId);
    if (!ctx || !list?.length) return;
    setTimeout(() => { for (const o of [...list]) if (o.at <= when) o.stop(fade); }, Math.max(0, (when - ctx.currentTime) * 1000));
  }

  private fireClick(accent: boolean, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.clicks || !this.clickGain) return;
    const src = ctx.createBufferSource();
    src.buffer = accent ? this.clicks.accent : this.clicks.beat;
    src.connect(this.clickGain);
    src.start(when);
    this.sources.push({ src, end: when + 0.05 });
    if (this.logClicks) this.clickLog.push({ frame: Math.floor(when * ctx.sampleRate), accent });
  }

  /** The exact click sounds, for the click remover. */
  clickSounds(): { accent: Float32Array; beat: Float32Array } | null {
    if (!this.clicks) return null;
    return { accent: this.clicks.accent.getChannelData(0), beat: this.clicks.beat.getChannelData(0) };
  }

  // ── metronome ──────────────────────────────────────────────────────────────

  /**
   * The mics this phone can record from and the one in use. iOS can switch between them
   * (`chooseMic`); on Android the library can only list them — Android picks (a plugged-in
   * headset mic wins), so `current` there is that best guess and `canChoose` is false.
   * `bluetoothOut`: the song plays into Bluetooth earphones. Their mic is never offered: it
   * only works in phone-call mode, which drops what you HEAR to call quality too, so the
   * phone's own mic records instead.
   */
  async mics(): Promise<{ list: Mic[]; current: Mic | null; canChoose: boolean; bluetoothOut: boolean }> {
    const ios = Platform.OS === 'ios';
    try {
      const info = await AudioManager.getDevicesInfo();
      const list = toMics(info.availableInputs as RawDevice[], ios);
      const cur = ios ? info.currentInputs[0]?.id : null;
      const current = ios ? list.find(m => m.id === cur) ?? null : androidLikelyMic(list);
      const bluetoothOut = info.currentOutputs.some(d => /Bluetooth/i.test(d.category ?? ''));
      return { list, current, canChoose: ios, bluetoothOut };
    } catch {
      return { list: [], current: null, canChoose: false, bluetoothOut: false };
    }
  }

  /** Record from this mic from now on (iOS). True when the phone took it. */
  async chooseMic(id: string): Promise<boolean> {
    try { return await AudioManager.setInputDevice(id); } catch (e) {
      console.log('[LIVIL][STUDIO] mic switch failed', e);
      return false;
    }
  }

  /**
   * True when the phone is playing into headphones / earbuds / AirPods, so a click cannot
   * reach the phone's own mic. On the speaker the mic records it, and the click remover
   * takes it out afterwards (src/utils/audioClean/clickRemover.ts).
   */
  async headphonesConnected(): Promise<boolean> {
    try {
      const info = await AudioManager.getDevicesInfo();
      return info.currentOutputs.some(d => isPrivateOutput(d.category));
    } catch {
      return false;
    }
  }

  /**
   * `headphones` from `headphonesConnected()`. On the speaker the click plays quieter: a
   * small phone speaker distorts when loud, and distortion is the part the remover cannot
   * predict.
   */
  setMetronome(on: boolean, headphones: boolean): void {
    this.metronome = on;
    this.speakerClick = on && !headphones;
    // ÷ LIVE_TRIM: the click goes through the master, but it should not get quieter with it.
    if (this.clickGain) this.clickGain.gain.value = on ? (headphones ? 0.7 : 0.35) / LIVE_TRIM : 0;
  }

  /**
   * Where the beat is, for the visual metronome: during the count-in `countIn` is the beat
   * being counted (1–4), afterwards `beat` is the beat of the bar (0–3). Null when stopped.
   */
  beatState(): { countIn: number | null; beat: number } | null {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return null;
    const beatSec = 60 / this.project.bpm;
    const t = ctx.currentTime - this.t0;
    if (t < 0) return { countIn: Math.min(4, Math.max(1, 4 - Math.floor(-t / beatSec))), beat: 0 };
    return { countIn: null, beat: Math.floor(this.position() / beatSec) % 4 };
  }

  /** A pad tap: play now, through the drum bus, even if drums are muted or stopped. */
  async tapDrum(id: DrumId): Promise<void> {
    const ctx = this.ctx;
    const b = this.drumBuffers.get(id);
    if (!ctx || !b) return;
    await ctx.resume();
    const g = ctx.createGain();
    g.gain.value = this.project.drumVolume; // a tapped pad sounds like the beat: it rides the master like it
    g.connect(this.master ?? ctx.destination);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(g);
    src.start();
  }

  /**
   * The Magic Tune screen's preview: raw and tuned copies start together and a gain flip
   * chooses which one you hear, so "hold to hear the raw take" is instant and in sync.
   */
  private previewBuffer(ctx: AudioContext, data: Float32Array, sampleRate: number): AudioBuffer {
    let b = this.previewBufs.get(data);
    if (!b) {
      b = ctx.createBuffer(1, data.length, sampleRate);
      b.copyToChannel(data, 0);
      this.previewBufs.set(data, b);
      // Raw + cleaned + a tuned version or two is all a preview ever needs at once.
      while (this.previewBufs.size > 4) this.previewBufs.delete(this.previewBufs.keys().next().value!);
    }
    return b;
  }

  /**
   * Does the slow part of a preview ahead of time — wakes the audio and loads `data` — so a
   * later previewAB() of the same array starts at once. "Your song" shows a spinner until
   * this resolves instead of a Play button that seems to ignore the first tap.
   */
  async preparePreview(data: Float32Array, sampleRate: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = Date.now();
    await ctx.resume();
    const t1 = Date.now();
    if (this.ctx === ctx) this.previewBuffer(ctx, data, sampleRate);
    console.log(`[LIVIL][STUDIO] preview ready: wake ${t1 - t0} ms · load ${Date.now() - t1} ms`);
  }

  async previewAB(
    raw: Float32Array,
    tuned: Float32Array | null,
    sampleRate: number,
    onEnded: () => void,
    /** Start this many seconds in (the seek bar). */
    fromSec = 0,
  ): Promise<{ setRaw: (on: boolean) => void; stop: () => void; position: () => number }> {
    const ctx = this.ctx;
    const idle = { setRaw: () => {}, stop: () => {}, position: () => fromSec };
    if (!ctx) return idle;
    // One preview at a time. Two quick taps used to start two (each waited on resume(), then
    // both played): the song overlapping itself (2026-10-31).
    const gen = ++this.previewGen;
    this.activePreview?.stop();
    this.activePreview = null;
    this.stop();
    const t0 = Date.now();
    await ctx.resume();
    if (Date.now() - t0 > 250) console.log(`[LIVIL][STUDIO] preview: audio took ${Date.now() - t0} ms to wake`);
    if (gen !== this.previewGen || this.ctx !== ctx) return idle;
    const make = (data: Float32Array, level: number) => {
      const b = this.previewBuffer(ctx, data, sampleRate);
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(g);
      return { src, g };
    };
    const a = make(raw, tuned ? 0 : 1);
    const b = tuned ? make(tuned, 1) : null;
    let ended = false;
    // Unhook this preview's nodes from the speaker, or every play/seek leaves two more gain nodes
    // that the audio thread keeps processing for the rest of the session.
    const release = () => {
      for (const n of [a, b]) {
        if (!n) continue;
        free(n.src);
        try { n.g.disconnect(); } catch { /* already */ }
      }
    };
    a.src.onEnded = () => { if (!ended) { ended = true; release(); onEnded(); } };
    const when = ctx.currentTime + 0.03;
    const from = Math.max(0, Math.min(fromSec, raw.length / sampleRate - 0.01));
    a.src.start(when, from);
    b?.src.start(when, from);
    const handle = {
      setRaw: (on: boolean) => {
        if (!b) return;
        a.g.gain.value = on ? 1 : 0;
        b.g.gain.value = on ? 0 : 1;
      },
      stop: () => {
        ended = true;
        try { a.src.stop(); } catch { /* ended */ }
        try { b?.src.stop(); } catch { /* ended */ }
        release();
      },
      position: () => from + Math.max(0, ctx.currentTime - when),
    };
    this.activePreview = handle;
    return handle;
  }

  // ── recording ──────────────────────────────────────────────────────────────

  /**
   * Start a take. `withBacking` plays the project underneath from the top so a new voice
   * can be sung over the others (headphones, or the speaker bleeds into the take).
   * Returns an error message instead of throwing.
   */
  async startRecording(
    onLevel: (rms: number) => void,
    withBacking: boolean,
    countIn = false,
  ): Promise<string | null> {
    if (!this.ctx) return 'Audio is not ready yet.';
    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== 'Granted') return 'Livil needs the microphone to record. Allow it in Settings.';
    const rec = new AudioRecorder();
    this.chunks = [];
    this.recordRate = this.ctx.sampleRate;
    // Probe for ADR-0036 condition 1: does FLAC file output work on this phone? The take
    // itself comes from the PCM callback below, so a failure here only gets logged.
    const file = rec.enableFileOutput({ format: FileFormat.Flac, preset: FilePreset.Lossless, channelCount: 1 });
    if (file.status === 'error') console.log('[LIVIL][STUDIO] FLAC file output unavailable:', file.message);
    const cb = rec.onAudioReady({ sampleRate: this.ctx.sampleRate, bufferLength: 2048, channelCount: 1 }, e => {
      const data = e.buffer.getChannelData(0);
      this.recordRate = e.buffer.sampleRate;
      if (this.firstChunk) { const f = this.firstChunk; this.firstChunk = null; f(data.length); }
      this.chunks.push(new Float32Array(data));
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      onLevel(Math.sqrt(s / Math.max(1, data.length)));
    });
    if (cb.status === 'error') return cb.message;
    const bar = barSeconds(this.project.bpm);
    // The count-in bar runs with the metronome off too — silently, for the beat dots.
    const lead = countIn ? bar : 0;
    // Click on the speaker: record the count-in too. Those four clicks, with nobody singing
    // yet, are how the click remover learns what the click sounds like in this room.
    const capture = lead > 0 && this.speakerClick;
    this.clickLog = [];
    this.logClicks = this.speakerClick;
    // When the first audio arrives, the take's sample 0 was one chunk ago. That beats
    // "when start() returned": the iPhone mic can take a few hundred ms to warm up.
    const firstAudio = new Promise<boolean>(resolve => {
      this.firstChunk = len => {
        if (this.ctx) this.recordStartedAt = this.ctx.currentTime - len / this.ctx.sampleRate;
        resolve(true);
      };
      setTimeout(() => resolve(false), 2000);
    });
    const begin = (): string | null => {
      const started = rec.start();
      if (started.status === 'error') { this.stop(); this.logClicks = false; this.firstChunk = null; return started.message; }
      this.recordStartedAt = this.ctx!.currentTime;
      this.recorder = rec;
      return null;
    };
    if (capture) {
      const err = begin();
      if (err) return err;
      // Never start the count-in before the mic is actually recording: the remover
      // learns the click from those four count-in clicks.
      if (!(await firstAudio)) console.log('[LIVIL][STUDIO] no audio from the mic after 2 s');
    }
    // The transport runs for every take: it drives the beat dots and lines the take up with
    // the beat, even with nothing to hear (no backing, metronome off).
    await this.play(0, lead);
    if (lead > 0) {
      // One bar before the take: 1-2-3-4, accent on the 1 — heard only with the metronome on.
      const beatSec = 60 / this.project.bpm;
      if (this.metronome) for (let i = 0; i < 4; i++) this.fireClick(i === 0, this.t0 - bar + i * beatSec);
      await new Promise<void>(r => setTimeout(r, Math.max(0, (this.t0 - this.ctx!.currentTime) * 1000 - 20)));
      if (!this.playing) {
        if (capture) { this.stopRecording(); }
        this.logClicks = false;
        return 'Recording was cancelled.';
      }
    }
    return capture ? null : begin();
  }

  get isRecording(): boolean {
    return !!this.recorder;
  }

  /**
   * `offset` lines the take up with the timeline: how many seconds after the beat's zero the
   * recorder started (negative = it started early; trim that much off the front). Input
   * latency is not compensated — the clip can be nudged by hand in the Editor.
   */
  stopRecording(): {
    samples: Float32Array;
    sampleRate: number;
    offset: number;
    /** Clicks the mic heard (speaker only), in samples from the take's start. */
    clicks: { at: number; accent: boolean }[];
    /** Sample where the count-in ends and singing may begin. */
    calibrationEnd: number;
  } | null {
    const rec = this.recorder;
    if (!rec) return null;
    this.recorder = null;
    rec.clearOnAudioReady();
    const info = rec.stop();
    if (info.status === 'success') {
      console.log(`[LIVIL][STUDIO] FLAC probe: ${info.paths.join(', ')} · ${info.size.toFixed(2)} MB · ${info.duration.toFixed(1)} s`);
    } else {
      console.log('[LIVIL][STUDIO] recorder stop:', info.message);
    }
    const offset = this.playing ? this.recordStartedAt - this.t0 + this.rangeStart : 0;
    const sr = this.recordRate;
    const clicks = this.clickLog
      .map(c => ({ at: c.frame - this.recordStartedAt * sr, accent: c.accent }))
      .filter(c => c.at > -sr * 0.6);
    const calibrationEnd = Math.max(0, -offset * sr);
    this.clickLog = [];
    this.logClicks = false;
    this.firstChunk = null;
    this.stop(false);
    this.pausedAt = 0;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { samples.set(c, o); o += c.length; }
    this.chunks = [];
    return { samples, sampleRate: sr, offset, clicks, calibrationEnd };
  }
}
