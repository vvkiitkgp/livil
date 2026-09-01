/**
 * Copy the marketing site into the Vercel build output.
 *
 * The apex serves a static page and the dashboard lives at /studio, so one deployment has to
 * carry both. The SPA builds into `dist/studio/`; this fills the rest of `dist/` from `docs/`,
 * which is what GitHub Pages serves today.
 *
 * COPY, NOT MOVE. `docs/` stays exactly where it is and GitHub Pages keeps serving the live
 * apex right up until DNS flips — so there is no window where livil-music.com is down or
 * half-migrated. Pages gets disabled after the Vercel deployment is confirmed, not before.
 *
 * THE THREE PATHS THAT MUST NOT MOVE. `privacy-policy.html`, `child-safety.html` and
 * `delete-account.html` are registered in the Play Console listing. A 404 on any of them is a
 * policy violation against a live listing, not a broken link — so this script fails the build
 * if any is missing rather than deploying a site that is quietly non-compliant.
 *
 * CNAME is skipped: it is a GitHub Pages mechanism and means nothing to Vercel, where the
 * domain is configured on the project.
 */
import { cp, mkdir, readdir, access, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = join(here, '../../docs');
const OUT = join(here, '../dist');

/** Registered in the Play Console. Their absence is a compliance failure, not a warning. */
const REQUIRED = ['privacy-policy.html', 'child-safety.html', 'delete-account.html'];

const SKIP = new Set(['CNAME']);

async function main() {
  // Vite's emptyOutDir only clears dist/studio, so anything previously written to dist/ root
  // survives forever — including assets from before the outDir moved under /studio. A stale
  // bundle at the apex is worse than a missing one: it loads, and it is the wrong build.
  await rm(join(OUT, 'assets'), { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const entries = await readdir(DOCS, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    await cp(join(DOCS, entry.name), join(OUT, entry.name), { recursive: true });
    copied++;
  }

  // Verified against the OUTPUT, not the source: the check that matters is what ships.
  const missing = [];
  for (const name of REQUIRED) {
    try {
      await access(join(OUT, name));
    } catch {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    console.error(
      `\nFAIL  Play Console paths missing from the build: ${missing.join(', ')}\n` +
        '      These URLs are registered in the Play Store listing. Shipping without them\n' +
        '      is a policy violation, not a broken link.\n',
    );
    process.exit(1);
  }

  // Android App Links verification depends on a file only the maintainer can complete:
  // it needs the PLAY APP SIGNING certificate fingerprint from the Play Console, not the
  // local upload keystore, because Play re-signs every release. Until it is filled in,
  // https://livil-music.com/p/<id> opens the browser rather than the app.
  //
  // A WARNING, NOT A FAILURE. The share page's "Open in app" button uses the
  // livil://post/<id> custom scheme, which needs no verification and has always worked —
  // so an unverified App Link costs one extra tap and nothing else. Failing the build
  // over it would block deploys of a site that is working.
  try {
    const assetlinks = await readFile(join(OUT, '.well-known/assetlinks.json'), 'utf8');
    if (assetlinks.includes('REPLACE_WITH_PLAY_APP_SIGNING')) {
      console.warn(
        '\nWARN  docs/.well-known/assetlinks.json still holds the placeholder fingerprint.\n' +
          '      Android App Links will NOT verify, so shared https links open the browser\n' +
          '      instead of the app. Paste the SHA-256 from Play Console -> Setup -> App\n' +
          '      integrity -> App signing key certificate.\n',
      );
    }
  } catch {
    console.warn('\nWARN  no .well-known/assetlinks.json in the build — App Links cannot verify.\n');
  }

  console.log(`marketing site: ${copied} entries copied, ${REQUIRED.length} Play paths verified`);
}

main().catch(err => {
  console.error('copy-marketing failed:', err);
  process.exit(1);
});
