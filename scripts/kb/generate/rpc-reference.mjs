/**
 * Generates the privileged-function reference.
 *
 * SENSITIVE: the full report names functions that bypass row-level security without
 * an authorization check. It is written to the PRIVATE repo. Only a stub, carrying no
 * findings, is written to the public repo.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMigrations, parseFunctions, frontmatter, GENERATED_WARNING,
} from '../lib/sql-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(REPO, 'supabase/migrations');
const PRIVATE_OUT = join(REPO, 'kb/private/architecture/rpc-reference.md');
const PUBLIC_STUB = join(REPO, 'kb/architecture/rpc-reference.md');

const ORDER = { UNGUARDED: 0, 'LIKELY GUARDED': 1, 'LOW RISK': 2, GUARDED: 3, 'N/A': 4 };

export function generate() {
  const migrations = loadMigrations(MIGRATIONS);
  const fns = [...parseFunctions(migrations).values()];
  const definer = fns.filter(f => f.security === 'DEFINER');
  const unguarded = definer.filter(f => f.verdict === 'UNGUARDED');

  definer.sort((a, b) => (ORDER[a.verdict] - ORDER[b.verdict]) || a.name.localeCompare(b.name));

  const lines = [];
  lines.push(frontmatter({
    tier: 1,
    owner: 'principal-data',
    consumers: ['P-DA', 'P-SE', 'SR', 'BE'],
    visibility: 'public', // within the private repo this file is the real content
  }));
  lines.push('# Privileged Function Reference\n');
  lines.push(GENERATED_WARNING + '\n');

  lines.push('## What this is\n');
  lines.push(
    'Every database function in `supabase/migrations/`, with its security context and an\n' +
    'assessment of whether it performs an authorization check.\n',
  );
  lines.push(
    '`SECURITY DEFINER` functions execute with the definer\'s privileges and **bypass row-level\n' +
    'security**. RLS is our authorization perimeter (Constitution P16), so each of these is a\n' +
    'deliberate hole in it and must prove its own check (P17).\n',
  );

  lines.push('## Reliability of this report\n');
  lines.push(
    '**This is a heuristic reader, not a PostgreSQL parser.** It pattern-matches SQL text. It\n' +
    'can produce false positives and false negatives, and it cannot follow dynamic SQL or\n' +
    'multi-hop call chains. A `GUARDED` verdict is a hint, not a proof; an empty findings list\n' +
    'is not evidence of safety (Constitution P32). Use it to decide **where to look**, never as\n' +
    'the basis for concluding a function is safe.\n',
  );
  lines.push(
    '**On the `not_authenticated` pattern.** Several functions open with a check that the caller\n' +
    'is signed in. That is *authentication*. It says nothing about whether the caller may touch\n' +
    'the resource named in the parameters, which is *authorization*. Functions whose only check\n' +
    'is this pattern are reported as `UNGUARDED` and called out explicitly, because at a glance\n' +
    'they read as protected.\n',
  );

  // ── Findings ──
  lines.push('## Findings\n');
  if (unguarded.length === 0) {
    lines.push('No `SECURITY DEFINER` function was flagged as unguarded by this pass.\n');
    lines.push('Per the caveat above, that is **not** a clean bill of health.\n');
  } else {
    lines.push(
      `**${unguarded.length} \`SECURITY DEFINER\` function(s) bypass RLS with no authorization ` +
      'check detected.** Each is a candidate privilege escalation and should be reviewed.\n',
    );
    lines.push('| Function | Writes? | Caller supplies the object id? | Why flagged | Defined in |');
    lines.push('|---|:--:|:--:|---|---|');
    for (const f of unguarded) {
      lines.push(
        `| \`${f.name}\` | ${f.mutates ? '**yes**' : 'no'} | ${f.takesForeignRef ? '**yes**' : 'no'} ` +
        `| ${f.reason} | \`${f.file}\` |`,
      );
    }
    lines.push('');
    lines.push(
      '> The highest-risk shape is a function that **writes to an access-granting table** using an\n' +
      '> **object id the caller supplied**, with RLS disabled. The caller names a resource they may\n' +
      '> have no relationship to, and the function grants them a relationship to it.\n',
    );
  }

  // ── Full inventory ──
  lines.push('## All functions\n');
  lines.push(`${fns.length} function(s) found across ${migrations.length} migration(s); ` +
    `${definer.length} are \`SECURITY DEFINER\`.\n`);
  lines.push('| Function | Security | Verdict | Basis | Defined in |');
  lines.push('|---|---|---|---|---|');
  for (const f of definer) {
    const flag = f.verdict === 'UNGUARDED' ? '🔴' : f.verdict === 'LIKELY GUARDED' ? '🟡' : '🟢';
    lines.push(`| \`${f.name}\` | ${f.security} | ${flag} ${f.verdict} | ${f.reason} | \`${f.file}\` |`);
  }
  lines.push('');

  const nonDefiner = fns.filter(f => f.security !== 'DEFINER');
  if (nonDefiner.length) {
    lines.push('### Non-privileged functions\n');
    lines.push('These run as the caller, so row-level security still applies.\n');
    lines.push('| Function | Security | Defined in |');
    lines.push('|---|---|---|');
    for (const f of nonDefiner.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| \`${f.name}\` | ${f.security} | \`${f.file}\` |`);
    }
    lines.push('');
  }

  lines.push('## Functions referenced by the app but not defined here\n');
  lines.push(
    'The client calls RPCs by name. A name the client calls that appears in no migration is\n' +
    'either created outside this repo or does not exist at all — in which case the call fails\n' +
    'silently if its result is discarded. See `kb/architecture/inventory.md` for client call sites.\n',
  );

  mkdirSync(dirname(PRIVATE_OUT), { recursive: true });
  writeFileSync(PRIVATE_OUT, lines.join('\n'));

  writeFileSync(PUBLIC_STUB, buildStub(definer.length));

  return {
    doc: 'rpc-reference',
    total: fns.length,
    definer: definer.length,
    unguarded: unguarded.map(f => f.name),
  };
}

function buildStub(definerCount) {
  return [
    frontmatter({
      tier: 1,
      owner: 'principal-data',
      consumers: ['P-DA', 'P-SE', 'SR', 'BE'],
      visibility: 'private-content',
    }),
    '# Privileged Function Reference — private',
    '',
    '**The content of this document is held privately.** It inventories every database function',
    'that bypasses row-level security and assesses whether each performs an authorization check.',
    'Naming the ones that do not would hand an attacker a map, and this repository is public.',
    '',
    `Scope: ${definerCount} \`SECURITY DEFINER\` function(s) across the migration set.`,
    '',
    '| | |',
    '|---|---|',
    '| Real document | `kb/private/architecture/rpc-reference.md` |',
    '| Backing repo | `vvkiitkgp/livil-kb-private` (private) |',
    '| Generated by | `npm run kb:generate` |',
    '',
    'An agent without access to the private repository must say so plainly rather than reason',
    'from this stub as though it were the whole picture (Constitution P6).',
    '',
    'Rules governing private content: [knowledge-base-spec.md §4](../ai-org/knowledge-base-spec.md).',
    '',
  ].join('\n');
}
