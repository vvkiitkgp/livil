import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { COLORS } from '../theme/colors';
import haptics from '../utils/haptics';

/**
 * The one scrubber. Replaces both SeekBar (plain progress) and ClipRangeSlider
 * (clip trimming) so every surface reads the same way.
 *
 * ── Two layouts ───────────────────────────────────────────────────────────
 *
 * layout='proportional' — the FEED. The width maps linearly onto 0 → duration,
 *   so the bars are the whole song and the purple box marks, to scale, the slice
 *   a repost took out of it. Nothing here moves or is draggable.
 *
 * layout='anchored' — the PLAYER. The purple box is nailed to fixed screen
 *   positions and NEVER moves, and neither do the handles on its edges. Trimming
 *   works by ZOOMING the waveform underneath them: the bars inside the box always
 *   represent exactly [clipStart, clipEnd], so pulling a handle re-samples the
 *   envelope and the clip appears to grow or shrink while the furniture stays put.
 *   The gutters on either side hold faded GHOST bars — a peek at the audio just
 *   outside the clip — which is what makes the zoom legible instead of arbitrary.
 *   A gutter is empty when there is nothing out there: clipStart at 0:00 draws no
 *   left ghosts, clipEnd at the track end draws no right ghosts.
 *
 *   Dragging a handle out INTO its gutter has nowhere further to go, so it
 *   switches to a crawl: the clip extends in that direction at a speed set by how
 *   far past the edge the finger is. That is the only way to travel outward, and
 *   it is why the gutters have to be wide enough to drag into.
 *
 * Both layouts are a pure RENDER transform. Every value crossing this component's
 * API — `position`, `clipStart`, `clipEnd`, everything a callback emits — is
 * ABSOLUTE full-track seconds, per the coordinate rule in CLAUDE.md. Nothing
 * downstream (PlaybackContext, the native clip prop, the lock screen) can tell
 * which layout drew it.
 *
 * ── Why the bars are stacked SVGs ─────────────────────────────────────────
 * Position ticks ~10×/sec on every mounted scrubber, and a feed can hold a dozen.
 * So the bars are drawn ONCE per (window, width) into two identical
 * memoized <Svg> layers — unplayed underneath, brand-gradient on top — and the
 * top one is revealed by an overflow-clipped parent whose width is the progress.
 * A position change touches two style props and re-renders no SVG. This is the
 * same "pass the FULL width and let the parent clip it" rule GradientFill states:
 * sizing the gradient to the fill makes the colours stretch as playback advances.
 */

export type WaveformScrubberSpan = 'full' | 'clip';
export type WaveformScrubberLayout = 'proportional' | 'anchored';

export type WaveformScrubberProps = {
  /** FULL track duration in absolute seconds. */
  duration: number;
  /** Current playback position in absolute seconds. */
  position: number;
  /**
   * Stable id (trackId) seeding this track's bar shape, so the same song always
   * draws the same wave instead of a new one on every mount.
   */
  seed?: string;
  /** See the layout note above. */
  layout?: WaveformScrubberLayout;
  /**
   * proportional only: which slice of the track the width maps onto. 'clip'
   * zooms the whole width to [clipStart, clipEnd]. Ignored when anchored, where
   * the box is always the clip by construction.
   */
  span?: WaveformScrubberSpan;
  /** Clip bounds in absolute seconds. */
  clipStart?: number;
  clipEnd?: number;
  /** Draw + allow dragging the clip handles. */
  editableClip?: boolean;
  minClipSeconds?: number;
  maxClipSeconds?: number;
  /**
   * Treat the clip as a fixed-length window to be POSITIONED rather than resized.
   * Stories pin theirs at the 10s cap and want to move it around the song.
   *
   * Governs both handles, differently, because they are not symmetric:
   *   left  — always positions. It never resizes, in either direction.
   *   right — resizes while there is room (so a story CAN be made shorter), and
   *           carries the whole window once it is at the cap and still pushing
   *           outward.
   * Without the second half of that rule a handle freezes solid at the cap.
   */
  slideWindow?: boolean;
  /**
   * Allow the SWIPE-to-scrub gesture. When false the component is display-only.
   * Note this is a scrub, not a seek: a swipe pushes playback along by the
   * distance travelled, it does not jump it to the touched point.
   */
  seekable?: boolean;
  /**
   * Colour the played bars with the brand gradient. That IS the progress
   * indicator — there is no playhead line and no thumb, because the boundary
   * between purple and white already says where playback is. When false the bars
   * stay uniformly white and nothing moves; the feed uses this, where the job is
   * to show the shape of the song and where the clip sits in it.
   */
  showProgress?: boolean;
  /** Total height of the waveform box. */
  height?: number;
  /**
   * anchored only: width of each gutter, i.e. how far the fixed box sits in from
   * the component's edges. This is the room the user has to drag a handle
   * outward, so it needs to be a real target — not a hairline.
   */
  gutter?: number;
  /**
   * Horizontal inset applied to BOTH ends, pulling the component away from
   * Android's left/right edge back-gesture zone — which would otherwise steal a
   * drag that starts in a gutter.
   */
  edgeInset?: number;
  /** Draw the purple box. Defaults on when anchored or when there are handles. */
  showBox?: boolean;
  onClipChange?: (start: number, end: number) => void;
  onClipChangeEnd?: (start: number, end: number, handle: 'left' | 'right') => void;
  /** A swipe has started. Use it to suspend any polling that would fight it. */
  onSeekStart?: () => void;
  /**
   * Fires on EVERY move of a scrub, at gesture rate. Meant for a time readout
   * that has to sit under the finger — keep the work to one local setState.
   *
   * Do NOT seek a player from here. Driving playback at gesture rate makes the
   * scrub stutter (see the note on FullScreenPlayer's handleScrub); the position
   * is committed once, on onSeekEnd.
   */
  onSeek?: (seconds: number) => void;
  /** The swipe ended here. The one place a surface must commit the position. */
  onSeekEnd?: (seconds: number) => void;
  /**
   * Which control the finger is currently on, or null on release.
   *
   * Exists so a surface can emphasise the READOUT for the thing being dragged — the
   * clip-start time while the left handle moves, the clip-end time while the right one
   * does, the position while scrubbing. The labels live outside this component (they
   * are laid out by each surface), so they cannot see the gesture without being told.
   *
   * Distinct from `onSeekStart`, which fires only for a scrub and says nothing about
   * the clip handles, and from `onClipChangeEnd`, which reports the handle only once
   * the drag is over.
   */
  onActiveHandleChange?: (handle: ActiveHandle | null) => void;
};

