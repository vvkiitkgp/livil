/**
 * Generates the knowledge map: every document, its tier, owner, freshness, and consumers.
 *
 * Makes the knowledge base self-auditing — doc-steward reads this rather than crawling.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontmatter, GENERATED_WARNING, writeGenerated } from '../lib/sql-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const KB = join(REPO, 'kb');
const OUT = join(KB, 'ai-org/knowledge-map.md');

/** This document's own row in its own tables. See the two notes in generate(). */
const SELF = relative(KB, OUT);
const SELF_ROW = new RegExp(
  `^\\| \`${SELF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`.*$`, 'gm',
);
/**
 * Blank the dates on this document's own row, wherever it appears.
 *
 * Exported for tests. The self-reference is the part worth pinning: it has to hit this
 * document's row and no other, including rows that happen to carry the same date.
 */
export const blankSelfRowDates = text =>
  text.replace(SELF_ROW, row => row.replace(/\d{4}-\d{2}-\d{2}/g, '-'));

/**
 * Record this document as verified on `today`, because it is about to be.
 *
 * Exported for tests. Mutates in place — `docs` is the freshly-read list and nothing
 * else holds it. Only the self row moves; every other document reports what its own
 * frontmatter says.
 */
export function markSelfVerified(docs, today) {
  for (const d of docs) {
    if (d.path !== SELF) continue;
    d.last_verified = today;
    d.age = 0;
    d.stale = false;
  }
  return docs;
}

const TIER_NAME = {
  1: 'Generated', 2: 'Enforced', 3: 'Curated', 4: 'Append-only', 5: 'Narrative',
};

export function generate() {
  const docs = collect(KB).map(readDoc).filter(Boolean);

  // This document is one of the documents it tabulates, and it cannot read its own
  // freshness off disk and be right: at this point the file still holds the PREVIOUS
  // run's date, while the frontmatter below is about to be stamped with today's. Left
  // alone, one run wrote a file whose header said today and whose own row said
  // yesterday, and a SECOND run was needed to square them up — so `kb:generate --check`
  // failed against anything generated in a single pass.
  //
  // Use the date this run will stamp. When nothing else in the document changed,
  // writeGenerated skips the file entirely and both dates stay at the old value
  // together; that is what `blankSelfRowDates` below buys, and it is why this row can
  // claim today without forcing a daily rewrite.
  markSelfVerified(docs, new Date().toISOString().slice(0, 10));

  const byTier = new Map();
  for (const d of docs) {
    if (!byTier.has(d.tier)) byTier.set(d.tier, []);
    byTier.get(d.tier).push(d);
  }

  const stale = docs.filter(d => d.stale);
  const privateStubs = docs.filter(d => d.visibility === 'private-content');

  const L = [];
  L.push(frontmatter({
    tier: 1, owner: 'chief-architect', consumers: ['DS', 'CA'], visibility: 'public',
  }));
  L.push('# Knowledge Map\n');
  L.push(GENERATED_WARNING + '\n');
  L.push(`${docs.length} document(s) under \`kb/\`.\n`);

  L.push('## Health\n');
  L.push('| Metric | Count |');
  L.push('|---|---:|');
  L.push(`| Documents | ${docs.length} |`);
  L.push(`| Drift-proof (tier 1 + 4) | ${docs.filter(d => d.tier === 1 || d.tier === 4).length} |`);
  L.push(`| Hand-maintained (tier 3 + 5) | ${docs.filter(d => d.tier === 3 || d.tier === 5).length} |`);
  L.push(`| Past freshness SLA | ${stale.length} |`);
  L.push(`| Private-content stubs | ${privateStubs.length} |`);
  L.push('');
  L.push(
    'Tiers 1 and 4 cannot drift by construction — the first is regenerated, the second is never\n' +
    'edited. Historical documentation drift in this project occurred entirely in hand-maintained\n' +
    'content, so the hand-maintained count is the number worth keeping small.\n',
  );

  if (stale.length) {
    L.push('## Past freshness SLA\n');
    L.push('| Document | Owner | Last verified | SLA |');
    L.push('|---|---|---|---|');
    for (const d of stale) {
      L.push(`| \`${d.path}\` | ${d.owner} | ${d.last_verified} | ${d.verify_every} |`);
    }
    L.push('');
  }

  for (const tier of [...byTier.keys()].sort()) {
    L.push(`## Tier ${tier} — ${TIER_NAME[tier] ?? 'unknown'}\n`);
    L.push('| Document | Owner | Consumers | Verified | SLA |');
    L.push('|---|---|---|---|---|');
    for (const d of byTier.get(tier).sort((a, b) => a.path.localeCompare(b.path))) {
      const flag = d.stale ? ' ⚠️' : '';
      const priv = d.visibility === 'private-content' ? ' 🔒' : '';
      L.push(`| \`${d.path}\`${priv}${flag} | ${d.owner} | ${d.consumers} | ${d.last_verified} | ${d.verify_every} |`);
    }
    L.push('');
  }

  L.push('## Ownership\n');
  const byOwner = new Map();
  for (const d of docs) {
    if (!byOwner.has(d.owner)) byOwner.set(d.owner, []);
    byOwner.get(d.owner).push(d.path);
  }
  L.push('| Owner | Documents |');
  L.push('|---|---:|');
  for (const [owner, list] of [...byOwner].sort()) L.push(`| ${owner} | ${list.length} |`);
  L.push('');
  L.push('Every document has exactly one accountable owner — a surface nobody owns will decay\n' +
    '(Constitution P48).\n');

  // The self row's date is as incidental as the frontmatter's — exempt it from the
  // "did anything change?" comparison, or this document rewrites itself every day and
  // the knowledge-base gate fails on every branch that has not been rebased today.
  writeGenerated(OUT, L.join('\n'), { alsoIgnoreDates: blankSelfRowDates });

  return { doc: 'knowledge-map', docs: docs.length, stale: stale.length };
}

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e === 'private') continue;
      collect(full, out);
    } else if (e.endsWith('.md')) out.push(full);
  }
  return out;
}

function readDoc(file) {
  const text = readFileSync(file, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;

  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }

  const age = Math.floor((Date.now() - Date.parse(fm.last_verified)) / 86_400_000);
  const window = parseInt(fm.verify_every, 10);

  return {
    path: relative(KB, file),
    tier: Number(fm.tier),
    owner: fm.owner ?? '—',
    consumers: (fm.consumers ?? '').replace(/[[\]]/g, '') || '—',
    last_verified: fm.last_verified ?? '—',
    verify_every: fm.verify_every ?? '—',
    visibility: fm.visibility ?? 'public',
    age,
    stale: Number.isFinite(age) && !Number.isNaN(window) && age > window,
  };
}
