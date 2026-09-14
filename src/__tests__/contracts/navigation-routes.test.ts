/**
 * Contract test over the route seam: a route declared in navigation/types.ts must be
 * registered in a navigator, and vice versa.
 *
 * `tsc` accepts navigate('X') the instant X is a key of the param list, whether or not any
 * <Stack.Screen> renders it — so half the change compiles clean and fails on the tap.
 *
 * LIMITATION: this reads source TEXT, not a mounted navigator. It cannot prove a screen
 * renders, and it cannot tell the signed-in branch from the signed-out one — a route
 * registered in a branch no user reaches still counts as registered. Proving either needs
 * a navigator that mounts under Jest, which does not exist here (see PROP-0007).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAV = join(__dirname, '../../navigation');

function read(file: string): string {
  return readFileSync(join(NAV, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function routesIn(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} = {`);
  const body = source.slice(start, source.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}([A-Za-z_]\w*)\??\s*:/gm)].map(m => m[1]);
}

function screensIn(source: string, tag: string): string[] {
  return [
    ...source.matchAll(new RegExp(`<${tag}\\.Screen[\\s\\S]{0,160}?name="(\\w+)"`, 'g')),
  ].map(m => m[1]);
}

const types = read('types.ts');

const CASES = [
  { list: 'RootStackParamList', file: 'RootNavigator.tsx', tag: 'Stack', anchor: 'App' },
  { list: 'AppTabParamList', file: 'AppNavigator.tsx', tag: 'Tab', anchor: 'Profile' },
  { list: 'AuthStackParamList', file: 'AuthNavigator.tsx', tag: 'Stack', anchor: 'SignIn' },
] as const;

describe('navigation route seam', () => {
  describe.each(CASES)('$list ↔ $file', ({ list, file, tag, anchor }) => {
    const declared = routesIn(types, list);
    const registered = screensIn(read(file), tag);

    it('parses both sides', () => {
      // Without this, a formatting change that defeats either regex leaves two empty sets
      // that compare equal, and the suite passes vacuously.
      expect(declared).toContain(anchor);
      expect(registered).toContain(anchor);
    });

    it('registers every declared route in a navigator', () => {
      expect(declared.filter(r => !registered.includes(r))).toEqual([]);
    });

    it('declares route params for every registered screen', () => {
      expect(registered.filter(r => !declared.includes(r))).toEqual([]);
    });
  });

  it('uses the native stack, never the JS stack', () => {
    for (const file of ['RootNavigator.tsx', 'AuthNavigator.tsx']) {
      const source = read(file);
      expect(source).toContain('createNativeStackNavigator');
      expect(source).not.toContain('createStackNavigator(');
    }
  });
});
