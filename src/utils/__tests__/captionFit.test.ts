import {
  MAX_FIT_TRIES,
  MEASURE_FIT,
  SEE_MORE_ELLIPSIS,
  SEE_MORE_LABEL,
  SEE_MORE_LENGTH,
  __resetCaptionExpansionForTest,
  advanceFit,
  captionPieces,
  firstCut,
  forgetCaptionExpanded,
  isCaptionExpanded,
  nextCut,
  piecesUpTo,
  rememberCaptionExpanded,
  sameFit,
  tidyCut,
  type CaptionFit,
  type MeasuredLine,
} from '../captionFit';

/**
 * A stand-in for the phone's text layout: every character 7pt wide, a box `cols` characters
 * wide, breaking at "\n" and otherwise at the last space that fits (or mid-word when a word is
 * longer than the line). "… See more" glued to the word before it never breaks.
 * Line lengths include the trailing space / "\n", as both platforms report them.
 */
const CHAR = 7;
function layout(text: string, cols: number): MeasuredLine[] {
  const lines: MeasuredLine[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    const hardEnd = nl === -1 ? text.length : nl;
    if (hardEnd - start <= cols) {
      const end = nl === -1 ? text.length : nl + 1;
      lines.push({ length: end - start, width: (hardEnd - start) * CHAR });
      start = end;
      continue;
    }
    const space = text.lastIndexOf(' ', start + cols);
    const end = space > start ? space + 1 : start + cols;
    const visible = text.slice(start, end).replace(/ +$/, '').length;
    lines.push({ length: end - start, width: visible * CHAR });
    start = end;
  }
  return lines;
}
const boxOf = (cols: number) => cols * CHAR;
const suffix = SEE_MORE_ELLIPSIS + SEE_MORE_LABEL;

/** Run the measure → check loop to the end, as MentionText does with real layouts. */
function settle(text: string, cols: number, maxLines = 4): { fit: CaptionFit; passes: number } {
  let fit: CaptionFit = MEASURE_FIT;
  let passes = 0;
  while (fit.phase === 'measure' || fit.phase === 'check') {
    const shown = fit.phase === 'check' ? text.slice(0, fit.cut) + suffix : text;
    fit = advanceFit(fit, text, layout(shown, cols), maxLines, boxOf(cols));
    passes++;
    if (passes > MAX_FIT_TRIES + 2) { throw new Error('did not settle'); }
  }
  return { fit, passes };
}

const words = (n: number) =>
  Array.from({ length: n }, (_, i) => ['late', 'night', 'drive', 'with', 'the', 'windows', 'down'][i % 7]).join(' ');

describe('captionPieces / piecesUpTo', () => {
  it('keeps every character, and a cut-short tag still opens the whole username', () => {
    const pieces = captionPieces('for @riya_s and @sam!');
    expect(pieces.map(p => p.text).join('')).toBe('for @riya_s and @sam!');
    const cut = piecesUpTo(pieces, 7); // "for @ri"
    expect(cut.map(p => p.text).join('')).toBe('for @ri');
    expect(cut[1]).toEqual({ kind: 'mention', text: '@ri', username: 'riya_s' });
  });

  it('a cut at a piece boundary takes whole pieces, and past the end takes them all', () => {
    const pieces = captionPieces('hi @sam ok');
    expect(piecesUpTo(pieces, 3)).toEqual([{ kind: 'text', text: 'hi ' }]);
    expect(piecesUpTo(pieces, 999)).toEqual(pieces);
    expect(piecesUpTo(pieces, 0)).toEqual([]);
  });
});

describe('tidyCut', () => {
  it('never ends on spaces, half an emoji or a dangling emoji joiner', () => {
    expect(tidyCut('one two   three', 10)).toBe(7);
    const heart = 'love 💜 you'; // 💜 is a surrogate pair at 5–6
    expect(tidyCut(heart, 6)).toBe(4); // would split 💜 → back off, then drop the space
    expect(tidyCut(heart, 7)).toBe(7); // whole 💜 kept
    expect(tidyCut('a👨‍👩', 4)).toBe(3); // ends after the joiner
  });

  it('keeps line breaks, so a blank last line still holds "… See more"', () => {
    expect(tidyCut('para one\n\n', 10)).toBe(10);
    expect(tidyCut('abc', 99)).toBe(3);
    expect(tidyCut('abc', -4)).toBe(0);
  });
});

