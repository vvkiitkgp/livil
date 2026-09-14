---
tier: 3
owner: principal-platform
consumers: [DO, P-PF]
last_verified: 2026-07-21
verify_every: 90d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Deployment

How a release actually reaches users. The process is entirely manual and this document
describes it as it is, not as it should be.

---

## The process

```bash
npm run prebuild:android     # bumps versionCode and the versionName patch digit
npm run build:android        # cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
# → upload by hand in Play Console → Closed testing → Create new release
```

That is the whole pipeline. **Nothing gates it.** No tests run, no lint, no type check, no
verification that the artifact is signed correctly. A release with a type error, a failing
test, or a broken migration reaches the store exactly as easily as a good one.

`prebuild:android` is **not chained** to `build:android`, so the version bump remains a
manual, forgettable step. A duplicate versionCode is rejected by Play *after* the build and
upload — the slowest possible place to find out.

---

## Signing

Release signing reads four properties from the user-level Gradle config, outside the
repository. The keystore itself is gitignored.

**The signing block is wrapped in a `hasProperty` check, so it fails open.** If the properties
are missing, Gradle does not error — it produces an **unsigned** bundle. Play rejects it, but
the build reports success, and the failure surfaces late and confusingly.

Losing the keystore or its passwords blocks releases until Google approves an **upload key
reset** — days, not permanent. Play App Signing is enrolled, so Google holds the actual app
signing key. See [runbooks/keystore-recovery.md](runbooks/keystore-recovery.md).

---

## Before releasing

No automation enforces any of this. It is a checklist because it currently has to be.

1. `npx tsc --noEmit` — clean
2. `npm run lint` — clean
3. `npm run kb:validate` — clean
4. Migrations applied to the hosted project, if the release depends on them
5. **A signed build produced from a keystore you have verified you can restore**
6. Install the release bundle on a real device and exercise: playback with the screen locked,
   lock-screen controls, upload, and sign-in
7. Bump versionCode **and** versionName

Step 6 matters more than it looks. The riskiest parts of this app — the media session, native
auto-advance, background behaviour — **cannot be exercised by any automated check that exists
today**, and several only misbehave in release builds or when backgrounded.

---

## Native changes need a full rebuild

**A Metro reload does not pick up native code.** After any change under
`node_modules/react-native-video/`, or to the patch, or to anything in `android/`:

```bash
npx patch-package react-native-video --include '^(ios/|android/src/|src/|lib/)'
cd android && ./gradlew clean && ./gradlew bundleRelease
```

Skipping the rebuild produces a build that appears to work and silently contains the old native
code. See [../architecture/playback.md](../architecture/playback.md).

---

## Known build hazards

| Symptom | Cause | Fix |
|---|---|---|
| Bundling hangs at 0% | Watchman stalls crawling this project | Watchman is disabled in the Metro config; `fix-android-build.sh` clears stale state |
| "No space left on device" | Gradle caches and native build output grow to several GB | Clear caches; `./gradlew clean` |
| Wrong Java version | Toolchain expects Java 17 | Select Java 17 |
| Version code already used | Manual bump was skipped | Bump and rebuild |
| Native change has no effect | Metro reload instead of a native rebuild | Full `./gradlew` rebuild |

---

## The web surface — marketing site and creator dashboard

Since **2026-08-05**, `livil-music.com` is served by **Vercel**, not GitHub Pages
([ADR-0015](../decisions/0015-web-creator-dashboard.md)). One project, one build, two surfaces:

| URL | What | Built from |
|---|---|---|
| `livil-music.com/` | marketing page | `docs/`, copied in by `web/scripts/copy-marketing.mjs` |
| `livil-music.com/studio` | creator dashboard | `web/`, a Vite SPA |

**A push to `main` deploys both immediately** — no review, no staging, no approval. That
applies to `docs/` and to `web/`. Treat edits to either as publishing, not committing.

Vercel project settings that are load-bearing and not in the repo:

- **Root directory `web/`**, with *include files outside the root* enabled — `shared/` and
  `docs/` both live above it.
- **`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`**, scoped to Production. Vite inlines
  these at **build** time, so changing them requires a redeploy, and a malformed value fails at
  request time rather than at build. Verify the bytes of the deployed bundle, not the field in
  the dashboard.

Everything else — SPA rewrite, security headers, cache policy, the build command — is in
`web/vercel.json` and is reviewable.

**GitHub Pages is still published**, deliberately. Three URLs registered in the Play Console
(privacy policy, child safety, account deletion) were pointing at
`vvkiitkgp.github.io/livil/…`, which redirects to the apex only while Pages and its custom
domain are configured. Pages retires once the Play declarations naming `livil-music.com` clear
review. **Do not press "Remove" on the custom domain** — that is what generates the redirect;
"Unpublish site" is the intended action, and only after review lands.

---

## What is missing

Recorded so the gap is deliberate rather than invisible:

- **CI verifies commits but does not ship anything.** Eight jobs run on every push
  ([infrastructure.md](infrastructure.md)) — typecheck, lint, tests, migrations, schema parity
  against production, knowledge-base drift and the agent-scope gates. None of them builds an
  AAB, signs it, or uploads to Play. The **web** deploy is the exception and is fully
  automated: a push to `main` publishes both surfaces via Vercel.
- **No Android release automation.** Every step is manual, on one machine.
- **No staged rollout or release health monitoring.** With no crash reporting, a bad release is
  discovered from user reports.
- **No rollback path.** Play can halt a rollout, but there is no automated revert.
- **No reproducible build environment.** It builds on one laptop with a particular toolchain.
- **Version bump is not enforced.**

## Related

- [infrastructure.md](infrastructure.md) — what it deploys to
- [runbooks/keystore-recovery.md](runbooks/keystore-recovery.md) — upload key backup and reset
- [runbooks/incident-response.md](runbooks/incident-response.md) — when a release goes wrong
