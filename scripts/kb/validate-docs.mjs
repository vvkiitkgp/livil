#!/usr/bin/env node
/**
 * Knowledge base structural validator.
 *
 * Enforces kb/ai-org/knowledge-base-spec.md §8. Written in plain ESM with zero
 * dependencies and no build step so it runs on a clean checkout — the validator
 * must never be the reason a check is skipped.
 *
 * Usage:  npm run kb:validate
 * Exit:   0 = pass (warnings allowed) · 1 = at least one failure
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve as resolvePath } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');
const KB = join(REPO, 'kb');

// ── Spec constants ──────────────────────────────────────────────────────────
const VALID_TIERS = [1, 2, 3, 4, 5];
const VALID_OWNERS = [
  'principal-playback', 'principal-data', 'principal-client',
  'principal-security', 'principal-realtime', 'principal-platform',
  'chief-architect', 'human', 'generated',
];
const VALID_VISIBILITY = ['public', 'private-content'];
const VALID_VERIFIED_BY = ['manual', 'generated', 'ci-enforced'];
const REQUIRED_FIELDS = [
  'tier', 'owner', 'consumers', 'last_verified',
  'verify_every', 'verified_by', 'visibility',
];

/** Documents with an enforced maximum length (spec §7). */
const SIZE_CAPS = { 'INDEX.md': 200, 'architecture/overview.md': 200 };
/** A private-content stub must not restate what it points to. */
const STUB_MAX_LINES = 40;

const failures = [];
const warnings = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

// ── Helpers ─────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'private') continue; // never inspected; see rule 5
      walk(full, out);
    } else if (entry.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Minimal YAML frontmatter parser. Deliberately supports only the small subset
 * the spec defines (scalars and flat arrays) — a full YAML dependency would be
 * more surface than this needs.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    const value = raw.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      out[key] = inner ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')) : [];
    } else {
      out[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function daysSince(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

// ── Rule 5: nothing under kb/private/ may be tracked ─────────────────────────
function checkPrivateNotTracked() {
  let tracked = '';
  try {
    tracked = execSync('git ls-files kb/private', { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    warn('kb/private', 'could not run git ls-files; skipped tracked-file check');
    return;
  }
  if (tracked) {
    for (const f of tracked.split('\n')) {
      fail(f, 'PRIVATE CONTENT IS TRACKED IN A PUBLIC REPO — remove from git immediately');
    }
  }
}

// ── Rule 3: every doc reachable from INDEX.md ────────────────────────────────
function linkedFromIndex() {
  const indexPath = join(KB, 'INDEX.md');
  if (!existsSync(indexPath)) {
    fail('kb/INDEX.md', 'missing — required as the knowledge base entry point');
    return new Set();
  }
  const body = readFileSync(indexPath, 'utf8');
  const links = new Set();
  for (const m of body.matchAll(/\]\(([^)#]+)\)/g)) {
    const target = m[1].trim();
    if (/^(https?:|mailto:)/.test(target)) continue;
    links.add(relative(KB, resolvePath(KB, target)));
  }
  return links;
}

// ── Rule 8: internal links resolve ───────────────────────────────────────────
function checkLinks(file, rel, body) {
  for (const m of body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    const target = m[1].trim();
    if (/^(https?:|mailto:)/.test(target)) continue;
    const abs = resolvePath(dirname(file), target);
    if (existsSync(abs)) continue;
    // Planned documents are routed before they exist; that is expected.
    warn(rel, `link target not found (planned?): ${target}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
if (!existsSync(KB)) {
  console.error('FAIL  kb/ does not exist');
  process.exit(1);
}

checkPrivateNotTracked();

const indexLinks = linkedFromIndex();
const files = walk(KB);

for (const file of files) {
  const rel = relative(REPO, file);
  const kbRel = relative(KB, file);
  const body = readFileSync(file, 'utf8');
  const lines = body.split('\n').length;

  // Rule 1 — frontmatter present and parseable
  const fm = parseFrontmatter(body);
  if (!fm) {
    fail(rel, 'missing or malformed YAML frontmatter');
    continue;
  }

  // Rule 1 — required fields
  for (const field of REQUIRED_FIELDS) {
    if (fm[field] === undefined) fail(rel, `frontmatter missing required field: ${field}`);
  }

  // Rule 2 — enum validity
  const tier = Number(fm.tier);
  if (!VALID_TIERS.includes(tier)) fail(rel, `invalid tier: ${fm.tier} (expected 1-5)`);
  if (fm.owner && !VALID_OWNERS.includes(fm.owner)) {
    fail(rel, `invalid owner: ${fm.owner} (expected one of ${VALID_OWNERS.join(', ')})`);
  }
  if (fm.visibility && !VALID_VISIBILITY.includes(fm.visibility)) {
    fail(rel, `invalid visibility: ${fm.visibility}`);
  }
  if (fm.verified_by && !VALID_VERIFIED_BY.includes(fm.verified_by)) {
    fail(rel, `invalid verified_by: ${fm.verified_by}`);
  }

  // Rule 3 — reachability (INDEX.md is the root and need not link itself)
  if (kbRel !== 'INDEX.md') {
    const reachable = [...indexLinks].some(
      l => l === kbRel || kbRel.startsWith(l.replace(/\/$/, '') + '/'),
    );
    if (!reachable) fail(rel, 'orphaned — not reachable from kb/INDEX.md');
  }

  // Rule 4 — size caps
  const cap = SIZE_CAPS[kbRel];
  if (cap && lines > cap) {
    fail(rel, `exceeds hard cap: ${lines} lines > ${cap}. Move detail into a domain document.`);
  }

  // Rule 6 — private-content docs are stubs
  if (fm.visibility === 'private-content' && lines > STUB_MAX_LINES) {
    fail(rel, `private-content stub too long (${lines} lines > ${STUB_MAX_LINES}) — it may be restating sensitive content`);
  }

  // Rule 7 — staleness (warning only)
  const age = daysSince(fm.last_verified);
  const window = parseInt(String(fm.verify_every), 10);
  if (age === null) {
    fail(rel, `unparseable last_verified: ${fm.last_verified}`);
  } else if (!Number.isNaN(window) && age > window) {
    warn(rel, `stale: verified ${age}d ago, SLA is ${window}d`);
  }

  // Rule 8 — links
  checkLinks(file, rel, body);
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nKnowledge base: ${files.length} document(s) checked\n`);

for (const w of warnings) console.log(`  WARN  ${w}`);
if (warnings.length) console.log('');

if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error(`\n${failures.length} failure(s), ${warnings.length} warning(s)\n`);
  process.exit(1);
}

console.log(`PASS  0 failures, ${warnings.length} warning(s)\n`);
