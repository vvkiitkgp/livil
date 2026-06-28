package com.livil

import android.os.Bundle
import android.view.View
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ReactActivity() {

  // Flipped to true by SplashScreenModule.hide(), called from JS once our
  // React splash has actually painted. Until then the native splash is held,
  // covering the entire JS-bundle load with no blank gap.
  private val splashReady = AtomicBoolean(false)

  override fun onCreate(savedInstanceState: Bundle?) {
    // Must run before super.onCreate so it can swap SplashTheme -> AppTheme.
    val splash = installSplashScreen()
    super.onCreate(savedInstanceState)

    // Registered after super.onCreate so android.R.id.content exists (the
    // library hangs an OnPreDrawListener on it). The splash stays on screen
    // while this returns true.
    splash.setKeepOnScreenCondition { !splashReady.get() }

    // Safety net: if JS never boots (crash / bundle error) force-release after
    // 10s so we never hard-stick on the splash.
    window.decorView.postDelayed({ hideSplash() }, 10_000)
  }

  /** Called from the UI thread (via SplashScreenModule) to dismiss the splash. */
  fun hideSplash() {
    if (splashReady.compareAndSet(false, true)) {
      // Force a draw pass so the OnPreDrawListener re-checks the condition and
      // runs its exit animation now, rather than waiting for the next frame.
      findViewById<View>(android.R.id.content)?.let {
        it.invalidate()
        it.requestLayout()
      }
    }
  }

  override fun getMainComponentName(): String = "livil"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
