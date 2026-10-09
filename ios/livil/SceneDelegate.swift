import UIKit
import React
import React_RCTAppDelegate

// The app's one window scene. Registered in Info.plist under UIApplicationSceneManifest.
//
// Why this exists: the iOS 27 SDK makes the scene lifecycle mandatory. An app built with
// Xcode 27 that still lets UIApplicationDelegate own the window is trapped by UIKit at
// launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption -> brk 0),
// 0.1 s in, before any React Native code runs. App Review rejected 2.1.0 (74) with six
// identical crash logs for exactly that.
//
// What moved here from RCTAppDelegate.loadReactNativeWindow: creating the UIWindow (now
// bound to the UIWindowScene), the root view controller, and makeKeyAndVisible. The React
// host, module registry, Firebase and everything else still initialise in
// AppDelegate.didFinishLaunchingWithOptions; AppDelegate sets
// automaticallyLoadReactNativeWindow = false so RCTAppDelegate does not ALSO build a
// scene-less window (which would be a second, invisible window fighting this one).
//
// Deep links also move here: in a scene-based app UIKit delivers `livil://…` URLs through
// scene(_:openURLContexts:) and, on a cold start, through
// connectionOptions.urlContexts — application(_:open:options:) is never called. Both are
// forwarded to RCTLinkingManager, which is what Linking.addEventListener('url') and
// Linking.getInitialURL() read on the JavaScript side (email confirmation, password
// reset, the Google sign-in callback `livil://auth`, shared posts `livil://post/<id>`,
// profiles `livil://profile/<handle>`). Universal Links (the https forms) arrive as user
// activities instead — see scene(_:continue:) below.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      fatalError("SceneDelegate expects AppDelegate to be the UIApplicationDelegate")
    }

    // A cold start from a deep link arrives here, not in didFinishLaunchingWithOptions.
    // RCTLinkingManager.getInitialURL reads UIApplicationLaunchOptionsURLKey from the
    // launch options handed to the React host, so rebuild that dictionary from the
    // scene's connection options.
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    } else if let url = connectionOptions.userActivities
      .first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })?.webpageURL {
      // A cold start from a Universal Link (https://livil-music.com/p/<id> or /@<handle>)
      // arrives as a browsing-web user activity rather than a URL context. Passed the
      // same way, so Linking.getInitialURL() sees it like any other launch URL.
      launchOptions[.url] = url
    }

    let rootView = appDelegate.reactNativeFactory.rootViewFactory.view(
      withModuleName: appDelegate.moduleName ?? "livil",
      initialProperties: appDelegate.initialProps,
      launchOptions: launchOptions
    )

    let window = UIWindow(windowScene: windowScene)
    let rootViewController = appDelegate.createRootViewController()
    appDelegate.setRootView(rootView, toRootViewController: rootViewController)
    window.rootViewController = rootViewController

    self.window = window
    // Keep RCTAppDelegate.window pointing at the real window: RCTKeyWindow() walks the
    // connected scenes so it does not need this, but any library still reading
    // UIApplication.shared.delegate.window (older RN modules do) would otherwise get nil.
    appDelegate.window = window
    window.makeKeyAndVisible()
  }

  // `livil://…` opened while the app is running or backgrounded.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // A Universal Link (https://livil-music.com/p/<id> or /@<handle>) opened while the app
  // is running or backgrounded. Needs the Associated Domains entitlement in
  // livil.entitlements AND docs/.well-known/apple-app-site-association served from the
  // domain — without either, iOS opens Safari and this is never called. RCTLinkingManager
  // turns the activity's webpageURL into the same Linking 'url' event a livil:// link is.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb else { return }
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
