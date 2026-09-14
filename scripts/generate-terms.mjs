#!/usr/bin/env node
/**
 * Generates the in-app Terms content FROM docs/terms.html.
 *
 * WHY GENERATE RATHER THAN HAND-MAINTAIN
 *
 * The Terms exist in two places by necessity: a public web page (what a rights holder
 * or a reviewer reads, and what the acceptance record points at) and text inside the
 * app (what a user actually scrolls through before tapping Accept). If those two are
 * maintained separately they WILL drift, and the day they drift is the day the
 * acceptance record stops meaning anything -- it would attest to a version the user
 * never saw.
 *
 * So the web page is the single source and this script derives the app copy from it.
 *
 * It also computes the sha256 of the published HTML, which is what
 * `terms_versions.sha256` stores. That hash is why the acceptance log does not keep a
 * document copy per user: it proves the text has not been edited since acceptance, in
 * 64 bytes rather than a duplicated document per row.
 *
 * Run after ANY edit to docs/terms.html:
 *     node scripts/generate-terms.mjs
 *
 * EDITING TERMS MEANS PUBLISHING A NEW VERSION, not patching the old row. The
 * terms_versions table refuses UPDATE by trigger, deliberately: a hash that can be
 * retro-fitted to changed text attests to nothing. So bump the version in the HTML
 * header, re-run this, and INSERT a new row. Every existing user is then re-prompted,
 * recorded as 'reaccept'.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'docs/terms.html');
const OUT = join(root, 'src/constants/termsContent.ts');

const html = readFileSync(SOURCE, 'utf8');

// ── version ────────────────────────────────────────────────────────────────
// From the header line: "Version 1.0 &middot; Effective September 7, 2026"
const versionMatch = html.match(/Version\s+([0-9]+\.[0-9]+)\s*(?:&middot;|·)/);
if (!versionMatch) {
  console.error('Could not find a "Version X.Y" line in docs/terms.html.');
  console.error('The header must read: Version 1.0 &middot; Effective <date>');
  process.exit(1);
}
const version = versionMatch[1];

const effectiveMatch = html.match(/Effective\s+([^<]+?)\s*</);
const effective = effectiveMatch ? effectiveMatch[1].trim() : '';

// ── hash ───────────────────────────────────────────────────────────────────
// Over the exact published bytes. Any edit, however small, changes it -- which is the
// point: the hash detects a silent revision, it does not tolerate one.
const sha256 = createHash('sha256').update(html, 'utf8').digest('hex');

// ── sections ───────────────────────────────────────────────────────────────
const decode = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rarr;/g, '→')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Everything from the intro to the footer, split on <h2>.
const bodyStart = html.indexOf('<div class="intro">');
const bodyEnd = html.indexOf('<footer>');
if (bodyStart === -1 || bodyEnd === -1) {
  console.error('Could not locate the body of docs/terms.html (intro .. footer).');
  process.exit(1);
}
const body = html.slice(bodyStart, bodyEnd);

const chunks = body.split(/<h2>/);
const sections = [];

// The first chunk is the intro, which has no heading of its own.
const introParas = [...chunks[0].matchAll(/<p>([\s\S]*?)<\/p>/g)]
  .map((m) => decode(m[1]))
  .filter(Boolean);
if (introParas.length) sections.push({ heading: null, paragraphs: introParas });

for (const chunk of chunks.slice(1)) {
  const headingEnd = chunk.indexOf('</h2>');
  if (headingEnd === -1) continue;
  const heading = decode(chunk.slice(0, headingEnd));
  const rest = chunk.slice(headingEnd);

  const paragraphs = [];
  // Paragraphs and list items, in the order they appear, so the app reads like the page.
  for (const m of rest.matchAll(/<(p|li)>([\s\S]*?)<\/\1>/g)) {
    const text = decode(m[2]);
    if (!text) continue;
    paragraphs.push(m[1] === 'li' ? `•  ${text}` : text);
  }
  if (paragraphs.length) sections.push({ heading, paragraphs });
}

if (sections.length < 5) {
  console.error(`Only parsed ${sections.length} sections — that is almost certainly a`);
  console.error('parsing failure rather than a very short document. Not writing.');
  process.exit(1);
}

// ── emit ───────────────────────────────────────────────────────────────────
const file = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced from docs/terms.html by scripts/generate-terms.mjs. Edit the HTML, then
 * re-run the script. Hand-editing this file makes the app show text the published
 * Terms do not contain, which silently invalidates every acceptance recorded against
 * this version.
 *
 * TERMS_SHA256 is the hash of the published HTML and belongs in the
 * \`terms_versions\` row for this version.
 */

export type TermsSection = {
  /** null for the opening passage, which has no heading of its own. */
  heading: string | null;
  paragraphs: string[];
};

/** Bump by editing docs/terms.html — never here. */
export const TERMS_VERSION = '${version}';

/** Human-readable effective date, as shown on the page. */
export const TERMS_EFFECTIVE = '${effective}';

/** sha256 of the exact published HTML. Proves the text has not since been edited. */
export const TERMS_SHA256 = '${sha256}';

export const TERMS_SECTIONS: TermsSection[] = ${JSON.stringify(sections, null, 2)
  .replace(/"heading"/g, 'heading')
  .replace(/"paragraphs"/g, 'paragraphs')};
`;

writeFileSync(OUT, file, 'utf8');

console.log(`Wrote ${OUT}`);
console.log(`  version   ${version}`);
console.log(`  effective ${effective}`);
console.log(`  sections  ${sections.length}`);
console.log(`  sha256    ${sha256}`);
console.log();
console.log('Publish this version as a NEW ROW (terms_versions refuses UPDATE by design):');
console.log("  insert into public.terms_versions (version, effective_at, url, sha256)");
console.log(`  values ('${version}', now(), 'https://livil-music.com/terms.html', '${sha256}')`);
console.log('  on conflict (version) do nothing;');
console.log();
console.log('If this version already exists with a DIFFERENT hash, the text changed');
console.log('without the version being bumped. Bump it in docs/terms.html and re-run.');
