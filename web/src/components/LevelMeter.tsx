import { useEffect, useRef, useState } from 'react';
import {
  FLOOR_DB,
  HOT_DB,
  LOUD_DB,
  NORMAL_DB,
  verdictFor,
  type LevelTap,
  type Levels,
  type Verdict,
} from '../upload/levels';
import type { Quality } from '../upload/quality';

/**
 * The loudness pill — a studio level meter for the track being previewed.
 *
 * It sits OUTSIDE the upload card and is deliberately generic: it takes a tap and a title,
 * knows nothing about the queue, and can be dropped next to any local playback later.
 *
 * Two things are on screen at once because they answer different questions. The ladder is
 * the live signal — is it moving, is it hitting the top. The verdict underneath is the
 * integrated average, which is the only one that answers "is my master quiet", and the one
 * a peak meter alone will happily let you get wrong.
 *
 * The ladder is driven from `requestAnimationFrame` writing to the DOM directly. Sixty
 * React renders a second to move some bars is how a preview starts dropping audio frames;
 * the only state that reaches React is the verdict, which changes a few times a minute.
 */

/** Segment count for one channel. Enough to read as a ladder, few enough to stay crisp. */
const SEGMENTS = 36;

/** dB at the top and bottom of the ladder. */
const TOP_DB = 0;
const BOTTOM_DB = FLOOR_DB;

type Zone = 'low' | 'normal' | 'loud' | 'clip';

/**
 * The scale is EXPANDED at the loud end, and that is the point of it.
 *
 * A linear -60…0 ladder spends half its pixels on levels nobody publishes and squeezes the
 * entire interesting range — roughly -24 dB to -4 dB, where "quiet", "right" and "too hot"
 * all live — into the top third. Every real master then reads as "near the top" and the
 * meter answers nothing.
 *
 * So the mapping is piecewise: the top 12 dB get a third of the height, the top 24 dB get
 * nearly two thirds, and the basement below -40 keeps just enough to show that signal is
 * present at all. Anchors are (dB, fraction-from-bottom) and interpolate linearly between.
 */
const ANCHORS: ReadonlyArray<readonly [db: number, fraction: number]> = [
  [-60, 0],
  [-40, 0.14],
  [-24, 0.38],
  [-12, 0.68],
  [-6, 0.85],
  [0, 1],
];

/** Fraction up the ladder, 0..1, for a dB value. Exported for the scale tests. */
export const fractionForDb = (db: number): number => {
  if (db <= ANCHORS[0][0]) return 0;
  if (db >= ANCHORS[ANCHORS.length - 1][0]) return 1;
  for (let i = 1; i < ANCHORS.length; i++) {
    const [hiDb, hiFrac] = ANCHORS[i];
    if (db <= hiDb) {
      const [loDb, loFrac] = ANCHORS[i - 1];
      return loFrac + ((db - loDb) / (hiDb - loDb)) * (hiFrac - loFrac);
    }
  }
  return 1;
};

/** Inverse of `fractionForDb`, so segment `i` knows which band it belongs to. */
const dbForFraction = (fraction: number): number => {
  for (let i = 1; i < ANCHORS.length; i++) {
    const [hiDb, hiFrac] = ANCHORS[i];
    if (fraction <= hiFrac) {
      const [loDb, loFrac] = ANCHORS[i - 1];
      return loDb + ((fraction - loFrac) / (hiFrac - loFrac)) * (hiDb - loDb);
    }
  }
  return TOP_DB;
};

/** dB at the centre of segment `i`, counting from the BOTTOM. */
const dbForSegment = (i: number): number => dbForFraction((i + 0.5) / SEGMENTS);

const zoneForDb = (db: number): Zone =>
  db >= HOT_DB ? 'clip' : db >= LOUD_DB ? 'loud' : db >= NORMAL_DB ? 'normal' : 'low';

/** Labelled ticks, so "how loud" is a number and not just a height. */
const TICKS = [0, -6, -12, -24, -40] as const;

/** Percentage from the TOP of the pill, for absolutely-positioned marks and labels. */
const topPercent = (db: number): string => `${(1 - fractionForDb(db)) * 100}%`;

const SEGMENT_ZONES: Zone[] = Array.from({ length: SEGMENTS }, (_, i) =>
  zoneForDb(dbForSegment(i)),
);

const formatDb = (db: number): string =>
  db <= FLOOR_DB ? '−∞' : `${db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}`;

