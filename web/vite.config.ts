import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite config for the creator dashboard.
 *
 * `web/` is deliberately NOT an npm workspace (ADR-0015): it carries its own
 * `node_modules` so that nothing here can perturb the React Native dependency tree, which
 * depends on an exact-pinned, natively patched `react-native-video` and on Gradle
 * autolinking resolving paths inside the root `node_modules`.
 *
 * The cost of that isolation is that `shared/` sits outside this project root, so both the
 * alias and `server.fs.allow` below are required — Vite refuses to serve files above the
 * root by default.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
    // `shared/` sits above this root, so bare imports inside it resolve against the REPO
    // root node_modules while `web/src` resolves against web's own. Without deduping,
    // the bundle would ship two copies of supabase-js — two auth instances racing over
    // the same localStorage session — and TypeScript rejects the two class identities
    // outright. Mirrored by `paths` in tsconfig.json for the type-level view.
    dedupe: ['@supabase/supabase-js', 'react', 'react-dom'],
  },
  server: {
    fs: {
      // shared/ (and the lib/ + src/theme/ files it re-exports) live above this root.
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
