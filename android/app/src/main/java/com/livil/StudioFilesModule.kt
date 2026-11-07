package com.livil

import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.concurrent.thread

/**
 * On-device storage for Editor drafts (ADR-0036 §9). Drafts never leave the phone.
 *
 * Everything lives under `noBackupFilesDir/studio/` — app-private, and never in an Android
 * backup — so "drafts are only on this phone, and uninstalling deletes them" is true. Callers
 * pass paths RELATIVE to that root; anything absolute, with "." or "..", or that resolves
 * outside the root is rejected. Same API as ios/livil/LivilStudioFiles.m; JS side:
 * src/services/studioFiles.ts. Legacy module; resolves through the TurboModule interop layer,
 * and @ReactMethods run on the native-modules thread, off the UI thread.
 */
class StudioFilesModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "LivilStudioFiles"

  private val root: File
    get() = File(reactApplicationContext.noBackupFilesDir, "studio")

  /** The file for `rel` inside the root, or null when `rel` is not a safe relative path. */
  private fun resolve(rel: String): File? {
    if (rel.isEmpty() || rel.startsWith("/")) return null
    if (rel.split("/").any { it.isEmpty() || it == "." || it == ".." }) return null
    val base = root.canonicalFile
    val file = File(base, rel).canonicalFile
    return if (file.path.startsWith(base.path + File.separator)) file else null
  }

  private inline fun withPath(rel: String, promise: Promise, block: (File) -> Unit) {
    val file = resolve(rel) ?: return promise.reject("E_PATH", "Not a path inside the drafts folder")
    try {
      block(file)
    } catch (e: Exception) {
      promise.reject("E_IO", e.message, e)
    }
  }

  @ReactMethod
  fun root(promise: Promise) {
    root.mkdirs()
    promise.resolve(root.absolutePath)
  }

  @ReactMethod
  fun writeBase64(rel: String, data: String, append: Boolean, promise: Promise) =
      withPath(rel, promise) { file ->
        file.parentFile?.mkdirs()
        FileOutputStream(file, append).use { it.write(Base64.decode(data, Base64.DEFAULT)) }
        promise.resolve(true)
      }

  @ReactMethod
  fun writeText(rel: String, text: String, promise: Promise) =
      withPath(rel, promise) { file ->
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        promise.resolve(true)
      }

  @ReactMethod
  fun readText(rel: String, promise: Promise) =
      withPath(rel, promise) { file -> promise.resolve(file.readText()) }

  @ReactMethod
  fun listDirs(rel: String, promise: Promise) =
      withPath(rel, promise) { dir ->
        val out = Arguments.createArray()
        dir.listFiles()?.filter { it.isDirectory }?.forEach { out.pushString(it.name) }
        promise.resolve(out)
      }

  @ReactMethod
  fun move(fromRel: String, toRel: String, promise: Promise) {
    val from = resolve(fromRel) ?: return promise.reject("E_PATH", "Not a path inside the drafts folder")
    val to = resolve(toRel) ?: return promise.reject("E_PATH", "Not a path inside the drafts folder")
    try {
      if (to.exists()) to.deleteRecursively()
      if (!from.renameTo(to)) return promise.reject("E_MOVE", "Could not move the draft")
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_IO", e.message, e)
    }
  }

  @ReactMethod
  fun remove(rel: String, promise: Promise) =
      withPath(rel, promise) { file -> promise.resolve(file.exists() && file.deleteRecursively()) }

  /**
   * A picked file (`file://` or `content://`) into the drafts folder, on disk, so a long video
   * never crosses the bridge. Only `toRel` has to be inside the root. On its own thread: a big
   * copy must not hold up every other native module.
   */
  @ReactMethod
  fun copyIn(fromUri: String, toRel: String, promise: Promise) {
    val to = resolve(toRel) ?: return promise.reject("E_PATH", "Not a path inside the drafts folder")
    thread {
      val tmp = File(to.parentFile, to.name + ".tmp")
      try {
        to.parentFile?.mkdirs()
        val input = reactApplicationContext.contentResolver.openInputStream(Uri.parse(fromUri))
            ?: throw IOException("Could not read the file")
        input.use { source -> FileOutputStream(tmp).use { source.copyTo(it) } }
        if (!tmp.renameTo(to)) { to.delete(); tmp.renameTo(to) }
        promise.resolve(true)
      } catch (e: Exception) {
        tmp.delete()
        promise.reject("E_IO", e.message, e)
      }
    }
  }

  @ReactMethod
  fun freeBytes(promise: Promise) {
    promise.resolve(reactApplicationContext.noBackupFilesDir.usableSpace.toDouble())
  }
}