// Bar pitch: bar width + gap. Bars are sized from the measured width so a narrow
// feed card and a wide player both stay legible instead of one squashing.
const BAR_PITCH = 5;
const BAR_W = 3;
const MIN_BARS = 16;
const MAX_BARS = 96;
const MIN_BAR_H = 3;
const MAX_GHOST_BARS = 7;

/**
 * Vertical touch padding above and below the box. Exported because it is real
 * layout: a caller stacking things against this component is spacing against
 * `height + SCRUBBER_SLOP * 2`, and hardcoding that sum is how the fullscreen
 * player ended up overlapping its own stats row.
 */
export const SCRUBBER_SLOP = 12;
const HIT_SLOP = SCRUBBER_SLOP;

/**
 * The anchored player preset. Exported so every surface that edits a clip —
 * the fullscreen player and the repost/story editor — is literally the same
 * control rather than two hand-tuned copies that drift apart.
 */
export const SCRUBBER_BOX_H = 32;
export const SCRUBBER_GUTTER = 40;
/**
 * Bottom margin for a caller's time-label row. Negative on purpose: SCRUBBER_SLOP
 * above the box is a transparent touch target, not visual space, so without this
 * the labels read as floating clear of the wave they describe.
 */
export const SCRUBBER_LABEL_PULL = -6;
const BOX_RADIUS = 12;
const BOX_PAD_X = 10;      // inset from the box edge to the first/last bar
const HANDLE_W = 9;
const HANDLE_GRIP_W = 2.5;
const DEFAULT_GUTTER = 46;
// How close to a box edge a touch has to land to mean "that handle" rather than
// a scrub. Roughly a fingertip — the handle pill itself is only 9dp wide.
const HANDLE_GRAB = 28;

// How much audio a gutter previews, as a share of the clip length — the mock's
// ratio. Floored at 2s so a very short clip still shows context.
const GHOST_SHARE = 0.12;
const GHOST_MIN_SECONDS = 2;
// Below this much material there is nothing worth drawing (and at exactly 0 the
// gutter must be empty — clipStart at 0:00 has no "before").
const GHOST_DEAD_ZONE = 0.3;

// Crawl speed when a handle is dragged past its gutter, in track-seconds per
// second: a floor so it always creeps, ramping with overshoot so a decisive drag
// travels fast. Matches the prototype.
const CRAWL_BASE = 6;
const CRAWL_RAMP = 30;
const CRAWL_FULL_AT = 0.2;   // overshoot fraction at which ramp saturates
const CRAWL_MAX_DT = 0.05;   // clamp dt so a dropped frame can't jump the clip

const UNPLAYED = 'rgba(255,255,255,0.26)';
const GHOST = 'rgba(255,255,255,0.20)';

let gradientCounter = 0;
function nextGradientId(): string {
  gradientCounter += 1;
  return `lvwave_${gradientCounter}`;
}

/* ── Bar heights ─────────────────────────────────────────────────────────── */

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** FNV-1a — deterministic per track, so the decorative shape never flickers. */
/* eslint-disable no-bitwise */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded phases, so a given track always draws the same shape. */
function phasesFor(seed: string): [number, number, number] {
  const h = hashSeed(seed || 'livil');
  return [
    (h % 1000) / 1000 * Math.PI * 2,
    ((h >>> 10) % 1000) / 1000 * Math.PI * 2,
    ((h >>> 20) % 1000) / 1000 * Math.PI * 2,
  ];
}
/* eslint-enable no-bitwise */

