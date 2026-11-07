import { parseMentions } from './mentions';

/**
 * The feed card's "… See more" (owner, 2026-11-02): a caption longer than the card's 4 lines
 * shows its first lines with "… See more" at the end of the last one, and a tap opens the
 * whole caption in place. Before this the card simply stopped at line 4 (captions run to
 * 2,000 characters) and nothing anywhere showed the rest.
 *
 * Where the text has to stop depends on the phone's width and text size, so it is MEASURED,
 * not guessed: MentionText lays the caption out once, invisibly and without a line limit,
 * and reads the lines back from `onTextLayout`. The pure steps of that live here:
 *
 *  1. `firstCut` — from the full caption's lines, where to stop so "… See more" fits on the
 *     last visible line. Stops at a line's own end when there is room (a short last line keeps
 *     every word) and otherwise drops just enough characters, by the width the line measured.
 *  2. `nextCut` — the cut is then CHECKED by laying out the shortened text plus the suffix the
 *     same invisible way. If it still runs onto another line, drop a few more and check again
 *     (3, 6, 12 … characters), at most MAX_FIT_TRIES times.
 *
 * The collapsed caption is always exactly the same number of lines as the plain line-limited
 * text it replaces, so swapping one for the other never changes the card's height and the
 * feed does not jump.
 */

/** "…", then "See more" held together with no-break spaces so it never splits over a line. */
export const SEE_MORE_ELLIPSIS = '… ';
export const SEE_MORE_LABEL = 'See more';
export const SEE_MORE_LENGTH = SEE_MORE_ELLIPSIS.length + SEE_MORE_LABEL.length;
/** Ends an opened caption; the only part of it that closes it again (MentionText). */
export const SEE_LESS_LABEL = 'See less';

/** Checking passes allowed before the last cut is taken as it is (see `nextCut`). */
export const MAX_FIT_TRIES = 6;

/** What MentionText keeps from each `onTextLayout` line: how many characters, how wide. */
export type MeasuredLine = { length: number; width: number };

/**
 * A run of the caption as shown. A mention keeps its FULL username even when `text` has been
 * cut short, so a tag cut to "@ri" at the end of a collapsed caption still opens @riya.
 */
export type CaptionPiece =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; username: string };

export function captionPieces(caption: string): CaptionPiece[] {
  return parseMentions(caption).map(c =>
    c.type === 'text'
      ? { kind: 'text', text: c.value }
      : { kind: 'mention', text: `@${c.value}`, username: c.value },
  );
}

/** The pieces covering the first `end` characters of the caption. */
export function piecesUpTo(pieces: CaptionPiece[], end: number): CaptionPiece[] {
  const out: CaptionPiece[] = [];
  let at = 0;
  for (const p of pieces) {
    if (at >= end) { break; }
    const take = Math.min(p.text.length, end - at);
    out.push(take === p.text.length ? p : { ...p, text: p.text.slice(0, take) });
    at += take;
  }
  return out;
}

const isHorizontalSpace = (ch: string | undefined) =>
  ch === ' ' || ch === '\t' || ch === '\r' || ch === ' ';

/**
 * Move `cut` back so the collapsed text never ends in half an emoji, a dangling emoji joiner,
 * or spaces (which would put a gap before "…"). Line breaks are kept: a caption whose 4th line
 * is blank shows "… See more" on that blank line, so it is still 4 lines tall.
 */
export function tidyCut(text: string, cut: number): number {
  let i = Math.max(0, Math.min(Math.floor(cut), text.length));
  for (;;) {
    const code = text.charCodeAt(i - 1);
    if (i > 0 && code >= 0xd800 && code <= 0xdbff) { i--; continue; } // high surrogate
    if (i > 0 && text[i - 1] === '‍') { i--; continue; } // zero-width joiner
    if (i > 0 && isHorizontalSpace(text[i - 1])) { i--; continue; }
    return i;
  }
}

const sumLengths = (lines: MeasuredLine[], from: number, to: number) =>
  lines.slice(from, to).reduce((n, l) => n + l.length, 0);

/**
 * The full caption measured into `lines`. Returns null when it fits in `maxLines` (nothing to
 * collapse), else where to stop the text so "… See more" can follow on line `maxLines`.
 *
 * `boxWidth` is the width the caption is laid out in (0 when not known yet — then the widest
 * measured line stands in for it, which is never wider than the box).
 */
