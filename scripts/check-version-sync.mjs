#!/usr/bin/env node
/**
 * Fails when CLAUDE.md's stated version disagrees with android/app/build.gradle.
 *
 * This exists because CLAUDE.md sat 21 releases out of date — claiming 1.0.27/32
 * while the app shipped 1.1.9/55 — and nothing noticed. A hand-maintained fact
 * drifts silently and always in the direction that misleads (Constitution P39/P40).
 *
 * Usage: node scripts/check-version-sync.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const gradle = readFileSync(join(REPO, 'android/app/build.gradle'), 'utf8');
const claude = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');

const actualCode = gradle.match(/versionCode\s+(\d+)/)?.[1];
const actualName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];

if (!actualCode || !actualName) {
  console.error('FAIL  could not read versionCode/versionName from build.gradle');
  process.exit(1);
}

const statedName = claude.match(/versionName\s+`([^`]+)`/)?.[1];
const statedCode = claude.match(/versionCode\s+`(\d+)`/)?.[1];

if (!statedName || !statedCode) {
  console.error(
    'FAIL  CLAUDE.md does not state a version.\n' +
    `      Expected a line containing: versionName \`${actualName}\`, versionCode \`${actualCode}\``,
  );
  process.exit(1);
}

if (statedName !== actualName || statedCode !== actualCode) {
  console.error(
    '\nFAIL  version drift between CLAUDE.md and build.gradle\n\n' +
    `        build.gradle : versionName ${actualName}  versionCode ${actualCode}\n` +
    `        CLAUDE.md    : versionName ${statedName}  versionCode ${statedCode}\n\n` +
    '      Update CLAUDE.md. Bumping the version is part of releasing; so is saying so.\n',
  );
  process.exit(1);
}

// Third copy of the same fact: src/constants/appVersion.ts is generated from
// build.gradle so the Settings footer can show a build number without pulling in
// a native module. Generated or not, it drifts the moment someone edits
// build.gradle by hand — which is exactly the failure this script exists for.
const constant = readFileSync(join(REPO, 'src/constants/appVersion.ts'), 'utf8');
const constName = constant.match(/APP_VERSION_NAME\s*=\s*'([^']+)'/)?.[1];
const constCode = constant.match(/APP_VERSION_CODE\s*=\s*(\d+)/)?.[1];

if (constName !== actualName || constCode !== actualCode) {
  console.error(
    '\nFAIL  version drift between src/constants/appVersion.ts and build.gradle\n\n' +
    `        build.gradle   : versionName ${actualName}  versionCode ${actualCode}\n` +
    `        appVersion.ts  : versionName ${constName}  versionCode ${constCode}\n\n` +
    '      Run `npm run version:sync` and commit the result.\n',
  );
  process.exit(1);
}

console.log(`PASS  version in sync: ${actualName} (${actualCode})`);
