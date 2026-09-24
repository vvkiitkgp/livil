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
