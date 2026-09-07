---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-08
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: [0005]
related_adrs: [0001, 0005, 0006]
---

# ADR-0016 — Ship iOS

| | |
|---|---|
| **Status** | **Accepted** — supersedes ADR-0005 |
| **Date** | 2026-09-08 |
| **Domain** | platform |
| **Decided by** | Maintainer (Vamsi), on buying a paid Apple Developer account |

> **ADR-0005 filed an open question and asked to be decided rather than revisited.**
> This is that decision: **Option B — Revive**. ADR-0005 is now `Superseded by
> ADR-0016` and must not be quoted as current.

---

## Context

ADR-0005 recorded, accurately, that iOS was nominally supported and practically
abandoned: no lockfile, no installed pods, no entitlements, camera and photo usage
descriptions missing despite both being used, three commits ever touching `ios/`. Its
conclusion was that **iOS would not build, and if it did it would be rejected at review
and crash on first camera access.** All of that was true.

It also observed that the ambiguity was itself the cost — agents could not tell whether
iOS regressions mattered, and every cross-platform change carried an unanswerable
question.

The maintainer bought a paid Apple Developer account (~2026-08-30) and directed that iOS
ship. That converts the open question into a decision.

## Decision

**Option B — Revive.** iOS is a supported, shipping platform. iOS regressions matter and
are not to be ignored.

Executed 2026-09-06 to 2026-09-08. **Livil Music 2.0.6 (72) is submitted to the App
Store and Waiting for Review.**

What ADR-0005 listed as the work, and what actually happened:

| ADR-0005 said | Outcome |
|---|---|
| install pods | 106 pods; `GoogleUtilities` needs `:modular_headers => true` for Firebase's Swift pods |
| add entitlements | `ios/livil/livil.entitlements`, team `FG78VP2M42` |
| add usage descriptions | camera + photo library. **Also microphone** — see below |
| finish clip parity in the now-playing manager | done; `currentClipJson` now reaches iOS |
| verify background audio and the ring switch | verified on device: audio survives the silent switch |
| confirm the decoder does not claim the audio session | confirmed — playback is unaffected by `decodeAudioData` |

Beyond that list: bundle id `org.reactjs.native.example.livil` → `com.livil`, iPhone-only,
`livil://` registered **plus** the `RCTLinkingManager` forwarder RN does not wire for you,
`FirebaseApp.configure()` (react-native-firebase does not self-configure on iOS; Android
gets it free from a Gradle plugin with no iOS equivalent), and **Sign in with Apple**,
which App Store Review guideline 4.8 makes mandatory wherever a third-party login is
offered.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Option A — formally Android-only | Forecloses roughly half the mobile market. The maintainer paid for the account; the question was settled by that, not by argument |
| Stay ambiguous | ADR-0005 already established this as the worst option |

## Consequences

**The release process is now two.** Two store pipelines, two device matrices, and roughly
double the surface a test suite would need to cover — on a codebase at ~1% coverage. ADR-0005
named this cost and it is real.

**`.claude/autonomy-config.yml` lists `ios/**` as propose-only, justified as "does not
build; status undecided (ADR-0005)".** That justification is now false in both clauses.
The entry should be re-argued on its merits or removed — it must not stand on a reason
that has expired.

**Version parity is by MARKETING_VERSION, not build number.** iOS build 71 was consumed by
a rejected upload, so iOS is at 72 while Android's versionCode is 71. Separate namespaces;
`2.0.6` is the parity users and the release process care about.

**Static checks are not evidence on this platform.** Four defects passed a clean build,
typecheck and lint and were caught only by running on a device:

* `AppleRequestOperation` / `AppleRequestScope` are `export declare enum` in the library's
  `.d.ts` with no runtime counterpart — importing them typechecks and is `undefined` at
  runtime;
* enabling `nextTrackCommand` does not surface track buttons while the skip commands stay
  enabled, so the lock screen offered ±10s seeks in a queue-based music app;
* now-playing metadata was read from an unordered array, so the title flickered between
  the app's and the file's ID3 tag four times a second;
* **ITMS-90683** rejected the first upload for a missing `NSMicrophoneUsageDescription` —
  Apple checks what the BINARY REFERENCES, not what the code calls, and
  `react-native-audio-api` links `requestRecordPermission` even though it is used only as
  a decoder.

**The iOS half of the react-native-video patch had never executed before 2026-09-06.** Its
comments are untested assertions until each is seen on a device; one of them was actively
wrong. ADR-0006 governs that patch; this is a note on its iOS half specifically.

**Still Android-only:** haptics (RN's `Vibration` ignores duration on iOS and fires the
~400ms call buzz, so `src/utils/haptics.ts` no-ops rather than shipping a jackhammer),
push notifications (no `aps-environment` entitlement; `pushNotifications.ts` early-returns
on non-Android), native background clip-end handling, and universal links.

## Dissent

None recorded. ADR-0005's own dissent note observed that the iOS-specific constraints
already documented in the playback architecture suggested real prior investment, and that
Option A would discard it. That reading was correct: the audio-session singleton
constraint and the JS-gated clip handling both proved load-bearing during the revival.

The cost ADR-0005 named — that this roughly doubles the surface an absent test suite would
need to cover — is not answered by this decision. It is accepted, not resolved.

## Revisit when

Not a decision to revisit. Revisit the **cost**: if iOS-specific regressions start
reaching users, the answer is coverage on the shared seams, not a return to ambiguity.