describe('firstCut', () => {
  it('null when the caption fits — nothing to collapse', () => {
    expect(firstCut('short', layout('short', 40), 4, boxOf(40))).toBeNull();
    const four = 'a\nb\nc\nd';
    expect(firstCut(four, layout(four, 40), 4, boxOf(40))).toBeNull();
  });

  it('a short last line keeps every word: the suffix has room after it', () => {
    const text = 'one\ntwo\nthree\nfour\nfive';
    const cut = firstCut(text, layout(text, 40), 4, boxOf(40))!;
    expect(text.slice(0, cut)).toBe('one\ntwo\nthree\nfour');
  });

  it('a full last line drops just enough for the suffix', () => {
    const text = words(60);
    const lines = layout(text, 40);
    const cut = firstCut(text, lines, 4, boxOf(40))!;
    const endOfFour = lines.slice(0, 4).reduce((n, l) => n + l.length, 0);
    expect(cut).toBeLessThan(endOfFour);
    // Dropped about the suffix's width, not a whole line.
    expect(endOfFour - cut).toBeLessThanOrEqual(SEE_MORE_LENGTH + 8);
    expect(layout(text.slice(0, cut) + suffix, 40).length).toBeLessThanOrEqual(4);
  });

  it('a blank 4th line: "… See more" sits on it, so the height is still 4 lines', () => {
    const text = 'para one\npara two\npara three\n\npara five';
    const cut = firstCut(text, layout(text, 40), 4, boxOf(40))!;
    expect(text.slice(0, cut)).toBe('para one\npara two\npara three\n');
    expect(layout(text.slice(0, cut) + suffix, 40)).toHaveLength(4);
  });

  it('without the box width, the widest line stands in for it', () => {
    const text = words(60);
    expect(firstCut(text, layout(text, 40), 4, 0)).not.toBeNull();
  });
});

describe('nextCut', () => {
  it('fits when within the lines; otherwise 3, 6, 12 … characters shorter', () => {
    const text = 'x'.repeat(200);
    expect(nextCut(text, 100, [{ length: 50, width: 1 }], 4, 0)).toBe('fits');
    const five = Array.from({ length: 5 }, () => ({ length: 20, width: 1 }));
    expect(nextCut(text, 100, five, 4, 0)).toBe(97);
    expect(nextCut(text, 100, five, 4, 1)).toBe(94);
    expect(nextCut(text, 100, five, 4, 2)).toBe(88);
  });

  it('always ends: after MAX_FIT_TRIES, or at nothing left to cut', () => {
    const five = Array.from({ length: 5 }, () => ({ length: 20, width: 1 }));
    expect(nextCut('x'.repeat(200), 100, five, 4, MAX_FIT_TRIES)).toBe('fits');
    expect(nextCut('x'.repeat(200), 0, five, 4, 0)).toBe('fits');
  });
});

describe('advanceFit — the whole measure → check loop', () => {
  it.each([
    ['a phone-width box', 40],
    ['a small phone at a large text size', 18],
    ['a very large text size', 9],
  ])('a 2,000-character caption collapses to exactly 4 lines on %s', (_label, cols) => {
    const text = words(400).slice(0, 2000);
    const { fit } = settle(text, cols);
    expect(fit.phase).toBe('cut');
    if (fit.phase !== 'cut') { return; }
    const collapsed = layout(text.slice(0, fit.cut) + suffix, cols);
    expect(collapsed).toHaveLength(4);
    expect(fit.cut).toBeGreaterThan(0);
  });

  it('settles in a pass or two when the estimate is good', () => {
    const { passes } = settle(words(60), 40);
    expect(passes).toBeLessThanOrEqual(3);
  });

  it('a caption that fits is left whole', () => {
    expect(settle('this one is for @riya', 40).fit).toEqual({ phase: 'whole' });
  });

  it('long unbroken text (a link) still collapses', () => {
    const text = `listen here https://example.com/${'a'.repeat(300)}`;
    const { fit } = settle(text, 30);
    expect(fit.phase).toBe('cut');
  });

  it('whole and cut are final', () => {
    expect(advanceFit({ phase: 'whole' }, 'x', [], 4, 0)).toEqual({ phase: 'whole' });
    expect(advanceFit({ phase: 'cut', cut: 3 }, 'x', [], 4, 0)).toEqual({ phase: 'cut', cut: 3 });
  });

  it('sameFit compares phase and position', () => {
    expect(sameFit(MEASURE_FIT, { phase: 'measure' })).toBe(true);
    expect(sameFit({ phase: 'check', cut: 3, tries: 0 }, { phase: 'check', cut: 3, tries: 1 })).toBe(false);
    expect(sameFit({ phase: 'cut', cut: 3 }, { phase: 'cut', cut: 4 })).toBe(false);
    expect(sameFit({ phase: 'whole' }, { phase: 'cut', cut: 4 })).toBe(false);
  });
});

describe('remembered expansion', () => {
  beforeEach(() => __resetCaptionExpansionForTest());

  it('remembers by post id, and nothing without one', () => {
    expect(isCaptionExpanded('p1')).toBe(false);
    rememberCaptionExpanded('p1');
    expect(isCaptionExpanded('p1')).toBe(true);
    expect(isCaptionExpanded('p2')).toBe(false);
    rememberCaptionExpanded(undefined);
    expect(isCaptionExpanded(undefined)).toBe(false);
  });

  it('forgets a post closed with "See less", and only that post', () => {
    rememberCaptionExpanded('p1');
    rememberCaptionExpanded('p2');
    forgetCaptionExpanded('p1');
    forgetCaptionExpanded(undefined);
    expect(isCaptionExpanded('p1')).toBe(false);
    expect(isCaptionExpanded('p2')).toBe(true);
  });

  it('is bounded: the oldest is forgotten first', () => {
    for (let i = 0; i <= 500; i++) { rememberCaptionExpanded(`p${i}`); }
    expect(isCaptionExpanded('p0')).toBe(false);
    expect(isCaptionExpanded('p1')).toBe(true);
    expect(isCaptionExpanded('p500')).toBe(true);
  });
});
