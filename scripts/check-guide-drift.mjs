#!/usr/bin/env node
/**
 * Keeps the first-run guide honest.
 *
 * The guide (src/components/guide/) is fifteen animated cards, each depicting one
 * real behaviour of the app: how the floating player responds to a flick, what the
 * repost screen offers, who a Star can see. Nothing ties those drawings to the code
 * they draw, so the natural fate of a guide is to quietly describe the app as it was
 * on the day it shipped. This is the layer that stops that.
 *
 * src/components/guide/coverage.json maps each card to the files it depicts. When a
 * change touches one of those files, one of three things must also be true:
 *
 *   1. the guide itself changed (src/components/guide/**), or
 *   2. the change is acknowledged — `Guide: reviewed` in the PR body (passed in as
 *      PR_BODY) or in any commit message in the range — meaning someone looked and
 *      the cards are still true, or
 *   3. nothing the guide depicts changed.
 *
 * Otherwise it fails and names the cards to look at. The ack is deliberately cheap:
 * the point is that somebody LOOKS, not that every PR redraws a card.
 *
 * The manifest is checked too: a path that no longer exists fails, so a rename cannot
 * silently retire a card's coverage.
 *
 * Usage:
 *   node scripts/check-guide-drift.mjs --range origin/main..HEAD
 *   PR_BODY="$(gh pr view --json body -q .body)" node scripts/check-guide-drift.mjs --range …
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const MANIFEST = 'src/components/guide/coverage.json';
const GUIDE_DIR = /^src\/components\/guide\//;
const ACK = /^\s*Guide:\s*reviewed\b/im;

const args = process.argv.slice(2);
const range = args[args.indexOf('--range') + 1];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function changedFiles() {
  if (!range || !range.includes('..')) {
    console.error('FAIL  --range requires <base>..<head>');
    process.exit(2);
  }
  // Same fallback as the other range-based checks: an unreachable base (force-push,
  // shallow clone) must not turn into a failure unrelated to what this guards.
  const [base] = range.split('..');
  try {
    sh(`git cat-file -e ${base}^{commit}`);
  } catch {
    console.log(`note  base ${base.slice(0, 8)} is unreachable — falling back to HEAD~1`);
    try {
      return sh('git diff --name-only HEAD~1..HEAD').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
  return sh(`git diff --name-only ${range}`).split('\n').filter(Boolean);
}

function acknowledged() {
  if (ACK.test(process.env.PR_BODY ?? '')) return 'PR body';
  try {
    if (ACK.test(sh(`git log --format=%B ${range}`))) return 'a commit message';
  } catch { /* fall through */ }
  return null;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const cards = Object.entries(manifest).filter(([k]) => !k.startsWith('$'));

// 1. The manifest must point at real files.
const missing = cards.flatMap(([card, paths]) => paths.filter(p => !existsSync(p)).map(p => `${card}: ${p}`));
if (missing.length) {
  console.error(`FAIL  ${MANIFEST} names files that do not exist — a rename retired a card's coverage:`);
  for (const m of missing) console.error(`      ${m}`);
  console.error('      Point the card at the file that now holds that behaviour.');
  process.exit(1);
}

// 2. Compare the change against it.
const changed = new Set(changedFiles());
const guideTouched = [...changed].some(f => GUIDE_DIR.test(f));
const hits = cards
  .map(([card, paths]) => [card, paths.filter(p => changed.has(p))])
  .filter(([, paths]) => paths.length);

if (!hits.length) {
  console.log('ok    nothing the first-run guide depicts changed');
  process.exit(0);
}
if (guideTouched) {
  console.log(`ok    ${hits.length} depicted area(s) changed and the guide changed with them`);
  process.exit(0);
}
const ack = acknowledged();
if (ack) {
  console.log(`ok    ${hits.length} depicted area(s) changed; acknowledged as reviewed in ${ack}`);
  for (const [card, paths] of hits) console.log(`      ${card}: ${paths.join(', ')}`);
  process.exit(0);
}

console.error('FAIL  this change touches behaviour the first-run guide depicts, and the guide did not change:');
for (const [card, paths] of hits) console.error(`      card "${card}"  ←  ${paths.join(', ')}`);
console.error('');
console.error('      Open Settings → "Replay the guide" and check those cards are still true.');
console.error('      Then either update the card (src/components/guide/) or, if it is still');
console.error('      accurate, add the line `Guide: reviewed` to the PR description.');
process.exit(1);
