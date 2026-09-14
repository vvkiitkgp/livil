/**
 * Generates the row-level security policy inventory.
 *
 * SENSITIVE: names tables with permissive or absent policies. Written to the PRIVATE repo;
 * only a findings-free stub goes to the public repo.
 */

import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMigrations, parseTables, parseRls, isPermissive, parsePublications,
  frontmatter, GENERATED_WARNING,
  writeGenerated,
} from '../lib/sql-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(REPO, 'supabase/migrations');
const PRIVATE_OUT = join(REPO, 'kb/private/security/rls-policies.md');
const PUBLIC_STUB = join(REPO, 'kb/security/rls-policies.md');

export function generate() {
  const migrations = loadMigrations(MIGRATIONS);
  const tables = parseTables(migrations);
  const { rlsEnabled, policies } = parseRls(migrations);
  const realtime = parsePublications(migrations);

  const byTable = new Map();
  for (const p of policies) {
    if (!byTable.has(p.table)) byTable.set(p.table, []);
    byTable.get(p.table).push(p);
  }

  const permissive = policies.filter(isPermissive);
  const anonReachable = permissive.filter(p => !p.roles || !/authenticated/i.test(p.roles));
  const allTables = [...new Set([...tables.keys(), ...byTable.keys(), ...rlsEnabled])].sort();
  const noPolicies = allTables.filter(t => !byTable.has(t));
  const realtimeNoPolicy = [...realtime].filter(t => !byTable.has(t)).sort();

  const L = [];
  L.push(frontmatter({
    tier: 1, owner: 'principal-security',
    consumers: ['P-SE', 'SR', 'P-DA', 'QA'], visibility: 'public',
  }));
  L.push('# Row-Level Security Policy Inventory\n');
  L.push(GENERATED_WARNING + '\n');

  L.push('## Why this matters\n');
  L.push(
    'Row-level security **is** our authorization perimeter. The client talks to Postgres\n' +
    'directly, there is no API tier, and destructive operations are issued without any\n' +
    'client-side ownership filter — they rely entirely on these policies (Constitution P16).\n' +
    'A missing or permissive policy is not a hardening gap; it is the absence of authorization.\n',
  );

  L.push('## Reliability of this report\n');
  L.push(
    '**Built by reading migration files, not by querying the database.** It therefore describes\n' +
    'what this repository declares, which is not necessarily what production enforces. Where a\n' +
    'table was created outside version control, its policies are invisible here — absence from\n' +
    'this report means *unknown*, never *safe* (Constitution P32).\n',
  );

  // ── Findings ──
  L.push('## Findings\n');

  if (noPolicies.length) {
    L.push(`### ${noPolicies.length} table(s) with no policy declared in this repository\n`);
    L.push(
      'Either the table predates the migration directory and its policies live only in the\n' +
      'hosted project, or it genuinely has none. Both are problems: the first means the\n' +
      'authorization model cannot be reviewed or restored from source (Constitution P51).\n',
    );
    L.push('| Table | RLS enabled here? | In realtime publication? |');
    L.push('|---|:--:|:--:|');
    for (const t of noPolicies) {
      L.push(`| \`${t}\` | ${rlsEnabled.has(t) ? 'yes' : '**not declared**'} | ${realtime.has(t) ? '**yes**' : 'no'} |`);
    }
    L.push('');
    if (realtimeNoPolicy.length) {
      L.push(
        `> **${realtimeNoPolicy.length} of these are published to realtime** ` +
        `(\`${realtimeNoPolicy.join('`, `')}\`). Realtime replays row changes to subscribers and is\n` +
        '> gated by the same policies. An unpoliced table here streams changes to whoever subscribes.\n',
      );
    }
  }

  if (permissive.length) {
    L.push(`### ${permissive.length} policy/policies evaluate to \`true\`\n`);
    L.push('| Table | Policy | Command | Roles | Reachable by `anon`? |');
    L.push('|---|---|---|---|:--:|');
    for (const p of permissive) {
      const anon = !p.roles || !/authenticated/i.test(p.roles);
      L.push(`| \`${p.table}\` | \`${p.name}\` | ${p.command} | ${p.roles ?? '*(unscoped)*'} | ${anon ? '**yes**' : 'no'} |`);
    }
    L.push('');
    L.push(
      '> A `using (true)` policy without a `TO authenticated` clause is reachable by the **anon**\n' +
      '> role. The anon key is published in the mobile app and on the marketing site, so anyone\n' +
      '> can exercise these.\n',
    );
    if (anonReachable.length) {
      L.push(`> **${anonReachable.length} of the above are anon-reachable.**\n`);
    }
  }

  if (!noPolicies.length && !permissive.length) {
    L.push('No permissive or missing policies detected. Per the caveat above, this is not proof of safety.\n');
  }

  // ── Full inventory ──
  L.push('## Policies by table\n');
  L.push(`${policies.length} policy/policies across ${byTable.size} table(s).\n`);

  for (const table of [...byTable.keys()].sort()) {
    const ps = byTable.get(table);
    L.push(`### \`${table}\`\n`);
    L.push(`RLS explicitly enabled in this repo: **${rlsEnabled.has(table) ? 'yes' : 'not declared'}**` +
      (realtime.has(table) ? ' · published to realtime' : '') + '\n');
    L.push('| Policy | Command | Roles | `USING` | `WITH CHECK` |');
    L.push('|---|---|---|---|---|');
    for (const p of ps.sort((a, b) => a.command.localeCompare(b.command))) {
      const cell = s => (s ? `\`${s.length > 90 ? s.slice(0, 90) + '…' : s}\`` : '—');
      const flag = isPermissive(p) ? ' 🔴' : '';
      L.push(`| \`${p.name}\`${flag} | ${p.command} | ${p.roles ?? '—'} | ${cell(p.using)} | ${cell(p.withCheck)} |`);
    }
    L.push('');
    const commands = new Set(ps.map(p => p.command));
    const missing = ['select', 'insert', 'update', 'delete'].filter(c => !commands.has(c) && !commands.has('all'));
    if (missing.length) L.push(`*No policy for: ${missing.join(', ')}. Those operations are denied by default.*\n`);
  }

  mkdirSync(dirname(PRIVATE_OUT), { recursive: true });
  writeGenerated(PRIVATE_OUT, L.join('\n'));
  writeGenerated(PUBLIC_STUB, buildStub(policies.length, byTable.size));

  return {
    doc: 'rls-policies',
    policies: policies.length,
    tables: byTable.size,
    permissive: permissive.length,
    anonReachable: anonReachable.length,
    noPolicies: noPolicies.length,
  };
}

function buildStub(policyCount, tableCount) {
  return [
    frontmatter({
      tier: 1, owner: 'principal-security',
      consumers: ['P-SE', 'SR', 'P-DA', 'QA'], visibility: 'private-content',
    }),
    '# Row-Level Security Policy Inventory — private',
    '',
    '**The content of this document is held privately.** It lists every row-level security',
    'policy declared in the migration set and flags tables that are unpoliced or readable by',
    'anyone. Publishing that in a public repository would be publishing a map of where the',
    'authorization perimeter is thin.',
    '',
    `Scope: ${policyCount} policy/policies across ${tableCount} table(s).`,
    '',
    '| | |',
    '|---|---|',
    '| Real document | `kb/private/security/rls-policies.md` |',
    '| Backing repo | `vvkiitkgp/livil-kb-private` (private) |',
    '| Generated by | `npm run kb:generate` |',
    '',
    'An agent without access to the private repository must say so plainly rather than treat',
    'this stub as the full picture (Constitution P6).',
    '',
    'Rules governing private content: [knowledge-base-spec.md §4](../ai-org/knowledge-base-spec.md).',
    '',
  ].join('\n');
}
