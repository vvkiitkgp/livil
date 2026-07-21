module.exports = {
  preset: '@react-native/jest-preset',

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