export function LevelMeter({
  tap,
  title,
  quality,
  active,
}: {
  /** Null until the browser has given us a graph; the meter renders idle rather than absent. */
  tap: LevelTap | null;
  /** What is being measured, so the pill is not an unlabelled column of lights. */
  title: string;
  /** The file's own quality — bitrate for audio, frame size for video. Null while probing. */
  quality: Quality | null;
  /** Playing right now. When false the ladder is parked and the last verdict is kept. */
  active: boolean;
}) {
  const ladderL = useRef<HTMLDivElement>(null);
  const ladderR = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  useEffect(() => {
    if (!tap || !active) return;
    let frame = 0;
    // The verdict is compared before it is pushed: setState on every frame with an equal
    // object would re-render the panel sixty times a second for no visible change.
    let lastKey = '';

    const paint = () => {
      frame = requestAnimationFrame(paint);
      const levels = tap.read();

      // RMS, not peak: peak pins at the ceiling on anything mastered and the ladder stops
      // moving. The peak still gets said — it is the hold marker and the line underneath.
      light(ladderL.current, levels.rmsL);
      light(ladderR.current, levels.rmsR);

      if (holdRef.current) {
        holdRef.current.style.top = topPercent(levels.hold);
        // Peak is a ceiling question, so the marker goes red only when it actually clipped.
        holdRef.current.dataset.zone = levels.clipped ? 'clip' : 'peak';
      }
      if (readoutRef.current) readoutRef.current.textContent = formatDb(levels.rms);
      if (peakRef.current) peakRef.current.textContent = formatDb(levels.hold);

      const next = verdictFor(levels);
      const key = `${next.key}:${next.title}`;
      if (key !== lastKey) {
        lastKey = key;
        setVerdict(next);
      }
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [tap, active]);

  // Parking the ladder on stop, rather than leaving the last frame frozen mid-song, so a
  // stopped meter cannot be mistaken for a playing one.
  useEffect(() => {
    if (active) return;
    light(ladderL.current, FLOOR_DB);
    light(ladderR.current, FLOOR_DB);
    if (readoutRef.current) readoutRef.current.textContent = formatDb(FLOOR_DB);
  }, [active]);

  const zoneLabel = (from: number, to: number) => topPercent(dbForFraction(
    (fractionForDb(from) + fractionForDb(to)) / 2,
  ));

  return (
    <aside className="meter" data-verdict={verdict?.key ?? 'idle'}>
      {/* Head and foot are wrapped rather than left as loose children because the narrow
          layout turns the meter on its side: the pill takes one grid column and these take
          the other, which needs them to be two boxes and not seven. */}
      <div className="meter__head">
        <p className="meter__kicker">Level</p>
        <p className="meter__track" title={title}>
          {title}
        </p>

        {/* Level is what the master sounds like; this is what the FILE is. Both belong here —
            an artist checking one is the artist who should see the other, and a 96 kbps
            export is worth catching in the same glance as a quiet mix. */}
        {quality && (
          <p className="meter__quality" data-poor={quality.poor || undefined}>
            <span className="meter__quality-value">{quality.value}</span>
            {quality.note && <span className="meter__quality-note"> {quality.note}</span>}
          </p>
        )}
      </div>

      <div className="meter__body">
        {/* Words on the left, numbers on the right: the band tells you what to think, the
            scale tells you by how much. Both are centred on the dB they describe. */}
        <div className="meter__scale" aria-hidden="true">
          <span className="meter__zone" style={{ top: zoneLabel(HOT_DB, TOP_DB) }}>
            Hot
          </span>
          <span className="meter__zone" style={{ top: zoneLabel(LOUD_DB, HOT_DB) }}>
            Loud
          </span>
          <span className="meter__zone" style={{ top: zoneLabel(NORMAL_DB, LOUD_DB) }}>
            Normal
          </span>
          <span className="meter__zone" style={{ top: zoneLabel(BOTTOM_DB, NORMAL_DB) }}>
            Low
          </span>
        </div>

        <div className="meter__pill">
          {/* Boundary rules, so the words beside them are pinned to something real. */}
          <span className="meter__rule" style={{ top: topPercent(HOT_DB) }} aria-hidden="true" />
          <span className="meter__rule" style={{ top: topPercent(LOUD_DB) }} aria-hidden="true" />
          <span className="meter__rule" style={{ top: topPercent(NORMAL_DB) }} aria-hidden="true" />

          <div className="meter__ladders">
            <Ladder innerRef={ladderL} label="Left channel" />
            <Ladder innerRef={ladderR} label="Right channel" />
          </div>

          {/* Peak hold — the line that says how close the loudest moment came to the top. */}
          <div ref={holdRef} className="meter__hold" data-zone="peak" aria-hidden="true" />
        </div>

        <div className="meter__ticks" aria-hidden="true">
          {TICKS.map(db => (
            <span key={db} className="meter__tick" style={{ top: topPercent(db) }}>
              {/* Typographic minus, matching the readout — a hyphen next to it looks like a
                  different character at this size, because it is. */}
              {db === 0 ? '0' : `−${Math.abs(db)}`}
            </span>
          ))}
        </div>
      </div>

      <div className="meter__foot">
        <p className="meter__readout">
          <span ref={readoutRef}>{formatDb(FLOOR_DB)}</span>
          <span className="meter__unit"> dB RMS</span>
        </p>
        <p className="hint meter__peakline">
          peak <span ref={peakRef}>{formatDb(FLOOR_DB)}</span> dB
        </p>

        {/* The text IS the accessible meter: a screen reader gets the reading, not the lights. */}
        <p className="meter__verdict" role="status">
          {verdict?.title ?? 'Listening…'}
        </p>
        <p className="hint meter__detail">
          {verdict?.detail ?? 'Play a few seconds to get a reading.'}
        </p>
      </div>
    </aside>
  );
}

function Ladder({
  innerRef,
  label,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>;
  label: string;
}) {
  return (
    <div className="ladder" ref={innerRef} aria-label={label}>
      {SEGMENT_ZONES.map((zone, i) => (
        // Bottom-up: the last child is the top of the ladder, which is why the column is
        // reversed in CSS rather than the array being reversed here.
        <span key={i} className="ladder__seg" data-zone={zone} />
      ))}
    </div>
  );
}

/** Light every segment at or below `db`. Writes `data-on` only where it changed. */
function light(ladder: HTMLDivElement | null, db: number): void {
  if (!ladder) return;
  const lit = db <= FLOOR_DB ? 0 : Math.round(fractionForDb(db) * SEGMENTS);
  const segs = ladder.children;
  for (let i = 0; i < segs.length; i++) {
    const on = i < lit;
    const el = segs[i] as HTMLElement;
    // Touching the DOM only on a change: assigning an unchanged attribute still costs a
    // style invalidation, and this runs 32 × 2 times a frame.
    if (on !== (el.dataset.on === '1')) el.dataset.on = on ? '1' : '0';
  }
}

export type { Levels };