export function firstCut(
  text: string,
  lines: MeasuredLine[],
  maxLines: number,
  boxWidth: number,
): number | null {
  if (maxLines < 1 || lines.length <= maxLines) { return null; }
  const lastStart = sumLengths(lines, 0, maxLines - 1);
  let cut = lastStart + lines[maxLines - 1]!.length;
  // The last visible line's own line break would push the suffix onto the next line.
  if (text[cut - 1] === '\n') { cut--; }
  cut = Math.max(lastStart, tidyCut(text, cut));

  const shown = cut - lastStart;
  const lastWidth = lines[maxLines - 1]!.width;
  if (shown <= 0 || !(lastWidth > 0)) { return cut; }
  const charWidth = lastWidth / shown;
  const width = boxWidth > 0 ? boxWidth : Math.max(...lines.map(l => l.width));
  // The suffix is a little heavier than body text ("See more" is semibold): 10% headroom.
  const suffixWidth = SEE_MORE_LENGTH * charWidth * 1.1;
  const free = width - lastWidth;
  if (free >= suffixWidth) { return cut; }
  const drop = Math.ceil((suffixWidth - free) / charWidth);
  return Math.max(lastStart, tidyCut(text, cut - drop));
}

/**
 * The text cut at `cut` plus the suffix, measured into `lines`. 'fits' when it stays within
 * `maxLines`; otherwise a shorter cut to check next (3, 6, 12 … characters shorter for tries
 * 0, 1, 2 …). Returns 'fits' once `tries` reaches MAX_FIT_TRIES, so the checking always ends —
 * the caller keeps `numberOfLines` on the visible text, and a tap anywhere on it expands, so
 * even an unlucky cut can never hide the rest of the caption.
 */
export function nextCut(
  text: string,
  cut: number,
  lines: MeasuredLine[],
  maxLines: number,
  tries: number,
): number | 'fits' {
  if (lines.length <= maxLines || tries >= MAX_FIT_TRIES || cut <= 0) { return 'fits'; }
  return tidyCut(text, cut - 3 * 2 ** tries);
}

/**
 * Where MentionText is in fitting a collapsed caption:
 *  - measure: laying out the whole caption (invisibly) to count its lines;
 *  - check:   laying out text[0, cut) + "… See more" to confirm it fits;
 *  - whole:   the caption fits as it is — no "See more", nothing to tap;
 *  - cut:     done — show text[0, cut) + "… See more".
 * Until it reaches whole/cut the visible caption is the plain line-limited text, the same
 * height either way.
 */
export type CaptionFit =
  | { phase: 'measure' }
  | { phase: 'check'; cut: number; tries: number }
  | { phase: 'whole' }
  | { phase: 'cut'; cut: number };

export const MEASURE_FIT: CaptionFit = { phase: 'measure' };

/** The next fit, given the lines the invisible layout of `fit` measured. */
export function advanceFit(
  fit: CaptionFit,
  text: string,
  lines: MeasuredLine[],
  maxLines: number,
  boxWidth: number,
): CaptionFit {
  if (fit.phase === 'measure') {
    const cut = firstCut(text, lines, maxLines, boxWidth);
    return cut === null ? { phase: 'whole' } : { phase: 'check', cut, tries: 0 };
  }
  if (fit.phase === 'check') {
    const next = nextCut(text, fit.cut, lines, maxLines, fit.tries);
    return next === 'fits'
      ? { phase: 'cut', cut: fit.cut }
      : { phase: 'check', cut: next, tries: fit.tries + 1 };
  }
  return fit;
}

export function sameFit(a: CaptionFit, b: CaptionFit): boolean {
  if (a.phase !== b.phase) { return false; }
  if (a.phase === 'check' && b.phase === 'check') { return a.cut === b.cut && a.tries === b.tries; }
  if (a.phase === 'cut' && b.phase === 'cut') { return a.cut === b.cut; }
  return true;
}

// ── Remembered expansion ────────────────────────────────────────────────────────────────
//
// A FlatList unmounts cards far off screen and mounts them again on the way back. If an
// opened caption came back collapsed, the card above the viewport would shrink and the feed
// would jump under the reader's thumb. So "this caption is open" is kept per post, here,
// for the app session — and a post opened in the feed is also open on a profile.

const MAX_REMEMBERED = 500;
const expanded = new Set<string>();

export function isCaptionExpanded(id: string | undefined): boolean {
  return id ? expanded.has(id) : false;
}

export function rememberCaptionExpanded(id: string | undefined): void {
  if (!id || expanded.has(id)) { return; }
  expanded.add(id);
  if (expanded.size > MAX_REMEMBERED) {
    // A Set iterates in insertion order: forget the oldest.
    const oldest = expanded.values().next().value;
    if (oldest !== undefined) { expanded.delete(oldest); }
  }
}

/** "See less": the caption stays closed when the list mounts its card again. */
export function forgetCaptionExpanded(id: string | undefined): void {
  if (id) { expanded.delete(id); }
}

export function __resetCaptionExpansionForTest(): void {
  expanded.clear();
}
