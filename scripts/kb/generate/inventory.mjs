/**
 * Generates the code inventory: routes, screens, components, services, dependencies.
 *
 * Answers "does X exist and how big is it" mechanically, so nobody hand-maintains a list
 * that goes stale. Also surfaces RPC names the client calls that no migration defines.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMigrations, parseFunctions, frontmatter, GENERATED_WARNING,
  writeGenerated,
} from '../lib/sql-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(REPO, 'kb/architecture/inventory.md');

/** Screens above this are complexity hotspots worth naming (Constitution P28). */
const SIZE_WARN = 600;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

const lines = f => readFileSync(f, 'utf8').split('\n').length;
const rel = f => relative(REPO, f);

export function generate() {
  const screens = walk(join(REPO, 'src/screens')).sort();
  const components = walk(join(REPO, 'src/components')).sort();
  const services = walk(join(REPO, 'src/services')).sort();
  const contexts = walk(join(REPO, 'src/contexts')).sort();
  const hooks = walk(join(REPO, 'src/hooks')).sort();
  const utils = walk(join(REPO, 'src/utils')).sort();

  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const routes = extractRoutes();
  const { rpcCalls, undefinedRpcs } = analyseRpcs();
  const allSrc = walk(join(REPO, 'src'));
  const totalLines = allSrc.reduce((n, f) => n + lines(f), 0);

  const L = [];
  L.push(frontmatter({
    tier: 1, owner: 'principal-client',
    consumers: ['ALL'], visibility: 'public',
  }));
  L.push('# Code Inventory\n');
  L.push(GENERATED_WARNING + '\n');
  L.push(
    `${allSrc.length} TypeScript file(s) under \`src/\`, ${totalLines.toLocaleString()} lines.\n`,
  );

  // ── Findings ──
  const bigScreens = screens.filter(f => lines(f) > SIZE_WARN);
  const bigComponents = components.filter(f => lines(f) > SIZE_WARN);

  L.push('## Size hotspots\n');
  L.push(
    `Files over ${SIZE_WARN} lines. Size is a proxy for tangled responsibility — when a unit\n` +
    'grows past comprehension its responsibilities have usually stopped being separable by\n' +
    'reading alone (Constitution P28).\n',
  );
  if (bigScreens.length || bigComponents.length) {
    L.push('| File | Lines |');
    L.push('|---|---:|');
    for (const f of [...bigScreens, ...bigComponents].sort((a, b) => lines(b) - lines(a))) {
      L.push(`| \`${rel(f)}\` | ${lines(f)} |`);
    }
    L.push('');
    const hookCount = hooks.length;
    L.push(
      `> ${bigScreens.length + bigComponents.length} file(s) over the threshold against ` +
      `**${hookCount} custom hook(s)** in \`src/hooks/\`. The ratio of large units to extracted\n` +
      '> logic is the structural signal here, more than any individual file.\n',
    );
  } else {
    L.push('None.\n');
  }

  // Naming RPCs the client calls that do not exist points at broken code paths. That is a
  // defect disclosure, so it goes to the private repo and only the count stays public.
  if (undefinedRpcs.length) {
    L.push('## RPCs called by the client but not defined in any migration\n');
    L.push(
      `**${undefinedRpcs.length} found.** The client calls these by name and no migration creates\n` +
      'them — either they were created outside version control, or they do not exist, in which\n' +
      'case the call fails silently wherever its result is discarded.\n',
    );
    L.push(
      '🔒 Names and call sites are held in `kb/private/architecture/undefined-rpcs.md`.\n',
    );
    writeUndefinedRpcsPrivate(undefinedRpcs);
  }

  // ── Routes ──
  L.push('## Navigation routes\n');
  if (routes.length) {
    L.push('| Route | Params |');
    L.push('|---|---|');
    for (const r of routes) L.push(`| \`${r.name}\` | ${r.params} |`);
    L.push('');
  } else {
    L.push('*Could not parse route definitions.*\n');
  }

  // ── Inventories ──
  section(L, 'Screens', screens);
  section(L, 'Components', components);
  section(L, 'Services', services);
  section(L, 'Contexts', contexts);
  section(L, 'Hooks', hooks);
  section(L, 'Utilities', utils);

  // ── Dependencies ──
  L.push('## Dependencies\n');
  L.push('Declared range versus what is actually installed. A drift here means a pinned\n' +
    'version is not the version running (Constitution P52).\n');
  L.push('| Package | Declared | Installed |');
  L.push('|---|---|---|');
  for (const [name, range] of Object.entries(pkg.dependencies ?? {}).sort()) {
    let installed = '—';
    try {
      installed = JSON.parse(
        readFileSync(join(REPO, 'node_modules', name, 'package.json'), 'utf8'),
      ).version;
    } catch { installed = '*(not installed)*'; }
    const drift = installed !== '—' && !range.includes(installed) && /^[\^~]/.test(range);
    L.push(`| \`${name}\` | \`${range}\` | ${drift ? `**${installed}**` : installed} |`);
  }
  L.push('');
  L.push('*Bold = installed version differs from the floor of the declared range.*\n');

  writeGenerated(OUT, L.join('\n'));

  return {
    doc: 'inventory',
    files: allSrc.length,
    lines: totalLines,
    hotspots: bigScreens.length + bigComponents.length,
    undefinedRpcs: undefinedRpcs.length,
  };
}

