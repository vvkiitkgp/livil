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
  /**
   * The dashboard lives at `livil-music.com/studio`, not the apex.
   *
   * The apex is what you hand to a stranger, so a static marketing page belongs there — and
   * keeping it static means it cannot be broken by a JavaScript bundle. The base path is what
   * makes asset URLs resolve under the subpath; React Router's `basename` is the matching
   * half for routes. Change one without the other and the app loads with no styles, or
   * routes 404 with the assets fine.
   */
  base: '/studio/',
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
      /**
       * Exactly the three directories above this root that are actually imported — NOT the
       * repo root.
       *
       * Allowing the root meant the dev server would serve any file in the repository over
       * `/@fs/…`, including `android/app/livil-release.keystore`. Vite's default `fs.deny`
       * covers `.env*` and `*.pem` but not `.keystore`. Localhost-only, so it needs
       * `--host` or a local attacker to reach — but the upload keystore is the one artifact
       * whose compromise permanently ends Play Store updates, so "narrow and also denied"
       * is the right posture rather than "narrow enough".
       *
       * Derived from what `shared/` re-exports: `types/database.ts` -> `lib/`,
       * `theme/colors.ts` -> `src/theme/`. Adding a re-export from elsewhere in `src/`
       * means adding it here, and the dev server will say so loudly on the first request.
       */
      allow: [
        fileURLToPath(new URL('../shared', import.meta.url)),
        fileURLToPath(new URL('../lib', import.meta.url)),
        fileURLToPath(new URL('../src/theme', import.meta.url)),
        fileURLToPath(new URL('.', import.meta.url)),
      ],
      // Belt and braces: even if `allow` is widened later by someone chasing a resolution
      // error, signing material stays unreachable.
      deny: ['**/*.keystore', '**/*.jks', '**/*.p12', '**/gradle.properties'],
    },
  },
  build: {
    // Under dist/studio/ so the marketing page can own dist/index.html without a collision.
    // `copy-marketing.mjs` fills the rest of dist/ from docs/.
    outDir: 'dist/studio',
    emptyOutDir: true,
    sourcemap: true,
  },
});
