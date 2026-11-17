package expo.modules.screentime

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

/**
 * Reads how long each app was in the foreground, from Android's own usage events
 * (the same source as Digital Wellbeing). Everything stays on the device.
 */
class ScreenTimeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val iconCache = HashMap<String, String?>()

  override fun definition() = ModuleDefinition {
    Name("ScreenTime")

    Function("hasAccess") { hasAccess() }

    Function("openAccessSettings") {
      val withPackage = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(withPackage)
      } catch (e: Exception) {
        context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    AsyncFunction("getUsageAsync") { startMs: Double, endMs: Double ->
      if (!hasAccess()) throw Exceptions.MissingPermissions("android.permission.PACKAGE_USAGE_STATS")
      readUsage(startMs.toLong(), endMs.toLong())
    }

    AsyncFunction("getIconAsync") { packageName: String -> icon(packageName) }
  }

  private fun hasAccess(): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun homePackages(): Set<String> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    return context.packageManager.queryIntentActivities(intent, 0).map { it.activityInfo.packageName }.toSet()
  }

  private class Totals {
    var foregroundMs = 0L
    var opens = 0
    var lastUsed = 0L
  }

  private fun readUsage(startMs: Long, endMs: Long): Map<String, Any?> {
    val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    // Start a little earlier so an app already open at `startMs` is seen being resumed.
    val events = manager.queryEvents(startMs - 3 * 3600_000L, endMs)
    val totals = HashMap<String, Totals>()
    val resumedAt = HashMap<String, Long>()
    var foreground: String? = null
    var unlocks = 0
    val event = UsageEvents.Event()

    fun close(pkg: String, at: Long) {
      val since = resumedAt.remove(pkg) ?: return
      val from = maxOf(since, startMs)
      val to = minOf(at, endMs)
      if (to > from) {
        val total = totals.getOrPut(pkg) { Totals() }
        total.foregroundMs += to - from
        total.lastUsed = maxOf(total.lastUsed, to)
      }
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val pkg = event.packageName ?: continue
      val at = event.timeStamp
      when (event.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          if (!resumedAt.containsKey(pkg)) resumedAt[pkg] = at
          if (foreground != pkg && at >= startMs) totals.getOrPut(pkg) { Totals() }.opens++
          foreground = pkg
        }
        UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> {
          close(pkg, at)
        }
        UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.DEVICE_SHUTDOWN -> {
          for (open in resumedAt.keys.toList()) close(open, at)
          foreground = null
        }
        UsageEvents.Event.KEYGUARD_HIDDEN -> if (at >= startMs) unlocks++
      }
    }
    val now = System.currentTimeMillis()
    for (open in resumedAt.keys.toList()) close(open, minOf(now, endMs))

    val pm = context.packageManager
    val skip = homePackages()
    val apps = totals.filter { (pkg, total) -> pkg !in skip && total.foregroundMs >= 1000 }
      .map { (pkg, total) ->
        val label = try {
          pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: PackageManager.NameNotFoundException) {
          pkg
        }
        mapOf(
          "packageName" to pkg,
          "label" to label,
          "foregroundMs" to total.foregroundMs.toDouble(),
          "opens" to total.opens,
          "lastUsed" to total.lastUsed.toDouble(),
        )
      }
      .sortedByDescending { it["foregroundMs"] as Double }
    return mapOf("apps" to apps, "unlocks" to unlocks)
  }

  /** App icon as a small PNG data URI (cached), or null when it cannot be drawn. */
  private fun icon(packageName: String): String? {
    iconCache[packageName]?.let { return it }
    val result = try {
      val drawable = context.packageManager.getApplicationIcon(packageName)
      val size = 96
      val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      drawable.setBounds(0, 0, size, size)
      drawable.draw(canvas)
      val stream = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
      bitmap.recycle()
      "data:image/png;base64," + Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
      null
    }
    iconCache[packageName] = result
    return result
  }
}
