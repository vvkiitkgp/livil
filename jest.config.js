module.exports = {
  preset: '@react-native/jest-preset',

  // supabase/functions/** are Deno edge functions with their own Deno test runner
  // (jsr: imports, Deno globals). Jest must not discover *.test.ts there, or it fails
  // trying to resolve `jsr:@std/assert`. They are tested with `deno test`, not Jest.
  //
  // .claude/worktrees/** are agent git worktrees nested inside the repo. Each is a full
  // checkout of src/, so Jest discovers and re-runs every suite once per live worktree.
  // They have no node_modules of their own (git worktrees don't get one), so the
  // native-prop-seam contract test — which resolves react-native-video relative to its
  // own __dirname — throws "the patch may not have applied" in each copy. That is a
  // false alarm about the checkout it is running in, not about the patch.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/supabase/functions/',
    '/\\.claude/worktrees/',
  ],

  // Several dependencies ship untranspiled ESM. Jest does not transform anything
  // under node_modules by default, so importing them fails with
  // "SyntaxError: Unexpected token 'export'". Each entry below is a package that
  // actually caused a failure — do not widen this speculatively, since every
  // addition slows the suite.
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      [
        '(jest-)?react-native',
        '@react-native',
        '@react-native-community',
        '@react-navigation',
        'react-native-.*',
        '@notifee/.*',
        '@react-native-firebase/.*',
        'phosphor-react-native',
        'lucide-react-native',
        '@supabase/.*',
      ].join('|') +
      ')/)',
  ],

  // Report coverage on code we own. Thresholds are deliberately NOT set yet — see
  // kb/standards/testing.md. A threshold set before there is a suite to measure
  // becomes a number that gets lowered rather than met.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/assets/**',
  ],
};
