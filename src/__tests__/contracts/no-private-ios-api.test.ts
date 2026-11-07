/**
 * The blur library is patched so it never reaches a private Apple API: upstream calls the
 * `variableBlur` filter by names spelled backwards, which App Review can reject (guideline 2.5.1).
 * If an upgrade or a lost patch brings that back, this fails before a build reaches review.
 *
 * LIMITATION: this reads the package's iOS source for the ways private API gets reached. It cannot
 * prove the absence of some other private call under a name it does not look for.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const IOS = join(__dirname, '../../../node_modules/@sbaiahmed1/react-native-blur/ios');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(swift|mm?|h)$/.test(name) ? [path] : [];
  });
}

it('finds the package to check', () => {
  expect(sourceFiles(IOS).length).toBeGreaterThan(0);
});

it.each(['NSClassFromString', 'NSSelectorFromString', 'retliFAC', '.reversed()', 'CAFilter', 'inputMaskImage'])(
  'nothing in the blur library uses %s',
  needle => {
    expect(sourceFiles(IOS).filter(file => readFileSync(file, 'utf8').includes(needle))).toEqual([]);
  },
);
