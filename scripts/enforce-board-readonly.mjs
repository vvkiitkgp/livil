#!/usr/bin/env node
/**
 * Enforces that the Architecture Board never modifies production code.
 *
 * The board is proposal-only by mandate. Prompt instructions alone cannot guarantee
 * that — an agent can be argued out of a prompt, and a prompt cannot fail a build.
 * This script is the layer that actually holds: it inspects what a commit or branch
 * touched and fails if board-authored work reached anything but documentation.
 *
 * Two modes:
 *   --range <base>..<head>   check a commit range (used in CI)
 *   --staged                 check the staged index (used locally / pre-commit)
 *
 * A change is treated as board-authored when EITHER:
 *   - it is on a branch matching board/*
 *   - or its commit message carries a board trailer (Board-Proposal: / Board-ADR:)
 *
 * Usage:
 *   node scripts/enforce-board-readonly.mjs --range origin/main..HEAD
 *   node scripts/enforce-board-readonly.mjs --staged
 */

import { execSync } from 'node:child_process';

/** Paths the board may write. Everything else is production. */
const ALLOWED = [
  /^kb\/decisions\//,
  /^kb\/debt\//,
  /^kb\/incidents\//,
  /^kb\/ai-org\//,
  /^kb\/architecture\//,
  /^kb\/security\//,
  /^kb\/operations\//,
  /^kb\/standards\//,
  /^kb\/product\//,
  /^kb\/INDEX\.md$/,
  /^kb\/glossary\.md$/,
];

/**
 * Paths NO agent may touch regardless of role, because a wrong change is
 * unrecoverable or silently breaks something no test covers.
 */
const NEVER = [
  { re: /^patches\//, why: 'the native patch — breakage is silent and device-specific' },
  { re: /^android\/app\/build\.gradle$/, why: 'release signing configuration' },
  { re: /\.keystore$/, why: 'signing key' },
  { re: /^kb\/private\//, why: 'private content must never be committed to this public repo' },
];

const args = process.argv.slice(2);
const mode = args.includes('--staged') ? 'staged' : 'range';
const range = args[args.indexOf('--range') + 1];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function changedFiles() {
  if (mode === 'staged') {
    return sh('git diff --cached --name-only').split('\n').filter(Boolean);
  }
  if (!range || !range.includes('..')) {
    console.error('FAIL  --range requires <base>..<head>');
    process.exit(2);
  }

  // The base may not be reachable — a force-push orphans the previous commit, and a
  // shallow clone may not have it. Fall back rather than crashing: a check that dies
  // on an unresolvable base is a check that fails for reasons unrelated to what it
  // guards, which is how a gate becomes noise and then gets disabled.
  const [base] = range.split('..');
  try {
    sh(`git cat-file -e ${base}^{commit}`);
  } catch {
    console.log(`note  base ${base.slice(0, 8)} is unreachable (force-push or shallow clone) —`);
    console.log('      falling back to HEAD~1');
    try {
      return sh('git diff --name-only HEAD~1..HEAD').split('\n').filter(Boolean);
    } catch {
      console.log('note  no parent commit either; nothing to compare');
      return [];
    }
  }

  try {
    return sh(`git diff --name-only ${range}`).split('\n').filter(Boolean);
  } catch (err) {
    console.error(`FAIL  could not diff ${range}: ${err.message.split('\n')[0]}`);
    process.exit(1);
  }
}

function isBoardAuthored() {
  let branch = '';
  try {
    branch = sh('git rev-parse --abbrev-ref HEAD');
  } catch { /* detached head in CI */ }
  if (/^board\//.test(branch)) return { yes: true, why: `branch ${branch}` };

  if (mode === 'range' && range) {
    let msgs = '';
    try {
      msgs = sh(`git log --format=%B ${range}`);
    } catch { /* range may not resolve on a shallow clone */ }
    if (/^Board-(Proposal|ADR):/m.test(msgs)) {
      return { yes: true, why: 'Board- trailer in a commit message' };
    }
  }
  return { yes: false };
}

const files = changedFiles();
if (files.length === 0) {
  console.log('PASS  no changed files');
  process.exit(0);
}

const failures = [];

// Rule 1 — universal: nobody touches these, board or not.
for (const f of files) {
  for (const n of NEVER) {
    if (n.re.test(f)) {
      failures.push(`${f}\n        never modifiable by an agent: ${n.why}`);
    }
  }
}

// Rule 2 — board-authored changes are confined to documentation.
const board = isBoardAuthored();
if (board.yes) {
  for (const f of files) {
    if (!ALLOWED.some(re => re.test(f))) {
      failures.push(
        `${f}\n        board-authored (${board.why}) but this is not a document path.\n` +
        '        The Architecture Board proposes; it does not implement.',
      );
    }
  }
}

if (failures.length) {
  console.error('\nFAIL  board read-only rule violated\n');
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error(
    `  ${failures.length} violation(s). The board may write only under kb/;\n` +
    '  implementation belongs to an engineer agent with tests and review.\n',
  );
  process.exit(1);
}

console.log(
  `PASS  ${files.length} changed file(s)` +
  (board.yes ? ` — board-authored (${board.why}), all within kb/` : ''),
);