/**
 * Bar height at a moment in the track, 0..1.
 *
 * These are SYNTHETIC — not the song's actual amplitude — and that is a
 * deliberate call, not a fallback. The anchored layout's whole illusion is that
 * trimming zooms the waveform, and the zoom has to animate smoothly to sell it.
 * A real envelope resampled by peak-hold jumps between zoom levels: a bar that
 * held the loudest sample of a 4-second slice bears no relation to the bar that
 * replaces it when the slice becomes 2 seconds, so the wave pops rather than
 * stretches. A continuous function of TIME stretches, because that is what
 * sampling a continuous function at a finer interval does.
 *
 * Indexed by absolute seconds, NOT by bar number — that is the load-bearing
 * detail. Index by bar number and every window produces the identical picture,
 * so trimming would visibly change nothing at all.
 */
export function decorativeAt(timeSec: number, seed: string): number {
  const [p1, p2, p3] = phasesFor(seed);
  const t = timeSec;
  const v = Math.abs(
    Math.sin(t * 1.7 + p1) +
    0.60 * Math.sin(t * 3.3 + p2) +
    0.35 * Math.sin(t * 7.9 + p3) +
    0.20 * Math.sin(t * 17.1 + p1 + p2),
  );
  // Floor at 0.16 so a trough still reads as a bar rather than a gap.
  return clamp01(0.16 + 0.84 * Math.min(1, v / 1.75));
}

/** Sample `count` bars across [from, to] absolute seconds. */
export function decorativeBars(
  from: number,
  to: number,
  count: number,
  seed: string,
): number[] {
  const step = (to - from) / Math.max(1, count);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = decorativeAt(from + (i + 0.5) * step, seed);
  }
  return out;
}

/**
 * The slice of track a gutter previews, or null when the gutter must be EMPTY.
 *
 * Empty is the whole point: a clip that starts at 0:00 has nothing before it, so
 * the left gutter draws no bars and that blankness tells the user they have hit
 * the start of the song. Same at the far end. Anything less than a moment of
 * material is treated as none, so a sub-frame sliver can't draw a single stray
 * bar at the edge.
 */
export function ghostWindow(
  clipStart: number,
  clipEnd: number,
  duration: number,
  side: 'left' | 'right',
): { from: number; to: number } | null {
  const seconds = Math.max(GHOST_MIN_SECONDS, (clipEnd - clipStart) * GHOST_SHARE);
  const from = side === 'left' ? Math.max(0, clipStart - seconds) : clipEnd;
  const to = side === 'left' ? clipStart : Math.min(duration, clipEnd + seconds);
  return to - from < GHOST_DEAD_ZONE ? null : { from, to };
}

/**
 * Where a swipe lands the playhead.
 *
 * This is a SCRUB, not a seek. `originT` is where playback was when the finger
 * went down and `originX` is where the finger went down — the result is a DELTA
 * from there, so touching the bar never teleports playback to the touched point.
 * You push the song along by the distance you swipe.
 *
 * Scale follows the zoom: a swipe across the full bar width moves playback by
 * the full VISIBLE span, so in the player's anchored layout (where the bars are
 * the clip) the same gesture crosses the clip rather than the whole song.
 */
export function scrubTarget(
  deltaX: number,
  barsWidth: number,
  viewSpan: number,
  originT: number,
): number {
  if (barsWidth <= 0) { return originT; }
  return originT + (deltaX / barsWidth) * viewSpan;
}

/**
 * Slide a FIXED-LENGTH window so it starts at `raw`, clamped to the track.
 *
 * This is how the left handle behaves for stories, where the clip is pinned at
 * its 10s cap. Resizing is the wrong model there: `clampLeft` holds start at
 * `end - maxClipSeconds`, so a window already at the cap cannot move left by a
 * single frame — the handle looks broken. Positioning a whole window instead
 * lets it travel anywhere in the song at a constant length, and it simply stops
 * when it reaches either end of the track.
 */
export function slideWindowTo(
  raw: number,
  windowSeconds: number,
  duration: number,
): [number, number] {
  const start = Math.max(0, Math.min(duration - windowSeconds, raw));
  return [start, start + windowSeconds];
}

/**
 * The clip-END handle in slide mode: grow to the cap, then CARRY the window.
 *
 * The left handle is a pure positioner, but the right one still has to be able
 * to shrink a story below its cap — so it cannot simply slide. It resizes while
 * there is room, and only once the window is at `maxSeconds` and still being
 * pushed outward does it start carrying the whole window instead. Without that
 * last step the handle freezes at the cap exactly the way the left one did.
 */
export function moveClipEnd(
  rawEnd: number,
  start: number,
  duration: number,
  minSeconds: number,
  maxSeconds: number | undefined,
): [number, number] {
  const end = Math.min(duration, Math.max(start + minSeconds, rawEnd));
  if (maxSeconds === undefined || end - start <= maxSeconds) { return [start, end]; }
  return slideWindowTo(end - maxSeconds, maxSeconds, duration);
}

/**
 * Where the bars are drawn. This tracks the VIEW, not the purple box — the two
 * only coincide in the anchored layout.
 *
 *   anchored     — the view IS the clip, and the box is drawn around the clip, so
 *                  the bars live inside the box with the gutters left for ghosts.
 *   proportional — the view is the whole width. The box merely brackets the
 *                  clip's slice of it, so the bars must run edge to edge THROUGH
 *                  the box. Sizing them to the box instead is what once clipped
 *                  the feed's repost card down to showing only the clip.
 */
