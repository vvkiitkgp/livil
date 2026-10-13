module.exports = {
  root: true,
  extends: '@react-native',

  // Livil-specific invariants, loaded from ./eslint-rules via --rulesdir in the
  // lint script. Each rule encodes something that was expensive to learn — see
  // kb/decisions/ and the private incident record.
  //
  // A rule belongs here only when its violation is (a) mechanically detectable and
  // (b) hard for a human reviewer to catch. Merely stylistic preferences belong in
  // kb/standards/coding.md as guidance, not here.
  rules: {
    'no-second-media-session': 'error',

    // `void promise();` is this codebase's marker for a deliberate fire-and-forget
    // call — the idiom @typescript-eslint/no-floating-promises accepts. The preset
    // warns on every `void`, which buried ~190 intentional uses and with them any new
    // warning worth reading. Rewriting them as `.catch(() => {})` is NOT equivalent:
    // it swallows rejections that today still reach the unhandled-rejection tracker.
    // `void` in expression position (`x = void 0`, `a ? void b() : c`) stays flagged;
    // a concise arrow body is an expression too, so write `() => { void f(); }`.
    'no-void': ['warn', { allowAsStatement: true }],
  },

  overrides: [
    {
      // Build and knowledge-base scripts are Node ESM, not React Native. They need
      // a module parser; without one, every `import` is a parse error.
      files: ['scripts/**/*.mjs'],
      parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
      env: { node: true, es2022: true },
      rules: {
        'no-second-media-session': 'off',
      },
    },
    {
      // Rule implementations are CommonJS Node modules.
      files: ['eslint-rules/**/*.js', '*.config.js'],
      parserOptions: { sourceType: 'script', ecmaVersion: 2022 },
      env: { node: true, es2022: true },
      rules: {
        'no-second-media-session': 'off',
      },
    },
  ],
};
