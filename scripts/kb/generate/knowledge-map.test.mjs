/**
 * The knowledge map's self-reference.
 *
 * This document is one of the documents it tabulates, which makes its own row the one
 * value it cannot read off disk and be right about: before the write, the file still
 * holds the previous run's date while the frontmatter is about to be stamped with
 * today's. Left alone, one run produced a file whose header said today and whose own
 * row said yesterday, and only a SECOND run squared them up — so `kb:generate --check`
 * failed against anything generated in a single pass. That cost a red check on PR #223
 * and a merge conflict on #224; the sibling branch passed only because its generation
 * happened to be run twice while something else was being verified.
 *
 * Two halves, pulling against each other, and both are needed:
 *   markSelfVerified    — render the row with the date this run WILL stamp
 *   blankSelfRowDates   — but do not let that row, by itself, force a write
 *
 * Drop the first and the dates disagree for a run. Drop the second and the document
 * rewrites itself daily, which is the twelve-day CI outage `writeGenerated` exists for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { markSelfVerified, blankSelfRowDates } from './knowledge-map.mjs';

const SELF = 'ai-org/knowledge-map.md';
const docs = () => [
  { path: SELF, last_verified: '2026-09-23', age: 1, stale: false },
  { path: 'architecture/inventory.md', last_verified: '2026-09-23', age: 1, stale: false },
  { path: 'debt/register.md', last_verified: '2026-07-21', age: 65, stale: true },
];

test('the self row reports the date this run will stamp', () => {
  const [self] = markSelfVerified(docs(), '2026-09-24');
  assert.equal(self.last_verified, '2026-09-24');
  assert.equal(self.age, 0);
  assert.equal(self.stale, false);
});

test('every other document still reports its own frontmatter', () => {
  const [, inventory, debt] = markSelfVerified(docs(), '2026-09-24');
  assert.equal(inventory.last_verified, '2026-09-23',
    'a sibling doc must not be claimed as verified today');
  assert.equal(debt.last_verified, '2026-07-21');
  assert.equal(debt.stale, true, 'and a stale doc must stay stale');
});

test('blanking hits this document’s row and no other', () => {
  const table = [
    '| `ai-org/knowledge-map.md` | chief-architect | DS, CA | 2026-09-24 | 9999d |',
    // Same date, different document — must survive untouched, or a real change to a
    // sibling's freshness would stop triggering a regeneration.
    '| `architecture/inventory.md` | principal-client | ALL | 2026-09-24 | 9999d |',
  ].join('\n');

  const blanked = blankSelfRowDates(table).split('\n');
  assert.equal(blanked[0], '| `ai-org/knowledge-map.md` | chief-architect | DS, CA | - | 9999d |');
  assert.equal(blanked[1], '| `architecture/inventory.md` | principal-client | ALL | 2026-09-24 | 9999d |');
});

test('a knowledge map generated yesterday and today differ only where it matters', () => {
  const row = d => `| \`${SELF}\` | chief-architect | DS, CA | ${d} | 9999d |`;
  assert.equal(blankSelfRowDates(row('2026-09-23')), blankSelfRowDates(row('2026-09-24')),
    'the date alone must not read as a content change');
});