export function barsAreaFor(
  anchored: boolean,
  width: number,
  boxLeft: number,
  boxRight: number,
): { left: number; width: number } {
  const left = anchored ? boxLeft + BOX_PAD_X : BOX_PAD_X;
  const right = anchored ? boxRight - BOX_PAD_X : width - BOX_PAD_X;
  return { left, width: Math.max(0, right - left) };
}

/* ── Component ───────────────────────────────────────────────────────────── */

/**
 * The drag ratchet.
 *
 * A tick per frame is a buzz, not a ratchet, so a tick needs BOTH conditions: the
 * finger has travelled far enough, and enough time has passed. Distance alone machine-
 * guns on a fast flick; time alone keeps ticking while the finger is barely moving.
 *
 * Measured in finger travel rather than seconds of audio deliberately — the same swipe
 * feels the same whether the scrubber is showing a 30-second clip or a nine-minute
 * track, which it would not if the notch were a unit of media time.
 */
const TICK_DISTANCE = 8;
const TICK_MIN_INTERVAL_MS = 45;

/** Which control a finger is on. Exported because surfaces hold it in state to
 *  emphasise the matching time readout. */
export type ActiveHandle = 'left' | 'right' | 'scrub';
type BarRect = { key: number; x: number; y: number; w: number; h: number };

