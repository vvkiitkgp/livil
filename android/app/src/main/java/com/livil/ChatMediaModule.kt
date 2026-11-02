package com.livil

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.io.File
import java.io.FileInputStream

/**
 * Disappearing chat photos (PROP-0011) on Android.
 *
 * setSecure — FLAG_SECURE on the Activity window while a photo is open: screenshots are
 * refused, screen recordings and casting show black, and the Recents thumbnail is blanked.
 * The viewer is a navigation screen (a fragment in this window), never an RN Modal (its own
 * Dialog window, which this flag would not cover).
 *
 * saveToPhotos — copies a local photo file into Pictures/Livil through MediaStore. Android 10+
 * needs no permission for that; Android 7–9 needs WRITE_EXTERNAL_STORAGE, which the JS side asks
 * for first (declared, up to API 29, by react-native-image-crop-picker's manifest — a second
 * declaration here fails the manifest merge).
 *
 * Same API as ios/livil/LivilChatMedia.m (where capture is blocked per view instead); JS side:
 * src/native/chatMediaKit.ts. Legacy module through the TurboModule interop layer.
 */
class ChatMediaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "LivilChatMedia"

  @ReactMethod
  fun setSecure(secure: Boolean) {
    UiThreadUtil.runOnUiThread {
      val window = reactApplicationContext.currentActivity?.window ?: return@runOnUiThread
      if (secure) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
  }

  @ReactMethod
  fun saveToPhotos(uri: String, promise: Promise) {
    val path = Uri.parse(uri).takeIf { it.scheme == "file" }?.path
    val source = path?.let { File(it) }
    if (source == null || !source.isFile) {
      promise.reject("E_FILE", "There is no photo file to save")
      return
    }
    val resolver = reactApplicationContext.contentResolver
    val name = "Livil_${System.currentTimeMillis()}.jpg"
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.Images.Media.DISPLAY_NAME, name)
          put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
          put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Livil")
          put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val target = resolver.insert(
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
        if (target == null) {
          promise.reject("E_SAVE", "Could not save the photo")
          return
        }
        try {
          val out = resolver.openOutputStream(target) ?: throw IllegalStateException("No output stream")
          out.use { stream -> FileInputStream(source).use { it.copyTo(stream) } }
          // Visible to the gallery only once the bytes are all there.
          resolver.update(target, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
          resolver.delete(target, null, null)
          throw e
        }
      } else {
        @Suppress("DEPRECATION")
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Livil")
        dir.mkdirs()
        val out = File(dir, name)
        source.copyTo(out, overwrite = true)
        // Announce it, so the gallery shows it without a rescan.
        @Suppress("DEPRECATION")
        val values = ContentValues().apply {
          put(MediaStore.Images.Media.DATA, out.absolutePath)
          put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
          put(MediaStore.Images.Media.DISPLAY_NAME, name)
        }
        resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_SAVE", e.message ?: "Could not save the photo", e)
    }
  }
}
