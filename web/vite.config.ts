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
  plugins: [
    react(),
    /**
     * Send `/` to `/studio/` on the DEV SERVER ONLY.
     *
     * `base` applies in dev as well as in production, so the app is served at
     * `localhost:5173/studio/` and anything landing on the bare root — a bookmark, browser
     * autocomplete, a restored tab — gets Vite's "the server is configured with a public base
     * URL" placeholder instead of the app.
     *
     * Fixed by redirecting rather than by making `base` dev-only, deliberately. Dev disagreeing
     * with production about the base path is precisely what produced the `otp_expired` bug: the
     * reset link was built from the origin alone, worked at `localhost:5173/reset`, and broke
     * under `/studio/`. Dev should keep exercising the same subpath production uses.
     *
     * `apply: 'serve'` — never part of a build.
     */
    {
      name: 'livil-dev-root-redirect',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Exact root only. Anything else is a real request — an asset, an HMR socket, or a
          // deep link — and rewriting those would hide genuine 404s.
          if (req.url === '/' || req.url === '') {
            res.writeHead(302, { Location: '/studio/' });
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
    /**
     * `shared/` sits above this root, so bare imports inside it resolve against the REPO
     * root node_modules while `web/src` resolves against web's own. Deduping forces both to
     * web's copy.
     *
     * TWO SEPARATE FAILURES, and the second one hides until deploy. Locally it is a
     * correctness problem: without this the bundle ships two copies of supabase-js — two
     * auth instances racing over one localStorage session — and TypeScript rejects the two
     * class identities outright. On Vercel it is a hard build error: the Root Directory is
     * `web`, so ONLY web's dependencies are installed and the repo-root `node_modules` that
     * makes local resolution work does not exist at all. Anything imported from `shared/`
     * and missing here fails with "Rollup failed to resolve import".
     *
     * So: every bare specifier imported anywhere under `shared/` belongs on this list, not
     * merely the ones with a duplicate-instance problem. `fft.js` was added after exactly
     * that build failure. Mirrored by `paths` in tsconfig.json for the type-level view.
     */
    dedupe: ['@supabase/supabase-js', 'fft.js', 'react', 'react-dom'],
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
    /**
     * 'hidden', not true: maps are still GENERATED (so they can be uploaded to an error
     * tracker) but no `//# sourceMappingURL` comment is emitted, so browsers do not fetch
     * them and `copy-marketing` does not advertise them at a public URL.
     *
     * No secret is at stake — the anon key is public by design. What full sourcemaps publish
     * is the unminified source and its commentary: which RPC enforces what, where the ledger
     * checks live, which paths are deliberately vague. That is a map of the security model,
     * handed to anyone who opens devtools. Raised by security review of PR #127.
     */
    sourcemap: 'hidden',
  },
});
