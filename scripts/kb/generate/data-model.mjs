/**
 * Generates the database schema reference from the migration set.
 *
 * Public: describes structure, not weakness. Authorization detail lives in the private
 * RLS inventory.
 */


import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMigrations, parseTables, parseRls, parseTriggers, parsePublications,
  frontmatter, GENERATED_WARNING,
  writeGenerated,
} from '../lib/sql-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(REPO, 'supabase/migrations');
const OUT = join(REPO, 'kb/architecture/data-model.md');

export function generate() {
  const migrations = loadMigrations(MIGRATIONS);
  const tables = parseTables(migrations);
  const { rlsEnabled } = parseRls(migrations);
  const triggers = parseTriggers(migrations);
  const realtime = parsePublications(migrations);

  const defined = [...tables.values()].filter(t => t.definedIn);
  const undefinedTables = [...tables.values()].filter(t => !t.definedIn);

  const L = [];
  L.push(frontmatter({
    tier: 1, owner: 'principal-data',
    consumers: ['P-DA', 'BE', 'QA', 'DC'], visibility: 'public',
  }));
  L.push('# Data Model\n');
  L.push(GENERATED_WARNING + '\n');
  L.push(`Reconstructed from ${migrations.length} migration(s) in \`supabase/migrations/\`.\n`);

  // ── The completeness caveat, stated first ──
  L.push('## ⚠️ This schema is incomplete\n');
  L.push(
    `**${undefinedTables.length} table(s) are referenced by migrations but never created in this\n` +
    'repository.** They predate the migration directory and were created directly in the hosted\n' +
    'project. Their columns, constraints, and policies exist only in production.\n',
  );
  if (undefinedTables.length) {
    L.push('| Table referenced but not defined here | Altered by migrations? | Indexed here? |');
    L.push('|---|:--:|:--:|');
    for (const t of undefinedTables.sort((a, b) => a.name.localeCompare(b.name))) {
      L.push(`| \`${t.name}\` | ${t.altered.length ? `yes (${t.altered.length})` : 'no'} | ${t.indexes.length ? `yes (${t.indexes.length})` : 'no'} |`);
    }
    L.push('');
  }
  L.push(
    'The consequence is that **this database cannot be rebuilt from this repository**, and the\n' +
    'authorization model on those tables cannot be reviewed from source. Constitution P51 says\n' +
    'production state that exists nowhere in the repository is state we cannot reason about,\n' +
    'review, or restore. Closing this requires a baseline schema dump.\n',
  );

  // ── Tables ──
  L.push('## Tables defined in this repository\n');
  L.push(`${defined.length} table(s).\n`);

  for (const t of defined.sort((a, b) => a.name.localeCompare(b.name))) {
    L.push(`### \`${t.name}\`\n`);
    const badges = [];
    badges.push(rlsEnabled.has(t.name) ? 'RLS enabled' : '**RLS not declared here**');
    if (realtime.has(t.name)) badges.push('realtime');
    L.push(`${badges.join(' · ')} · defined in \`${t.definedIn}\`\n`);

    const cols = t.columns.filter(c => !c.isConstraint);
    if (cols.length) {
      L.push('| Column | Definition |');
      L.push('|---|---|');
      for (const c of cols) L.push(`| \`${c.name}\` | \`${c.def}\` |`);
      L.push('');
    }

    const constraints = t.columns.filter(c => c.isConstraint);
    if (constraints.length) {
      L.push('**Table constraints**\n');
      for (const c of constraints) L.push(`- \`${c.def}\``);
      L.push('');
    }

    if (t.altered.length) {
      L.push('**Added by later migrations**\n');
      L.push('| Column | Definition | Migration |');
      L.push('|---|---|---|');
      for (const a of t.altered) L.push(`| \`${a.column}\` | \`${a.def}\` | \`${a.file}\` |`);
      L.push('');
    }

    if (t.indexes.length) {
      L.push('**Indexes**\n');
      for (const i of t.indexes) {
        L.push(`- ${i.unique ? '**unique** ' : ''}\`${i.name}\` \`${i.spec}\``);
      }
      L.push('');
    }

    const tt = triggers.filter(x => x.table === t.name);
    if (tt.length) {
      L.push('**Triggers**\n');
      for (const x of tt) L.push(`- \`${x.name}\` — ${x.timing} (\`${x.file}\`)`);
      L.push('');
    }
  }

  // ── Columns added to undefined tables ──
  if (undefinedTables.some(t => t.altered.length || t.indexes.length)) {
    L.push('## Partial knowledge of undefined tables\n');
    L.push('What migrations added to tables whose base definition is not in this repository.\n');
    for (const t of undefinedTables.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!t.altered.length && !t.indexes.length) continue;
      L.push(`### \`${t.name}\` *(base definition unknown)*\n`);
      if (t.altered.length) {
        L.push('| Column added | Definition | Migration |');
        L.push('|---|---|---|');
        for (const a of t.altered) L.push(`| \`${a.column}\` | \`${a.def}\` | \`${a.file}\` |`);
        L.push('');
      }
      if (t.indexes.length) {
        for (const i of t.indexes) L.push(`- index ${i.unique ? '**unique** ' : ''}\`${i.name}\` \`${i.spec}\``);
        L.push('');
      }
    }
  }

  // ── Realtime + triggers summary ──
  L.push('## Realtime publication\n');
  L.push(
    'Tables published to `supabase_realtime`. Row changes stream to subscribers, gated by the\n' +
    'same row-level security policies that gate ordinary reads.\n',
  );
  L.push([...realtime].sort().map(t => `- \`${t}\``).join('\n') + '\n');

  L.push('## Triggers\n');
  L.push('| Trigger | Table | Timing | Migration |');
  L.push('|---|---|---|---|');
  for (const x of triggers.sort((a, b) => a.table.localeCompare(b.table))) {
    L.push(`| \`${x.name}\` | \`${x.table}\` | ${x.timing} | \`${x.file}\` |`);
  }
  L.push('');

  L.push('## Related\n');
  L.push('- Privileged functions: [rpc-reference.md](rpc-reference.md)');
  L.push('- Authorization policies: [../security/rls-policies.md](../security/rls-policies.md)');
  L.push('- Access model and rationale: [../security/model.md](../security/model.md)\n');

  writeGenerated(OUT, L.join('\n'));

  return {
    doc: 'data-model',
    defined: defined.length,
    undefined: undefinedTables.length,
    triggers: triggers.length,
    realtime: realtime.size,
  };
}
