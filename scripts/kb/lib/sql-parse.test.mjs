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

/**
 * Drop replay.
 *
 * These pin the property every generated document depends on and none of them stated:
 * the parsers describe the schema as it is AFTER the last migration, not the union of
 * everything ever created. Two of the three were broken when written —
 * `parseTables` never replayed drops at all, and `parseFunctions` could not see the
 * `public.` prefix that most drops in this repository actually use, so a dropped
 * function stayed in the RPC reference and in the security review that reads it.
 */
import { parseTables, parseRls, parseFunctions } from './sql-parse.mjs';

const mig = (file, sql) => ({ file, sql });

test('a dropped table leaves the data model', () => {
  const tables = parseTables([
    mig('001_create.sql', 'create table public.waitlist (id uuid primary key, email text);'),
    mig('002_drop.sql', 'drop table if exists public.waitlist;'),
  ]);
  assert.equal(tables.has('waitlist'), false, 'a dropped table must not be documented as live');
});

test('a table recreated after a drop is live again', () => {
  const tables = parseTables([
    mig('001.sql', 'create table public.t (id uuid primary key);'),
    mig('002.sql', 'drop table public.t;'),
    mig('003.sql', 'create table public.t (id uuid primary key, extra text);'),
  ]);
  assert.equal(tables.has('t'), true, 'apply order decides, and the last word was CREATE');
});

test('dropping a table drops its policies without naming them', () => {
  // Postgres removes them with the table, so a migration has no reason to name them.
  const { policies, rlsEnabled } = parseRls([
    mig('001.sql', [
      'alter table public.waitlist enable row level security;',
      'create policy waitlist_insert_anon on public.waitlist for insert to anon with check (true);',
      'create policy keep_me on public.other for select to authenticated using (true);',
    ].join('\n')),
    mig('002.sql', 'drop table if exists public.waitlist;'),
  ]);
  assert.deepEqual(policies.map(p => p.name), ['keep_me'],
    'only the dropped table’s policies go');
  assert.equal(rlsEnabled.has('waitlist'), false);
});

test('a drop qualified with public. is seen — the prefix most migrations actually use', () => {
  const body = "$$ begin insert into t values (1); end $$";
  const fns = parseFunctions([
    mig('001.sql', `create function public.waitlist_request(p_email text) returns text language plpgsql as ${body};`),
    mig('002.sql', 'drop function if exists public.waitlist_request(p_email text);'),
  ]);
  assert.equal(fns.has('waitlist_request'), false,
    'the public. prefix must not hide the drop');
});

/**
 * Dates in the BODY that are as incidental as the one in the frontmatter.
 *
 * The knowledge map tabulates every document's `last_verified`, its own row included.
 * That row cannot be read off disk and be right — before the write, the file still holds
 * the previous run's value — so the generator renders it with the date this run will
 * stamp, and hands `writeGenerated` a way to ignore it when deciding whether anything
 * actually changed.
 *
 * Both halves matter and they pull against each other. Without the ignore, the document
 * rewrites itself every day and the "knowledge base" gate fails on every branch that has
 * not been rebased today — the twelve-day outage the tests above exist for. With the
 * ignore but without rendering today's date, the header says today and the row says
 * yesterday, and a SECOND run is needed to settle: that cost a red check on PR #223 and
 * a merge conflict on #224 before it was understood.
 */
const ignoreRowDates = text =>
  text.replace(/^\| `self\.md`.*$/gm, row => row.replace(/\d{4}-\d{2}-\d{2}/g, '-'));

const mapDoc = (headerDate, rowDate, body = 'docs: 73') =>
  ['---', 'tier: 1', `last_verified: ${headerDate}`, 'verify_every: 9999d', '---', '',
    `| \`self.md\` | chief-architect | DS, CA | ${rowDate} | 9999d |`, body].join('\n');

test('a body date the caller marks incidental does not force a write', () => {
  const p = join(scratch(), 'map.md');
  writeFileSync(p, mapDoc('2026-09-23', '2026-09-23'));

  const rewrote = writeGenerated(p, mapDoc('2026-09-24', '2026-09-24'), {
    alsoIgnoreDates: ignoreRowDates,
  });

  assert.equal(rewrote, false, 'only the two dates moved — nothing to write');
  assert.match(readFileSync(p, 'utf8'), /last_verified: 2026-09-23/);
});

test('the two dates stay in step, so one run is enough', () => {
  const p = join(scratch(), 'map.md');
  writeFileSync(p, mapDoc('2026-09-23', '2026-09-23', 'docs: 73'));

  // Real content change: the document count moved.
  writeGenerated(p, mapDoc('2026-09-24', '2026-09-24', 'docs: 74'), {
    alsoIgnoreDates: ignoreRowDates,
  });
  const afterOneRun = readFileSync(p, 'utf8');

  assert.match(afterOneRun, /last_verified: 2026-09-24/);
  assert.match(afterOneRun, /\| 2026-09-24 \| 9999d \|/,
    'the row must carry the date the header was stamped with, not the previous one');

  // Regenerating finds nothing left to do — the fixed point was reached in one pass.
  const again = writeGenerated(p, mapDoc('2026-09-24', '2026-09-24', 'docs: 74'), {
    alsoIgnoreDates: ignoreRowDates,
  });
  assert.equal(again, false, 'a second pass must be unnecessary');
});

test('without the option, behaviour is exactly as before', () => {
  const p = join(scratch(), 'doc.md');
  writeFileSync(p, doc('2026-08-19', 'tables: 40'));
  assert.equal(writeGenerated(p, doc('2026-09-01', 'tables: 40')), false);
  assert.equal(writeGenerated(p, doc('2026-09-01', 'tables: 41')), true);
});
