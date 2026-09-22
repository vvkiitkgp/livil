import { readFileSync } from 'fs';
import { join } from 'path';
import { COLORS } from '../../theme/colors';
import { SEAL_PATH } from '../badgeShapes';

/**
 * The public share page draws the badge marks from its OWN copy of the geometry.
 *
 * It has to: `web/api/share.ts` is a Vercel serverless function that renders HTML to a
 * string, and the mobile marks are `react-native-svg` elements. It also deliberately
 * imports nothing — a rarely-hit function is always cold, so every dependency is paid by
 * the first person to open a shared link.
 *
 * A copy that nothing checks is a copy that drifts. The failure would be quiet and
 * embarrassing rather than loud: someone redraws the star, the app shows the new mark, and
 * every link shared to WhatsApp keeps showing the old one — for as long as nobody happens
 * to open one on a laptop and compare.
 *
 * So this test reads both files as text and compares the strings. It is not testing
 * rendering; it is testing that two files agree.
 */

const SHARE_SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'web', 'api', 'share.ts'),
  'utf8',
);

/**
 * Pull a `const NAME = '...' + '...';` string constant out of TypeScript source and
 * reassemble it. Both files write these paths as concatenated lines to keep them readable,
 * so comparing raw source text would compare line breaks rather than geometry.
 */
function literal(source: string, name: string): string {
  const match = new RegExp(`const ${name}\\s*=\\s*([\\s\\S]*?);`).exec(source);
  if (!match) { throw new Error(`no const ${name} found`); }
  return (match[1]!.match(/'([^']*)'/g) ?? [])
    .map(part => part.slice(1, -1))
    .join('');
}

describe('share page badge parity', () => {
  it('draws the same seal as the app', () => {
    expect(literal(SHARE_SRC, 'SEAL_PATH')).toBe(SEAL_PATH);
  });

  it.each([
    ['STAR_PATH', join(__dirname, '..', 'FirstHundredBadge.tsx')],
    ['CHECK_PATH', join(__dirname, '..', 'VerifiedBadge.tsx')],
  ])('draws the same %s as the app', (name, mobilePath) => {
    expect(literal(SHARE_SRC, name)).toBe(literal(readFileSync(mobilePath, 'utf8'), name));
  });

  /**
   * The gradients are three stops each, and a share page that paints First 100 in a
   * near-but-not-quite gold reads as a counterfeit rather than as a bug.
   */
  it('paints the marks in the app palette', () => {
    for (const hex of [
      COLORS.goldLight, COLORS.gold, COLORS.goldDeep,
      COLORS.infoLight, COLORS.info, COLORS.infoDeep,
    ]) {
      expect(SHARE_SRC).toContain(hex);
    }
  });

  /**
   * Precedence, not alphabetical order. They happen to coincide today ('first_100' sorts
   * before 'verified'), which is exactly why this is worth asserting: the next badge kind
   * will not be so obliging, and the hierarchy is a product decision.
   */
  it('lists First 100 ahead of Verified', () => {
    const marks = SHARE_SRC.indexOf('const BADGE_MARKS');
    expect(marks).toBeGreaterThan(-1);
    const block = SHARE_SRC.slice(marks, SHARE_SRC.indexOf('];', marks));
    expect(block.indexOf("'first_100'")).toBeLessThan(block.indexOf("'verified'"));
  });
});
