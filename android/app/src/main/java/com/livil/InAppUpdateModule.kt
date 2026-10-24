package com.livil

import android.app.Activity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallException
import com.google.android.play.core.install.InstallState
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Google Play In-App Updates (`com.google.android.play:app-update`) for the update prompt
 * (src/components/AppUpdatePrompt.tsx, via src/native/playInAppUpdate.ts).
 *
 * Deliberately thin: it reports what Play knows and starts the flow JS asks for. Every
 * decision — which flow for which policy row, and when to fall back to the Play Store
 * listing — is made in JS (src/services/appUpdate.ts), where it is unit-tested.
 *
 * Everything is reported as strings, mapped here from Google's constants, so JS never
 * hard-codes Play's integer values. Any failure REJECTS — notably on a build not installed
 * from Google Play (debug / sideloaded: InstallErrorCode.ERROR_APP_NOT_OWNED) or a device
 * without the Play Store — and JS treats every rejection as "use the store listing".
 *
 * Install-state events are only listened for while JS is subscribed (addListener /
 * removeListeners), i.e. while a background download is under way, so nothing is
 * registered with Play for the vast majority of sessions.
 *
 * Legacy module; resolves through the New-Arch TurboModule interop layer, like
 * SplashScreenModule.
 */
class InAppUpdateModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  private val manager: AppUpdateManager by lazy {
    AppUpdateManagerFactory.create(reactApplicationContext)
  }

  private var listenerCount = 0

  private val stateListener =
      object : InstallStateUpdatedListener {
        override fun onStateUpdate(state: InstallState) {
          if (!reactApplicationContext.hasActiveReactInstance()) return
          val event: WritableMap = Arguments.createMap()
          event.putString("installStatus", installStatusName(state.installStatus()))
          event.putDouble("bytesDownloaded", state.bytesDownloaded().toDouble())
          event.putDouble("totalBytesToDownload", state.totalBytesToDownload().toDouble())
          reactApplicationContext.emitDeviceEvent(STATE_EVENT, event)
        }
      }

  override fun getName() = NAME

  /** What Play knows about an update for this install. Rejects when Play can't be asked. */
  @ReactMethod
  fun check(promise: Promise) {
    try {
      manager.appUpdateInfo
          .addOnSuccessListener { info -> promise.resolve(describe(info)) }
          .addOnFailureListener { e -> promise.reject(errorCode(e), e.message, e) }
    } catch (e: Exception) {
      promise.reject(errorCode(e), e.message, e)
    }
  }

  /**
   * Starts Play's "flexible" (background download) or "immediate" (full-screen) flow.
   * Resolves with what the person did: "accepted" | "cancelled" | "failed", or
   * "unavailable" when Play will not run that flow right now. An immediate update already
   * in progress (left half-way through) is RESUMED, as Google requires.
   *
   * Fetches a fresh AppUpdateInfo every time: Play allows each instance to start one flow.
   */
  @ReactMethod
  fun start(mode: String, promise: Promise) {
    val type =
        when (mode) {
          "flexible" -> AppUpdateType.FLEXIBLE
          "immediate" -> AppUpdateType.IMMEDIATE
          else -> {
            promise.reject("E_BAD_MODE", "Unknown update mode: $mode")
            return
          }
        }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity to start the update from")
      return
    }
    try {
      manager.appUpdateInfo
          .addOnSuccessListener { info ->
            val options = AppUpdateOptions.defaultOptions(type)
            val availability = info.updateAvailability()
            val resuming =
                type == AppUpdateType.IMMEDIATE &&
                    availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
            val startable =
                availability == UpdateAvailability.UPDATE_AVAILABLE &&
                    info.isUpdateTypeAllowed(options)
            if (!resuming && !startable) {
              promise.resolve("unavailable")
              return@addOnSuccessListener
            }
            manager
                .startUpdateFlow(info, activity, options)
                .addOnSuccessListener { resultCode ->
                  promise.resolve(
                      when (resultCode) {
                        Activity.RESULT_OK -> "accepted"
                        Activity.RESULT_CANCELED -> "cancelled"
                        // ActivityResult.RESULT_IN_APP_UPDATE_FAILED, or anything new.
                        else -> "failed"
                      })
                }
                .addOnFailureListener { e -> promise.reject(errorCode(e), e.message, e) }
          }
          .addOnFailureListener { e -> promise.reject(errorCode(e), e.message, e) }
    } catch (e: Exception) {
      promise.reject(errorCode(e), e.message, e)
    }
  }

  /**
   * Installs a DOWNLOADED flexible update. Play shows its own full-screen "installing" UI
   * and restarts the app, so on success this promise usually never settles.
   */
  @ReactMethod
  fun completeUpdate(promise: Promise) {
    try {
      manager
          .completeUpdate()
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { e -> promise.reject(errorCode(e), e.message, e) }
    } catch (e: Exception) {
      promise.reject(errorCode(e), e.message, e)
    }
  }

  // NativeEventEmitter's subscription protocol. The Play listener is registered only while
  // at least one JS subscriber exists.
  @ReactMethod
  @Synchronized
  fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {
    if (listenerCount++ == 0) manager.registerListener(stateListener)
  }

  @ReactMethod
  @Synchronized
  fun removeListeners(count: Double) {
    if (listenerCount == 0) return
    listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
    if (listenerCount == 0) manager.unregisterListener(stateListener)
  }

  @Synchronized
  override fun invalidate() {
    if (listenerCount > 0) manager.unregisterListener(stateListener)
    listenerCount = 0
    super.invalidate()
  }

  private fun describe(info: AppUpdateInfo): WritableMap {
    val map = Arguments.createMap()
    map.putString(
        "availability",
        when (info.updateAvailability()) {
          UpdateAvailability.UPDATE_AVAILABLE -> "available"
          UpdateAvailability.UPDATE_NOT_AVAILABLE -> "not_available"
          UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> "in_progress"
          else -> "unknown"
        })
    map.putString("installStatus", installStatusName(info.installStatus()))
    map.putBoolean(
        "flexibleAllowed",
        info.isUpdateTypeAllowed(AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE)))
    map.putBoolean(
        "immediateAllowed",
        info.isUpdateTypeAllowed(AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE)))
    map.putInt("availableVersionCode", info.availableVersionCode())
    return map
  }

  private fun installStatusName(status: Int): String =
      when (status) {
        InstallStatus.PENDING -> "pending"
        InstallStatus.DOWNLOADING -> "downloading"
        InstallStatus.DOWNLOADED -> "downloaded"
        InstallStatus.INSTALLING -> "installing"
        InstallStatus.INSTALLED -> "installed"
        InstallStatus.FAILED -> "failed"
        InstallStatus.CANCELED -> "canceled"
        else -> "unknown"
      }

  private fun errorCode(e: Exception): String =
      (e as? InstallException)?.let { "E_INSTALL_${it.errorCode}" } ?: "E_IN_APP_UPDATE"

  companion object {
    const val NAME = "LivilInAppUpdate"
    /** Must match STATE_EVENT in src/native/playInAppUpdate.ts. */
    const val STATE_EVENT = "LivilInAppUpdateState"
  }
}