export default function WaveformScrubber({
  duration,
  position,
  seed = '',
  layout = 'proportional',
  span = 'full',
  clipStart,
  clipEnd,
  editableClip = false,
  minClipSeconds = 1,
  maxClipSeconds,
  slideWindow = false,
  seekable = true,
  showProgress = true,
  height = 56,
  gutter = DEFAULT_GUTTER,
  edgeInset = 0,
  showBox,
  onClipChange,
  onClipChangeEnd,
  onSeekStart,
  onSeek,
  onSeekEnd,
  onActiveHandleChange,
}: WaveformScrubberProps) {
  const containerRef = useRef<View>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const gradientId = useMemo(() => nextGradientId(), []);

  const anchored = layout === 'anchored';
  const dur = duration > 0 ? duration : 1;
  const cStart = Math.max(0, Math.min(dur, clipStart ?? 0));
  const cEnd = Math.max(cStart, Math.min(dur, clipEnd ?? dur));

  // Anchored ALWAYS zooms the box to the clip — that is what makes the handles
  // able to stand still. Proportional honours the span prop.
  const inClipSpan = anchored ? cEnd > cStart : (span === 'clip' && cEnd > cStart);
  const viewStart = inClipSpan ? cStart : 0;
  const viewEnd = inClipSpan ? cEnd : dur;
  const viewSpan = Math.max(0.001, viewEnd - viewStart);

  const handlesOn = editableClip && (anchored || !inClipSpan);
  const drawBox = showBox ?? (anchored || handlesOn);

  /* ── Geometry ─────────────────────────────────────────────────────────── */
  // Floor the measured size before any SVG geometry: onLayout reports fractional
  // dp and Android rounds the backing view DOWN, so geometry computed against the
  // unfloored size lands past the real edge and gets clipped on one side.
  const w = Math.floor(boxWidth);
  const h = Math.floor(height);

  // The fixed furniture. Anchored: box inset by a gutter on each side, and those
  // numbers never change for the life of the component. Proportional: the box
  // brackets the clip's share of whatever the width is showing.
  const clipLeftPx = Math.round(w * clamp01((cStart - viewStart) / viewSpan));
  const clipRightPx = Math.round(w * clamp01((cEnd - viewStart) / viewSpan));
  const gut = anchored ? Math.min(gutter, Math.floor(w / 3)) : 0;
  const boxLeft = anchored ? gut : clipLeftPx;
  const boxRight = anchored ? w - gut : clipRightPx;

  // The bars draw the VIEW, which is not the same thing as the box.
  //   anchored     — view IS the clip, so the bars live inside the box.
  //   proportional — the view is the whole width (the full song); the box only
  //                  brackets the clip's slice of it, and the bars must run edge
  //                  to edge THROUGH it. Sizing them to the box here is what
  //                  clipped the feed's repost card down to just the clip.
  const barsArea = barsAreaFor(anchored, w, boxLeft, boxRight);
  const barsLeft = barsArea.left;
  const barsW = barsArea.width;
  const barCount = Math.max(
    MIN_BARS,
    Math.min(MAX_BARS, Math.floor(barsW / BAR_PITCH) || MIN_BARS),
  );
  // Breathing room above and below the tallest bar. Proportional rather than a
  // flat 16, so a short box doesn't spend half its height on padding — at h=64
  // this is the same 16 it always was, but a halved box keeps the same ratio of
  // bar to box instead of drawing stubs.
  const barMaxH = Math.max(MIN_BAR_H, h - Math.min(16, Math.round(h * 0.25)));

  /* ── Live refs so gesture closures never read stale state ─────────────── */
  const widthRef = useRef(0);
  const pageXRef = useRef(0);
  const durationRef = useRef(dur); durationRef.current = dur;
  const startRef = useRef(cStart);
  const endRef = useRef(cEnd);
  const positionRef = useRef(position); positionRef.current = position;
  const minRef = useRef(minClipSeconds); minRef.current = minClipSeconds;
  const maxRef = useRef(maxClipSeconds); maxRef.current = maxClipSeconds;
  const slideRef = useRef(slideWindow); slideRef.current = slideWindow;
  const viewStartRef = useRef(viewStart); viewStartRef.current = viewStart;
  const viewSpanRef = useRef(viewSpan); viewSpanRef.current = viewSpan;
  const clipSpanRef = useRef(inClipSpan); clipSpanRef.current = inClipSpan;
  const handlesRef = useRef(handlesOn); handlesRef.current = handlesOn;
  const anchoredRef = useRef(anchored); anchoredRef.current = anchored;
  const barsLeftRef = useRef(barsLeft); barsLeftRef.current = barsLeft;
  const barsWRef = useRef(barsW); barsWRef.current = barsW;
  const boxLeftRef = useRef(boxLeft); boxLeftRef.current = boxLeft;
  const boxRightRef = useRef(boxRight); boxRightRef.current = boxRight;
  const onClipChangeRef = useRef(onClipChange); onClipChangeRef.current = onClipChange;
  const activeHandleRef = useRef<ActiveHandle | null>(null);
  // Ratchet bookkeeping — where and when the last tick fired.
  const lastTickXRef = useRef(0);
  const lastTickAtRef = useRef(0);

  // The clip is written through these refs on every drag tick, so the crawl loop
  // and the next move event read the value they just produced. Syncing from props
  // MID-DRAG would overwrite that with the parent's one-frame-stale copy and the
  // clip would visibly stutter backwards, so props only win between drags.
  if (activeHandleRef.current !== 'left' && activeHandleRef.current !== 'right') {
    startRef.current = cStart;
    endRef.current = cEnd;
  }

  // Where the finger and the playhead were when the swipe started. A scrub is a
  // DELTA from here, never an absolute mapping of the finger's position.
  const scrubOriginRef = useRef({ x: 0, t: 0 });
  // Window size captured at grab time, held constant while sliding.
  const grabWindowRef = useRef(0);
  // Anchor captured at grab time: dragging maps the finger's fraction across the
  // bars onto the clip length AT GRAB, so the handle tracks the finger 1:1 with
  // the zoom level it was grabbed at instead of chasing its own rescaling.
  const anchorRef = useRef({ s0: 0, dur0: 0 });
  const crawlRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);

  // Overrides `position` while the user is swiping, so the bars follow the
  // finger without waiting for the parent to round-trip through onSeekEnd.
  const [seekDragPos, setSeekDragPos] = useState<number | null>(null);
  const effectivePos = seekDragPos !== null ? seekDragPos : position;

  /* ── Layout measurement ───────────────────────────────────────────────── */
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const lw = e.nativeEvent.layout.width;
    widthRef.current = lw;
    setBoxWidth(lw);
    requestAnimationFrame(() => {
      containerRef.current?.measureInWindow(x => { pageXRef.current = x; });
    });
  }, []);

  const refreshMeasure = useCallback(() => {
    containerRef.current?.measureInWindow((x, _y, mw) => {
      pageXRef.current = x;
      widthRef.current = mw;
    });
  }, []);

  /** Screen X → local X within the component. */
  const localX = useCallback((absX: number): number => absX - pageXRef.current, []);

  /** Screen X → absolute seconds, through the bars area. */
  const secondsFromAbsX = useCallback((absX: number): number => {
    const bw = barsWRef.current;
    if (bw <= 0) { return viewStartRef.current; }
    const frac = clamp01((localX(absX) - barsLeftRef.current) / bw);
    return viewStartRef.current + frac * viewSpanRef.current;
  }, [localX]);

  /* ── Clamps ───────────────────────────────────────────────────────────── */
  const clampLeft = useCallback((raw: number): number => {
    const d = durationRef.current, curEnd = endRef.current;
    const lo = maxRef.current !== undefined ? Math.max(0, curEnd - maxRef.current) : 0;
    return Math.max(lo, Math.min(curEnd - minRef.current, Math.min(d, raw)));
  }, []);

  const clampRight = useCallback((raw: number): number => {
    const d = durationRef.current, curStart = startRef.current;
    const hi = maxRef.current !== undefined ? Math.min(d, curStart + maxRef.current) : d;
    return Math.min(hi, Math.max(curStart + minRef.current, raw));
  }, []);

  const clampSeek = useCallback((raw: number): number => {
    if (clipSpanRef.current) {
      return Math.max(startRef.current, Math.min(endRef.current, raw));
    }
    return Math.max(0, Math.min(durationRef.current, raw));
  }, []);

  /**
   * Relative scrub: where the playhead lands for a swipe that has travelled
   * (absX − grabX) since the finger went down.
   *
   * This is a SCRUB BAR, not a seek bar. Touching it does not move playback to
   * the touched point — you push the song along by the distance you swipe, from
   * wherever it happened to be. Swiping the full width of the bars moves it by
   * the full visible span, so the gesture's scale follows the zoom: in the
   * player's anchored layout a swipe crosses the clip, not the whole song.
   */
  const scrubTo = useCallback((absX: number): number => {
    const o = scrubOriginRef.current;
    return clampSeek(scrubTarget(absX - o.x, barsWRef.current, viewSpanRef.current, o.t));
  }, [clampSeek]);

  const slideStartTo = useCallback((raw: number): [number, number] =>
    slideWindowTo(raw, grabWindowRef.current, durationRef.current), []);


  /** Commit a new clip, write it through the refs, and notify the parent. */
  const commitClip = useCallback((s: number, e: number) => {
    startRef.current = s;
    endRef.current = e;
    onClipChangeRef.current?.(s, e);
  }, []);

  /**
   * Commit a new clip END, honouring slide mode. Returns what was actually
   * committed so the crawl loop can re-anchor to it.
   */
  const commitEnd = useCallback((rawEnd: number): [number, number] => {
    if (slideRef.current) {
      const [s, e] = moveClipEnd(
        rawEnd, startRef.current, durationRef.current, minRef.current, maxRef.current,
      );
      commitClip(s, e);
      return [s, e];
    }
    const e = clampRight(rawEnd);
    commitClip(startRef.current, e);
    return [startRef.current, e];
  }, [clampRight, commitClip]);

  /* ── Crawl loop (anchored only) ───────────────────────────────────────── */
  const stopCrawl = useCallback(() => {
    crawlRef.current = 0;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startCrawl = useCallback(() => {
    if (rafRef.current !== null) { return; }
    lastTsRef.current = 0;
    const step = (ts: number) => {
      const dt = Math.min(CRAWL_MAX_DT, (ts - (lastTsRef.current || ts)) / 1000);
      lastTsRef.current = ts;
      const v = crawlRef.current;
      const side = activeHandleRef.current;
      if (v !== 0 && (side === 'left' || side === 'right')) {
        const a = anchorRef.current;
        if (side === 'left' && slideRef.current) {
          // Slide mode (stories): the left handle POSITIONS a fixed-length
          // window, it never resizes it. Crawling has to slide too — resizing
          // here is dead on arrival at the cap, because clampLeft pins start at
          // `end - maxClipSeconds`, so a window already at max cannot move left
          // at all and the handle just sits there.
          const [s, e] = slideStartTo(startRef.current + v * dt);
          a.s0 = s;
          a.dur0 = e - s;
          commitClip(s, e);
        } else if (side === 'left') {
          const ns = clampLeft(startRef.current + v * dt);
          // Re-anchor as we crawl so releasing and re-dragging stays continuous.
          a.s0 = ns;
          a.dur0 = endRef.current - ns;
          commitClip(ns, endRef.current);
        } else {
          // Mirrors the left handle: at the cap the window CARRIES instead of
          // growing, so a 10s story clip can still travel right.
          const [s, e] = commitEnd(endRef.current + v * dt);
          a.s0 = s;
          a.dur0 = e - s;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [clampLeft, slideStartTo, commitEnd, commitClip]);

  useEffect(() => stopCrawl, [stopCrawl]);

  /* ── Gesture ──────────────────────────────────────────────────────────── */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim before any parent FlatList can turn this into a scroll.
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,

        onPanResponderGrant: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          refreshMeasure();
          // A grab near either box edge (or out in its gutter) takes that handle;
          // anywhere else in the body is a scrub. Deliberately NOT "nearest of
          // three" against the playhead — the playhead is not drawn any more, and
          // an invisible target that steals the swipe is worse than no target.
          const x = localX(g.x0);
          if (!handlesRef.current) {
            activeHandleRef.current = 'scrub';
          } else if (x <= boxLeftRef.current + HANDLE_GRAB) {
            activeHandleRef.current = 'left';
          } else if (x >= boxRightRef.current - HANDLE_GRAB) {
            activeHandleRef.current = 'right';
          } else {
            activeHandleRef.current = 'scrub';
          }
          // Scrub is RELATIVE: remember where the finger and the playhead were,
          // and move the playhead by the swipe's delta.
          scrubOriginRef.current = { x: g.x0, t: positionRef.current };
          onActiveHandleChange?.(activeHandleRef.current);
          // Firmer than the ratchet, so grabbing a control is a different sensation
          // from moving it.
          haptics.impact();
          lastTickXRef.current = g.x0;
          lastTickAtRef.current = Date.now();
          if (activeHandleRef.current === 'scrub') { onSeekStart?.(); }
          grabWindowRef.current = endRef.current - startRef.current;
          anchorRef.current = { s0: startRef.current, dur0: endRef.current - startRef.current };
          crawlRef.current = 0;
        },

        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          const absX = g.moveX !== 0 ? g.moveX : g.x0;
          const active = activeHandleRef.current;

          // Ratchet. Both gates must pass — see TICK_DISTANCE.
          const now = Date.now();
          if (
            Math.abs(absX - lastTickXRef.current) >= TICK_DISTANCE &&
            now - lastTickAtRef.current >= TICK_MIN_INTERVAL_MS
          ) {
            haptics.select();
            lastTickXRef.current = absX;
            lastTickAtRef.current = now;
          }

          if (active === 'scrub') {
            const t = scrubTo(absX);
            setSeekDragPos(t);
            onSeek?.(t);
            return;
          }
          if (active !== 'left' && active !== 'right') { return; }

          if (!anchoredRef.current) {
            const raw = secondsFromAbsX(absX);
            if (active === 'left') {
              if (slideRef.current) {
                const [s, e] = slideStartTo(raw);
                commitClip(s, e);
              } else {
                commitClip(clampLeft(raw), endRef.current);
              }
            } else {
              commitEnd(raw);
            }
            return;
          }

          // Anchored: f is the finger's fraction across the bars area. Inside
          // [0,1] the handle maps onto the clip length captured at grab. Outside,
          // there is no more room in that direction, so crawl instead.
          const bw = barsWRef.current || 1;
          const f = (localX(absX) - barsLeftRef.current) / bw;
          const a = anchorRef.current;

          if (active === 'left') {
            if (f >= 0) {
              crawlRef.current = 0;
              if (slideRef.current) {
                const [s, e] = slideStartTo(a.s0 + f * a.dur0);
                commitClip(s, e);
              } else {
                commitClip(clampLeft(a.s0 + f * a.dur0), endRef.current);
              }
            } else {
              crawlRef.current = -(CRAWL_BASE + CRAWL_RAMP * Math.min(1, -f / CRAWL_FULL_AT));
              startCrawl();
            }
          } else if (f <= 1) {
            crawlRef.current = 0;
            commitEnd(a.s0 + f * a.dur0);
          } else {
            crawlRef.current = CRAWL_BASE + CRAWL_RAMP * Math.min(1, (f - 1) / CRAWL_FULL_AT);
            startCrawl();
          }
        },

        onPanResponderRelease: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          const active = activeHandleRef.current;
          stopCrawl();
          activeHandleRef.current = null;
          onActiveHandleChange?.(null);
          // Closes the arc: engage, ratchet, land.
          if (active) { haptics.tap(); }
          if (active === 'scrub') {
            // Always report the end of a scrub gesture, even for a tap that never
            // moved — a caller that suspended its own polling on onSeekStart has
            // no other signal to resume on, and would stay suspended forever.
            // A tap is harmless here by construction: relative scrubbing means
            // zero delta is zero change, so this lands on the origin position.
            const moved = g.moveX !== 0 && g.moveX !== g.x0;
            const landed = moved ? scrubTo(g.moveX) : scrubOriginRef.current.t;
            setSeekDragPos(null);
            onSeekEnd?.(landed);
          } else if (active === 'left' || active === 'right') {
            onClipChangeEnd?.(startRef.current, endRef.current, active);
          }
        },

        onPanResponderTerminate: () => {
          // A stolen gesture must clear the emphasis too — a label left large forever
          // is a worse failure than one that never grew.
          stopCrawl();
          setSeekDragPos(null);
          activeHandleRef.current = null;
          onActiveHandleChange?.(null);
        },
      }),
    [refreshMeasure, localX, secondsFromAbsX, scrubTo, clampLeft,
     slideStartTo, commitEnd, commitClip, startCrawl, stopCrawl, onClipChangeEnd,
     onSeekStart, onSeek, onSeekEnd, onActiveHandleChange],
  );

  /* ── Bars ─────────────────────────────────────────────────────────────── */
  const bars = useMemo(
    () => decorativeBars(viewStart, viewEnd, barCount, seed),
    [viewStart, viewEnd, barCount, seed],
  );

  const barRects = useMemo((): BarRect[] | null => {
    if (barsW <= 0) { return null; }
    const pitch = barsW / barCount;
    const bw = Math.min(BAR_W, Math.max(1, pitch - 1.5));
    return bars.map((v, i) => {
      const bh = Math.max(MIN_BAR_H, Math.round(v * barMaxH));
      return {
        key: i,
        x: barsLeft + i * pitch + (pitch - bw) / 2,
        y: (h - bh) / 2,
        w: bw,
        h: bh,
      };
    });
  }, [bars, barsLeft, barsW, barCount, barMaxH, h]);

  // Ghost gutters: a peek at the audio immediately outside the clip. Empty when
  // there is none — clipStart at 0:00 draws nothing on the left, and likewise at
  // the track end on the right. That emptiness is the signal that you have hit
  // the edge of the song.
  const ghosts = useMemo(() => {
    if (!anchored || gut <= 0) { return null; }
    const count = Math.max(2, Math.min(MAX_GHOST_BARS, Math.floor(gut / BAR_PITCH)));
    const build = (side: 'left' | 'right', originX: number): BarRect[] => {
      const win = ghostWindow(cStart, cEnd, dur, side);
      if (!win) { return []; }
      // Same continuous function, sampled just outside the clip — so the ghosts
      // line up with the in-box bars and flow into them as the clip grows.
      const vals = decorativeBars(win.from, win.to, count, seed);
      const pitch = gut / count;
      const bw = Math.min(BAR_W, Math.max(1, pitch - 1.5));
      return vals.map((v, i) => {
        const bh = Math.max(MIN_BAR_H, Math.round(v * barMaxH * 0.8));
        return {
          key: i,
          x: originX + i * pitch + (pitch - bw) / 2,
          y: (h - bh) / 2,
          w: bw,
          h: bh,
        };
      });
    };
    return { left: build('left', 0), right: build('right', boxRight) };
  }, [anchored, gut, seed, cStart, cEnd, dur, barMaxH, h, boxRight]);

  const renderBars = useCallback(
    (rects: BarRect[] | null, fill: string, gradient: boolean) => (
      <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
        {gradient ? (
          <Defs>
            <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={COLORS.purpleRoyal} stopOpacity="1" />
              <Stop offset="0.55" stopColor={COLORS.purple} stopOpacity="1" />
              <Stop offset="1" stopColor={COLORS.purpleNeon} stopOpacity="1" />
            </SvgLinearGradient>
          </Defs>
        ) : null}
        {rects?.map(b => (
          <Rect
            key={b.key}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={b.w / 2}
            ry={b.w / 2}
            fill={gradient ? `url(#${gradientId})` : fill}
            // Ghosts fade toward the outer edge, so the preview reads as
            // trailing off rather than as a second, equal waveform.
            opacity={fill === GHOST ? 0.35 + 0.65 * (b.key / Math.max(1, (rects.length - 1))) : 1}
          />
        ))}
      </Svg>
    ),
    [w, h, gradientId],
  );

  const baseLayer = useMemo(() => renderBars(barRects, UNPLAYED, false), [renderBars, barRects]);
  const playedLayer = useMemo(() => renderBars(barRects, UNPLAYED, true), [renderBars, barRects]);
  const ghostLeftLayer = useMemo(
    () => (ghosts?.left.length ? renderBars(ghosts.left, GHOST, false) : null),
    [renderBars, ghosts],
  );
  const ghostRightLayer = useMemo(
    // Right gutter fades outward too, so reverse the ramp by mirroring the keys.
    () => (ghosts?.right.length
      ? renderBars(
          ghosts.right.map((b, i, arr) => ({ ...b, key: arr.length - 1 - i })),
          GHOST,
          false,
        )
      : null),
    [renderBars, ghosts],
  );

  const posFrac = clamp01((effectivePos - viewStart) / viewSpan);
  const playX = barsLeft + posFrac * barsW;
  const handleH = Math.max(18, Math.round(h * 0.56));

  return (
    <View
      ref={containerRef}
      style={[
        styles.root,
        { height: h + HIT_SLOP * 2 },
        edgeInset ? { marginHorizontal: edgeInset } : null,
      ]}
      onLayout={handleLayout}
      accessibilityRole={seekable || handlesOn ? 'adjustable' : 'progressbar'}
      accessibilityValue={{ min: 0, max: Math.round(viewSpan), now: Math.round(posFrac * viewSpan) }}
      {...(seekable || handlesOn ? panResponder.panHandlers : {})}
    >
      <View style={[styles.box, { height: h }]}>
        {ghostLeftLayer}
        {ghostRightLayer}

        {/* The purple frame. Anchored: nailed to the gutters, never moves. */}
        {drawBox && w > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.frame, { left: boxLeft, width: Math.max(0, boxRight - boxLeft) }]}
          />
        ) : null}

        {baseLayer}

        {/* Proportional editing dims what the clip excludes. Anchored doesn't
            need it — everything outside the box is already a faded gutter. */}
        {handlesOn && !anchored && w > 0 ? (
          <>
            <View pointerEvents="none" style={[styles.scrim, styles.scrimLeft, { width: clipLeftPx }]} />
            <View pointerEvents="none" style={[styles.scrim, styles.scrimRight, { left: clipRightPx }]} />
          </>
        ) : null}

        {/* Gradient layer at FULL width, revealed by the clipped parent so the
            ramp stays pinned to the box instead of stretching as it plays. */}
        {showProgress ? (
          <View pointerEvents="none" style={[styles.playedClip, { width: Math.round(playX), height: h }]}>
            <View style={{ width: w, height: h }}>{playedLayer}</View>
          </View>
        ) : null}

        {/* Clip handles — pills straddling the frame edges. In anchored layout
            these are the fixed furniture: they never move, the waveform does. */}
        {handlesOn && w > 0 ? (
          <>
            <View
              pointerEvents="none"
              style={[styles.handle, { left: boxLeft - HANDLE_W / 2, height: handleH, top: (h - handleH) / 2 }]}
            >
              <View style={[styles.handleGrip, { height: handleH * 0.45 }]} />
            </View>
            <View
              pointerEvents="none"
              style={[styles.handle, { left: boxRight - HANDLE_W / 2, height: handleH, top: (h - handleH) / 2 }]}
            >
              <View style={[styles.handleGrip, { height: handleH * 0.45 }]} />
            </View>
          </>
        ) : null}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Generous vertical padding so the bars are easy to grab without growing the
  // visual box.
  root: {
    justifyContent: 'center',
    paddingVertical: HIT_SLOP,
  },
  box: {
    position: 'relative',
    justifyContent: 'center',
  },
  frame: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: BOX_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(139,61,255,0.35)',
    backgroundColor: 'rgba(139,61,255,0.06)',
  },
  playedClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(10,10,15,0.55)',
  },
  scrimLeft: { left: 0 },
  scrimRight: { right: 0 },
  handle: {
    position: 'absolute',
    width: HANDLE_W,
    borderRadius: HANDLE_W / 2,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGrip: {
    width: HANDLE_GRIP_W,
    borderRadius: HANDLE_GRIP_W / 2,
    backgroundColor: COLORS.bg,
  },
});
