#!/usr/bin/env node
/**
 * Regenerates every Tier 1 knowledge base document.
 *
 * Usage:  npm run kb:generate
 *         npm run kb:generate -- --check   (CI: fail if output would change)
 *
 * Order matters: knowledge-map runs last so it sees documents the others just wrote.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PRIVATE = join(REPO, 'kb/private');
const check = process.argv.includes('--check');

const GENERATORS = [
  ['data-model', './generate/data-model.mjs'],
  ['inventory', './generate/inventory.mjs'],
  ['rpc-reference', './generate/rpc-reference.mjs'],
  ['rls-policies', './generate/rls-policies.mjs'],
  ['knowledge-map', './generate/knowledge-map.mjs'], // last: reads what the others wrote
];

// Two generators write security-sensitive output to kb/private/ and must never fall
// back to the public tree. When that repo is absent — as in CI, which has no access to
// it — SKIP those generators rather than aborting.
//
// Aborting here made the CI "generated docs are current" step fail 100% of the time for
// a reason unrelated to drift, and because the step was continue-on-error the failure was
// swallowed. The check credited with preventing documentation drift was inert.
const HAS_PRIVATE = existsSync(PRIVATE);
if (!HAS_PRIVATE) {
  console.log(
    'note  kb/private/ absent — skipping generators that write there.\n' +
    '      For the full set: git clone git@github.com:vvkiitkgp/livil-kb-private.git kb/private\n',
  );
}

console.log('\nRegenerating tier-1 knowledge base documents\n');

const results = [];
const PRIVATE_GENERATORS = new Set(['rpc-reference', 'rls-policies']);

for (const [name, mod] of GENERATORS) {
  if (!HAS_PRIVATE && PRIVATE_GENERATORS.has(name)) {
    console.log(`  skip  ${name.padEnd(15)} (needs kb/private/)`);
    continue;
  }
  try {
    const { generate } = await import(mod);
    const r = generate();
    results.push(r);
    const detail = Object.entries(r)
      .filter(([k]) => k !== 'doc')
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`)
      .join(' ');
    console.log(`  ok    ${name.padEnd(15)} ${detail}`);
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    process.exit(1);
  }
}

// Surface security findings prominently — a generator that quietly finds a privilege
// escalation and prints nothing has failed at its actual job.
const rpc = results.find(r => r.doc === 'rpc-reference');
const rls = results.find(r => r.doc === 'rls-policies');

const alerts = [];
if (rpc?.unguarded?.length) {
  alerts.push(
    `${rpc.unguarded.length} privileged function(s) write to access-granting tables with no ` +
    `membership check: ${rpc.unguarded.join(', ')}`,
  );
}
if (rls?.anonReachable) alerts.push(`${rls.anonReachable} policy/policies reachable by the anon role`);
if (rls?.noPolicies) alerts.push(`${rls.noPolicies} table(s) with no policy declared in this repo`);

if (alerts.length) {
  console.log('\n  ── security findings ──');
  for (const a of alerts) console.log(`  !     ${a}`);
  console.log('        Detail is in kb/private/ (not committed to this public repo).');
}

if (check) {
  // Only consider TRACKED, MODIFIED generated files. `git status --porcelain` also lists
  // untracked and hand-written files, which produced "docs are out of date" failures that
  // had nothing to do with generated output.
  const dirty = execSync('git diff --name-only -- kb/', { cwd: REPO, encoding: 'utf8' }).trim();
  if (dirty) {
    console.error('\nFAIL  generated documents are out of date. Run: npm run kb:generate\n');
    console.error(dirty + '\n');
    process.exit(1);
  }
  console.log('\nPASS  generated documents are current\n');
} else {
  console.log('\nDone. Review changes before committing.\n');
}
