---
tier: 4
owner: chief-architect
consumers: [ALL]
last_verified: 2026-09-30
verify_every: 9999d
verified_by: manual
visibility: public
supersedes: []
related_adrs: [0016]
---

# ADR-0024 — Adopt the UIKit scene lifecycle on iOS

| | |
|---|---|
| **Status** | **Accepted** |
| **Date** | 2026-09-30 |
| **Domain** | platform |
| **Decided by** | Maintainer (Vamsi), after App Review rejected 2.1.0 (74) |

---

## Context

App Review rejected 2.1.0 (74) under guideline 2.1(a): the app crashed on launch on an
iPhone 17 Pro Max and an iPad Air 11-inch, both on iOS 27.0. Six crash logs, all identical:
`EXC_BREAKPOINT` on the main thread, 0.12 s after launch, top frame
`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke`. No React
Native, Hermes, Firebase or playback code had run.

Reproduced on the maintainer's iPhone after updating it to iOS 27. Xcode's console gives the
reason verbatim: *"Application failed to launch: UIScene life cycle is required for apps built
with this SDK."*

Nothing in `ios/` that touches window creation had changed. What changed was the toolchain:

| Build | Xcode | SDK | Outcome |
|---|---|---|---|
| 2.0.6 (71), 2.0.6 (72), 2.0.8 (73) | 26.5 | iOS 26.5 | Approved |
| 2.1.0 (74) | 27.0 | iOS 27.0 | Crashes on launch on iOS 27 |

iOS 27's UIKit checks whether an app linked against the iOS 27 SDK declares a
`UIApplicationSceneManifest`; if not, it traps (`brk 0`) instead of logging the runtime
issue it logged under iOS 26. The same binary runs normally on an iOS 26 device, which is why
local testing and TestFlight on the maintainer's iOS 26 phone showed nothing.

React Native 0.85.3's `RCTAppDelegate` still creates its `UIWindow` from
`didFinishLaunchingWithOptions` and has no scene-delegate support of its own. Every RN 0.85
app built with Xcode 27 hits this.

## Decision

Adopt the scene lifecycle:

- `Info.plist` declares `UIApplicationSceneManifest` with a single window-scene configuration
  whose delegate is `$(PRODUCT_MODULE_NAME).SceneDelegate`. `UIApplicationSupportsMultipleScenes`
  is `false`: multi-window is neither wanted nor compatible with the single playback engine
  (ADR-0001).
- `ios/livil/SceneDelegate.swift` owns the window. In `scene(_:willConnectTo:options:)` it
  asks `RCTAppDelegate`'s root-view factory for the React root view, builds the
  `UIWindow(windowScene:)`, and calls `makeKeyAndVisible`. It also assigns the window back to
  `RCTAppDelegate.window` for libraries that still read `UIApplication.delegate.window`.
- `AppDelegate.swift` sets `automaticallyLoadReactNativeWindow = false` before calling
  `super`, so `RCTAppDelegate` does not build a second, scene-less window. Firebase
  configuration and React host creation stay in `didFinishLaunchingWithOptions`.
- Deep links move to the scene delegate. Under the scene lifecycle UIKit never calls
  `application(_:open:options:)`; `livil://` URLs arrive via `scene(_:openURLContexts:)` at
  runtime and via `connectionOptions.urlContexts` on a cold start. The cold-start URL is
  re-packed into the launch options handed to the React host so `Linking.getInitialURL()`
  keeps working.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Rebuild 2.1.0 with Xcode 26.5 (iOS 26.5 SDK) | Works today, but Xcode 26.5 is no longer installed, and Apple will stop accepting older-SDK uploads on its usual schedule. A stopgap that must be undone later; the scene work is the same either way. |
| Wait for React Native to ship scene support | RN 0.85.3 has none, and the app is pinned (CLAUDE.md dependency table). The delegate is ~60 lines and lives entirely in `ios/livil/`. |
| Migrate off the deprecated `RCTAppDelegate` to `RCTReactNativeFactory` at the same time | Unrelated to the crash, and widens a change that is going straight to App Review. Left for a separate PR. |

## Consequences

- iOS 27 launches again. Android is untouched; nothing outside `ios/` changed.
- `application(_:open:options:)` is gone from `AppDelegate.swift`; adding it back would be
  dead code. Any future URL or user-activity handling (universal links via
  `scene(_:continue:)`) belongs in `SceneDelegate.swift`.
- Verification of the touched flows on a real iOS 27 device is now part of the release
  checklist: Google sign-in and its `livil://auth` callback, a shared `livil://post/<id>` link
  from another app, opening a push notification, and lock-screen playback.
- `-[UIApplication statusBarStyle]` is a no-op on iOS 27 (console warning at launch). The
  status bar is not part of this decision, but its light-on-dark styling should be checked on
  iOS 27 and moved to view-controller-based appearance if it regressed.

## Dissent

*None recorded.* The alternative of rebuilding with the old SDK was offered and declined by
the maintainer as a stopgap.

## Revisit when

- React Native ships first-class scene-delegate support in a version this app moves to; the
  hand-written delegate should then be replaced by the upstream one.
- The app ever needs more than one window (iPad multitasking, external display); that
  reopens ADR-0001's single-engine assumption, not just this file.

---

> **ADRs are append-only.** Do not edit an accepted ADR to reflect a new decision — write a new
> one and mark this one `Superseded by ADR-NNNN`.
