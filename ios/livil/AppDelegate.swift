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

    // The window belongs to SceneDelegate.swift (scene lifecycle, mandatory under the
    // iOS 27 SDK — see the UIApplicationSceneManifest comment in Info.plist). Left at its
    // default, RCTAppDelegate would build a second, scene-less UIWindow here, and UIKit
    // would still trap the launch because the manifest is what it checks, not the window.
    // super still creates the React host, module registry and root-view factory; the
    // scene delegate asks that factory for the root view once the window scene connects.
    self.automaticallyLoadReactNativeWindow = false

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Deep links (`livil://auth`, `livil://post/<id>`) are handled in SceneDelegate.swift:
  // under the scene lifecycle UIKit never calls application(_:open:options:), so an
  // override here would be dead code. The scheme itself stays registered in Info.plist
  // under CFBundleURLTypes; both halves are required.
  //
  // Universal links (https://livil-music.com/p/<id> and /@<handle>, the iOS twin of the
  // Android App Links in AndroidManifest.xml) are handled there too, in
  // scene(_:continue:), backed by the Associated Domains entitlement in livil.entitlements
  // and docs/.well-known/apple-app-site-association on the web host.

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
