/**
 * A loudness tap on the local preview element.
 *
 * The question this answers is the one an artist cannot answer by ear on laptop speakers:
 * *is this track at a normal level?* A mix that is 12 dB quiet does not sound wrong on its
 * own — it sounds wrong the moment it plays after somebody else's track in a feed, and by
 * then it is published. So the numbers are put on screen while they are still fixable.
 *
 * Web Audio, not a decode: the file is already playing through an `<audio>` element, and
 * tapping the live signal costs one analyser per channel. Decoding the whole file up front
 * would be more accurate and would also stall the page on a 60 MB import for a reading the
 * artist gets anyway three seconds into the preview.
 *
 * NOTE ON THE ROUTING TRAP: `createMediaElementSource` is a one-way door. Once an element
 * has a source node, its audio ONLY reaches the speakers through the graph — forget to
 * connect to `destination` and preview goes permanently silent — and calling it a second
 * time for the same element throws `InvalidStateError`. Hence the WeakMap: one tap per
 * element, forever, reused across every track the element plays.
 */

/** Everything below this reads as silence rather than as a very quiet passage. */
export const FLOOR_DB = -60;

/**
 * The boundaries the ladder and the verdict share, in RMS dBFS. They are RMS numbers, not
 * peak numbers, and that distinction is the whole design: a modern master peaks within a
 * hair of 0 dB no matter how loud it actually is, so a peak-referenced scale reads "full"
 * for every competent track and tells the artist nothing.
 */
export const LOUD_DB = -10;
export const NORMAL_DB = -22;
/** Above this the RMS is hotter than anything that survives a limiter honestly. */
export const HOT_DB = -4;

export type Levels = {
  /** Peak of the current frame, per channel, in dBFS. Drives the hold marker only. */
  peakL: number;
  peakR: number;
  /** RMS of the current frame, per channel — this is what the ladder draws. */
  rmsL: number;
  rmsR: number;
  /** RMS of the current frame across both channels, dBFS. */
  rms: number;
  /** Loudest peak seen since the last reset, with a slow decay so it stays readable. */
  hold: number;
  /** RMS integrated over everything audible played so far — the "is this quiet?" number. */
  average: number;
  /** Set once any sample has hit full scale. Never unset until reset. */
  clipped: boolean;
  /** False before enough audio has played for `average` to mean anything. */
  settled: boolean;
};

export type LevelTap = {
  read: () => Levels;
  /** Start the integration over: a new track is a new measurement. */
  reset: () => void;
};

const toDb = (amplitude: number): number =>
  amplitude <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(amplitude));

/** Peak-hold: freeze for a beat so a transient is readable, then fall at a fixed rate. */
const HOLD_MS = 1200;
const HOLD_FALL_DB_PER_SEC = 14;

/**
 * Frames quieter than this do not count toward the average. Without a gate, the silence
 * before the first downbeat and the fade at the end drag the reading down and every track
 * looks quiet.
 */
const GATE_DB = -50;

/** ~1.5 s of audio at 60 reads/sec before the average is worth showing. */
const SETTLE_FRAMES = 90;

const TAPS = new WeakMap<HTMLMediaElement, LevelTap>();

/**
 * ONE AudioContext for the whole page, created on first use.
 *
 * Browsers cap how many a document may hold (Chrome has historically thrown at around six),
 * and the video preview mounts a fresh `<video>` every time the modal opens — so a context
 * per element would work for the first few previews of a session and then quietly stop
 * producing meters. Source nodes are per element and cheap; the context is the scarce thing.
 */
let sharedContext: AudioContext | null = null;

function contextFor(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext();
  return sharedContext;
}

/**
 * Attach (or re-fetch) the tap for an element. Safe to call on every play — the second and
 * later calls return the tap the first one built.
 *
 * Returns null when Web Audio is unavailable or the element cannot be tapped (a cross-origin
 * source would taint the graph). A missing meter is not worth failing an upload over.
 */
