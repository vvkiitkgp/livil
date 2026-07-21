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

Losing the keystore or its passwords means **this listing can never be updated again**. See
[runbooks/keystore-recovery.md](runbooks/keystore-recovery.md).

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

## The marketing site

`livil-music.com` is served by GitHub Pages from `main/docs`. **A push to `main` that touches
`docs/` publishes immediately** — no review, no staging. Treat edits there as publishing, not
committing.

---

## What is missing

Recorded so the gap is deliberate rather than invisible:

- **No CI.** Nothing verifies a commit.
- **No release automation.** Every step is manual, on one machine.
- **No staged rollout or release health monitoring.** With no crash reporting, a bad release is
  discovered from user reports.
- **No rollback path.** Play can halt a rollout, but there is no automated revert.
- **No reproducible build environment.** It builds on one laptop with a particular toolchain.
- **Version bump is not enforced.**

## Related

- [infrastructure.md](infrastructure.md) — what it deploys to
- [runbooks/keystore-recovery.md](runbooks/keystore-recovery.md) — the unrecoverable risk
- [runbooks/incident-response.md](runbooks/incident-response.md) — when a release goes wrong