function writeUndefinedRpcsPrivate(undefinedRpcs) {
  const out = join(REPO, 'kb/private/architecture/undefined-rpcs.md');
  mkdirSync(dirname(out), { recursive: true });
  const L = [
    frontmatter({
      tier: 1, owner: 'principal-data',
      consumers: ['P-DA', 'BE', 'QA'], visibility: 'public',
    }),
    '# RPCs Called But Not Defined\n',
    GENERATED_WARNING + '\n',
    'Remote procedures the client invokes by name that no migration in this repository creates.\n',
    'Each is one of: created outside version control (so unreviewable), or non-existent — in',
    'which case every call fails. Where the caller discards the result, it fails **silently**,',
    'and the feature simply does nothing with no error anywhere.\n',
    '| RPC | Called from |',
    '|---|---|',
    ...undefinedRpcs.map(r => `| \`${r.name}\` | ${r.sites.map(s => `\`${s}\``).join(', ')} |`),
    '',
  ];
  writeGenerated(out, L.join('\n'));
}

function section(L, title, files) {
  L.push(`## ${title}\n`);
  if (!files.length) { L.push('*None.*\n'); return; }
  L.push(`${files.length} file(s), ${files.reduce((n, f) => n + lines(f), 0).toLocaleString()} lines.\n`);
  L.push('| File | Lines |');
  L.push('|---|---:|');
  for (const f of files.sort((a, b) => lines(b) - lines(a))) {
    L.push(`| \`${rel(f)}\` | ${lines(f)} |`);
  }
  L.push('');
}

function extractRoutes() {
  const p = join(REPO, 'src/navigation/types.ts');
  if (!existsSync(p)) return [];
  const src = readFileSync(p, 'utf8');
  const out = [];
  const block = src.match(/RootStackParamList\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return out;
  for (const m of block[1].matchAll(/^\s*(\w+)\s*:\s*([^;]+);/gm)) {
    out.push({ name: m[1], params: `\`${m[2].replace(/\s+/g, ' ').trim()}\`` });
  }
  return out;
}

function analyseRpcs() {
  const defined = new Set(
    parseFunctions(loadMigrations(join(REPO, 'supabase/migrations'))).keys(),
  );
  const calls = new Map();
  for (const f of walk(join(REPO, 'src'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.rpc\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/gi)) {
      if (!calls.has(m[1])) calls.set(m[1], new Set());
      calls.get(m[1]).add(rel(f));
    }
  }
  const undefinedRpcs = [];
  for (const [name, sites] of calls) {
    if (!defined.has(name)) undefinedRpcs.push({ name, sites: [...sites] });
  }
  return {
    rpcCalls: calls,
    undefinedRpcs: undefinedRpcs.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
