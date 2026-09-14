#!/usr/bin/env node
/**
 * Bumps the Android release version and mirrors it into a TS constant.
 *
 * `android/app/build.gradle` is the single source of truth for the app version
 * — but Metro cannot read a .gradle file, so the Settings screen's version
 * footer needs a JS-visible copy. Rather than add `react-native-device-info`
 * (a native module, which CLAUDE.md gates behind an RN 0.85 + Fabric
 * compatibility check), we generate `src/constants/appVersion.ts` from the
 * gradle file and commit it.
 *
 * Two modes:
 *   node scripts/bump-version.mjs         → bump patch + versionCode, then sync
 *   node scripts/bump-version.mjs --sync  → sync only, no bump
 *
 * `--sync` is what CI runs to assert the committed constant has not drifted
 * from build.gradle.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRADLE = path.join(ROOT, 'android/app/build.gradle');
const CONSTANT = path.join(ROOT, 'src/constants/appVersion.ts');

const syncOnly = process.argv.includes('--sync');

let gradle = fs.readFileSync(GRADLE, 'utf8');

if (!syncOnly) {
  gradle = gradle
    .replace(/versionCode (\d+)/, (_m, code) => `versionCode ${+code + 1}`)
    .replace(
      /versionName "(\d+\.\d+\.)(\d+)"/,
      (_m, prefix, patch) => `versionName "${prefix}${+patch + 1}"`,
    );
  fs.writeFileSync(GRADLE, gradle);
}

const codeMatch = gradle.match(/versionCode (\d+)/);
const nameMatch = gradle.match(/versionName "([^"]+)"/);
if (!codeMatch || !nameMatch) {
  console.error('[version] could not parse versionCode/versionName from build.gradle');
  process.exit(1);
}
const versionCode = Number(codeMatch[1]);
const versionName = nameMatch[1];

const generated = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Mirrors versionName/versionCode from android/app/build.gradle, which is the
 * source of truth. Regenerate with \`npm run version:sync\`; the release bump
 * (\`npm run prebuild:android\`) rewrites it automatically.
 */
export const APP_VERSION_NAME = '${versionName}';
export const APP_VERSION_CODE = ${versionCode};

/** Rendered in the Settings footer, e.g. "Livil v1.1.13 (59)". */
export const APP_VERSION_LABEL = \`Livil v\${APP_VERSION_NAME} (\${APP_VERSION_CODE})\`;
`;

const existing = fs.existsSync(CONSTANT) ? fs.readFileSync(CONSTANT, 'utf8') : null;

if (syncOnly && existing !== generated) {
  fs.writeFileSync(CONSTANT, generated);
  console.error(
    `[version] src/constants/appVersion.ts was stale — regenerated to ${versionName} (${versionCode}). Commit it.`,
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(CONSTANT), { recursive: true });
fs.writeFileSync(CONSTANT, generated);
console.log(`[version] versionName "${versionName}" versionCode ${versionCode}`);
