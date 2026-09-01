/**
 * Tests for writeGenerated.
 *
 * These exist because the behaviour they pin cost twelve days of merges. `frontmatter()`
 * stamps today's date into every generated document, and CI regenerates and diffs. So a
 * document written on one day no longer matched itself on the next, and the "knowledge
 * base" gate failed on every open pull request for a reason none of them had caused.
 *
 * The property that matters is narrow and easy to regress: the date line moves only when
 * something ELSE in the document moves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeGenerated } from './sql-parse.mjs';

const doc = (verified, body) =>
  ['---', 'tier: 1', `last_verified: ${verified}`, 'verify_every: 9999d', '---', '', body].join('\n');

const scratch = () => mkdtempSync(join(tmpdir(), 'kb-writegen-'));

test('a document unchanged but for its date is left alone', () => {
  const p = join(scratch(), 'doc.md');
  writeFileSync(p, doc('2026-08-19', 'tables: 40'));

  const rewrote = writeGenerated(p, doc('2026-09-01', 'tables: 40'));

  assert.equal(rewrote, false, 'should report no write');
  assert.match(readFileSync(p, 'utf8'), /last_verified: 2026-08-19/,
    'the recorded date must survive — this is the whole point');
});

test('a real content change moves both the content and the date', () => {
  const p = join(scratch(), 'doc.md');
  writeFileSync(p, doc('2026-08-19', 'tables: 40'));

  const rewrote = writeGenerated(p, doc('2026-09-01', 'tables: 41'));

  assert.equal(rewrote, true);
  const after = readFileSync(p, 'utf8');
  assert.match(after, /last_verified: 2026-09-01/);
  assert.match(after, /tables: 41/);
});

test('a document that does not exist yet is written', () => {
  const p = join(scratch(), 'new.md');
  assert.equal(existsSync(p), false);

  assert.equal(writeGenerated(p, doc('2026-09-01', 'tables: 40')), true);
  assert.match(readFileSync(p, 'utf8'), /tables: 40/);
});

test('regenerating twice on different days is stable', () => {
  const p = join(scratch(), 'doc.md');
  writeGenerated(p, doc('2026-08-19', 'tables: 40'));
  const day1 = readFileSync(p, 'utf8');

  writeGenerated(p, doc('2026-09-01', 'tables: 40'));
  writeGenerated(p, doc('2026-09-14', 'tables: 40'));

  assert.equal(readFileSync(p, 'utf8'), day1, 'the file must not drift with the calendar');
});
