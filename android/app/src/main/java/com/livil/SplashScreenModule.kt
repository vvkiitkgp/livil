package com.livil

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Bridges JS -> native so the React layer can dismiss the cold-start splash
 * the moment it has actually painted its first frame. Held until then, the
 * native splash covers the whole JS-bundle load with no blank gap.
 *
 * Legacy module; resolves through the New-Arch TurboModule interop layer.
 */
class SplashScreenModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "SplashScreen"

  @ReactMethod
  fun hide() {
    val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
    activity.runOnUiThread { activity.hideSplash() }
  }
}
