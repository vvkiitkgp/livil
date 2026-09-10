import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore

@main
class AppDelegate: RCTAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    // Firebase must be configured BEFORE any React Native code runs: initPush() in
    // RootNavigator calls getMessaging() with no platform guard, and that throws when no
    // default FirebaseApp exists — so a missing configure() is a launch crash, not a
    // degraded push experience.
    //
    // react-native-firebase does NOT do this for you on iOS. RNFBAppModule only calls
    // [FIRApp registerLibrary:] (RNFBAppModule.m:58) and otherwise configures on demand
    // from JS. Android gets configuration for free from the google-services Gradle plugin
    // reading google-services.json; there is no iOS equivalent of that plugin.
    //
    // Reads ios/livil/GoogleService-Info.plist, which MUST be in the app target's
    // "Copy Bundle Resources" phase — without it this call aborts at launch.
    FirebaseApp.configure()

    self.moduleName = "livil"
    self.dependencyProvider = RCTAppDependencyProvider()

    // You can add your custom initial props in the dictionary below.
    // They will be passed down to the ViewController used by React Native.
    self.initialProps = [:]

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Deep links. RCTAppDelegate DECLARES this method (hence `override`) but does not forward
  // it to RCTLinkingManager, so without this a `livil://` URL launches the app and is then
  // dropped on the floor — JavaScript's Linking listener never fires. That silently breaks
  // email confirmation, password reset and the Google sign-in callback (all
  // `redirectTo: 'livil://auth'`, see src/services/googleAuth.ts) plus shared post links
  // (`livil://post/<id>`). The scheme itself is registered in Info.plist under
  // CFBundleURLTypes; both halves are required.
  //
  // Universal links (https://livil-music.com/p/<id>, the iOS twin of the Android App Link
  // already in AndroidManifest.xml) additionally need `continueUserActivity` here, an
  // Associated Domains entitlement, and an apple-app-site-association file served by the
  // web host. That is a follow-up; the custom scheme covers auth today.
  override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
