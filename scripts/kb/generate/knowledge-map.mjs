/**
 * Generates the knowledge map: every document, its tier, owner, freshness, and consumers.
 *
 * Makes the knowledge base self-auditing — doc-steward reads this rather than crawling.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontmatter, GENERATED_WARNING } from '../lib/sql-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const KB = join(REPO, 'kb');
const OUT = join(KB, 'ai-org/knowledge-map.md');

const TIER_NAME = {
  1: 'Generated', 2: 'Enforced', 3: 'Curated', 4: 'Append-only', 5: 'Narrative',
};

export function generate() {
  const docs = collect(KB).map(readDoc).filter(Boolean);

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
    L.push('| Document | Owner | Last verified | SLA | Age |');
    L.push('|---|---|---|---|---:|');
    for (const d of stale) {
      L.push(`| \`${d.path}\` | ${d.owner} | ${d.last_verified} | ${d.verify_every} | ${d.age}d |`);
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

  writeFileSync(OUT, L.join('\n'));

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