export function levelTapFor(el: HTMLMediaElement): LevelTap | null {
  const existing = TAPS.get(el);
  if (existing) return existing;

  let ctx: AudioContext;
  let left: AnalyserNode;
  let right: AnalyserNode;
  try {
    ctx = contextFor();
    const source = ctx.createMediaElementSource(el);

    // Explicit stereo BEFORE the splitter. A splitter alone is `discrete`, which would leave
    // the right analyser reading digital silence for every mono file — and mono files are
    // common enough in a bedroom-studio upload queue that the meter would look broken.
    const upmix = ctx.createGain();
    upmix.channelCount = 2;
    upmix.channelCountMode = 'explicit';
    upmix.channelInterpretation = 'speakers';

    const splitter = ctx.createChannelSplitter(2);
    left = ctx.createAnalyser();
    right = ctx.createAnalyser();
    for (const a of [left, right]) {
      a.fftSize = 2048;
      // Time-domain reads are instantaneous samples; smoothing applies to the frequency
      // data we do not use, and setting it here would only mislead the next reader.
      a.smoothingTimeConstant = 0;
    }

    source.connect(upmix);
    upmix.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    // The only path to the speakers now runs through here. See the note at the top.
    upmix.connect(ctx.destination);
  } catch {
    return null;
  }

  const bufL = new Float32Array(left.fftSize);
  const bufR = new Float32Array(right.fftSize);

  let hold = FLOOR_DB;
  let holdAt = 0;
  let clipped = false;
  let sumSq = 0;
  let frames = 0;

  const tap: LevelTap = {
    reset() {
      hold = FLOOR_DB;
      holdAt = 0;
      clipped = false;
      sumSq = 0;
      frames = 0;
    },

    read() {
      // Suspended by an autoplay policy or a backgrounded tab: resuming here means the
      // meter recovers on its own instead of sitting dead at the floor.
      if (ctx.state === 'suspended' && !el.paused) void ctx.resume();

      left.getFloatTimeDomainData(bufL);
      right.getFloatTimeDomainData(bufR);

      let peakL = 0;
      let peakR = 0;
      let sqL = 0;
      let sqR = 0;
      for (let i = 0; i < bufL.length; i++) {
        const l = Math.abs(bufL[i]);
        const r = Math.abs(bufR[i]);
        if (l > peakL) peakL = l;
        if (r > peakR) peakR = r;
        sqL += bufL[i] * bufL[i];
        sqR += bufR[i] * bufR[i];
      }
      const rmsL = Math.sqrt(sqL / bufL.length);
      const rmsR = Math.sqrt(sqR / bufR.length);
      const frameRms = Math.sqrt((sqL + sqR) / (bufL.length * 2));
      const rmsDb = toDb(frameRms);

      if (peakL >= 0.999 || peakR >= 0.999) clipped = true;

      const now = performance.now();
      const peakDb = Math.max(toDb(peakL), toDb(peakR));
      if (peakDb >= hold) {
        hold = peakDb;
        holdAt = now;
      } else if (now - holdAt > HOLD_MS) {
        hold = Math.max(FLOOR_DB, hold - (HOLD_FALL_DB_PER_SEC * (now - holdAt - HOLD_MS)) / 1000);
        holdAt = now - HOLD_MS;
      }

      // Gated, and only while actually playing — a paused meter must not average in the
      // silence it is sitting in.
      if (!el.paused && rmsDb > GATE_DB) {
        sumSq += frameRms * frameRms;
        frames++;
      }

      return {
        peakL: toDb(peakL),
        peakR: toDb(peakR),
        rmsL: toDb(rmsL),
        rmsR: toDb(rmsR),
        rms: rmsDb,
        hold,
        average: frames === 0 ? FLOOR_DB : toDb(Math.sqrt(sumSq / frames)),
        clipped,
        settled: frames >= SETTLE_FRAMES,
      };
    },
  };

  TAPS.set(el, tap);
  return tap;
}

export type Verdict = { key: 'low' | 'normal' | 'loud' | 'clipping'; title: string; detail: string };

/**
 * The plain-language reading. Thresholds are on the INTEGRATED average, not the peak: a
 * track can peak at 0 dB and still be quiet throughout, which is exactly the case a peak
 * meter alone lets through.
 */
export function verdictFor(levels: Levels): Verdict {
  if (levels.clipped)
    return {
      key: 'clipping',
      title: 'Clipping',
      detail: 'Some peaks hit full scale. Pull the master down a couple of dB and re-export.',
    };
  if (!levels.settled)
    return { key: 'normal', title: 'Listening…', detail: 'Play a few seconds to get a reading.' };
  if (levels.average > LOUD_DB)
    return {
      key: 'loud',
      title: 'Loud',
      detail: 'Louder than most tracks. It will hold up, but check it still breathes.',
    };
  if (levels.average >= NORMAL_DB)
    return {
      key: 'normal',
      title: 'Normal',
      detail: 'Sits right next to everything else in the feed.',
    };
  return {
    key: 'low',
    title: 'Quiet',
    detail: 'Noticeably quieter than most tracks — listeners will reach for the volume.',
  };
}
