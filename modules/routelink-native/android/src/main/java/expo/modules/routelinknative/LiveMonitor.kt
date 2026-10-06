package expo.modules.routelinknative

import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Between the Expo module and LiveMonitorService (design §16, LU-1…LU-4): starts and stops the service,
 * forwards the app's updates and events, and remembers a running monitor in SharedPreferences so that the
 * next launch can tell the user when the system ended it.
 */
internal object LiveMonitor {
  const val CHANNEL_ID = "routelink-live"
  const val NOTIFICATION_ID = 7301
  const val STOPPED_NOTIFICATION_ID = 7302
  private const val PREFS = "routelink.live"
  private const val KEY_ACTIVE = "active"
  private const val KEY_INTERRUPTED = "interrupted"
  /** Android 16 QPR (API 36.1, SDK_INT_FULL 3600001) is the first to show promoted notifications as chips. */
  private const val SDK_INT_FULL_36_1 = 3_600_001
  /** Settings action of API 36.1; API 36 has APP_NOTIFICATION_PROMOTION_SETTINGS. */
  private const val ACTION_MANAGE_PROMOTED = "android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS"
  private const val ACTION_PROMOTION_36 = "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS"

  /** Config of the next ACTION_START; the service takes it (same process, so no parcelling). */
  @Volatile
  var pending: LiveConfig? = null

  @Volatile
  var service: LiveMonitorService? = null

  /** Module events; null while no JavaScript runtime listens. */
  @Volatile
  var emitter: ((String, Map<String, Any?>) -> Unit)? = null

  fun emit(name: String, body: Map<String, Any?>) {
    emitter?.invoke(name, body)
  }

  fun start(context: Context, config: LiveConfig) {
    val app = context.applicationContext
    pending = config
    remember(app, config)
    try {
      ContextCompat.startForegroundService(app, Intent(app, LiveMonitorService::class.java).setAction(LiveMonitorService.ACTION_START))
    } catch (e: Exception) {
      // Android 12+ refuses a foreground service started from the background.
      pending = null
      forget(app)
      throw NativeError("ERR_UNSUPPORTED", e.message ?: "the live monitor could not start", e)
    }
  }

  fun update(update: LiveMonitorUpdateRecord) {
    service?.applyUpdate(update)
  }

  fun stop(context: Context) {
    val running = service
    if (running != null) {
      running.stopWith("user")
    } else {
      pending = null
      forget(context.applicationContext)
    }
  }

  val running: Boolean
    get() = service != null || pending != null

  fun state(context: Context): Map<String, Any?> {
    val prefs = prefs(context)
    val current = service?.snapshot()
    // A monitor the prefs still remember but that is not running: the system ended the process.
    if (current == null && pending == null) {
      prefs.getString(KEY_ACTIVE, null)?.let { active ->
        prefs.edit().putString(KEY_INTERRUPTED, active).remove(KEY_ACTIVE).apply()
      }
    }
    val interrupted = prefs.getString(KEY_INTERRUPTED, null)?.let(::parse)
    return (current ?: mapOf("running" to (pending != null))) + ("interrupted" to interrupted)
  }

  fun clearInterruption(context: Context) {
    prefs(context).edit().remove(KEY_INTERRUPTED).apply()
  }

  /** Called by the service when it ends on its own terms (user, timeout, error). */
  fun onStopped(context: Context) {
    forget(context)
  }

  /** Called by the service when the system destroys it without a stop. */
  fun onInterrupted(context: Context, config: LiveConfig) {
    prefs(context).edit().putString(KEY_INTERRUPTED, record(config).toString()).remove(KEY_ACTIVE).apply()
  }

  private fun remember(context: Context, config: LiveConfig) {
    prefs(context).edit().putString(KEY_ACTIVE, record(config).toString()).remove(KEY_INTERRUPTED).apply()
  }

  private fun forget(context: Context) {
    prefs(context).edit().remove(KEY_ACTIVE).apply()
  }

  private fun record(config: LiveConfig) = JSONObject()
    .put("routerId", config.routerId)
    .put("routerName", config.routerName)
    .put("startedAt", config.startedAt)
    .put("endsAt", config.endsAt ?: JSONObject.NULL)

  private fun parse(json: String): Map<String, Any?>? = try {
    val o = JSONObject(json)
    mapOf(
      "routerId" to o.optString("routerId"),
      "routerName" to o.optString("routerName"),
      "startedAt" to o.optLong("startedAt").toDouble(),
      "endsAt" to if (o.isNull("endsAt")) null else o.optLong("endsAt").toDouble(),
    )
  } catch (e: Exception) {
    null
  }

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---- capabilities and system settings (LU-4) ----

  fun promotionSupported(): Boolean =
    Build.VERSION.SDK_INT > 36 || (Build.VERSION.SDK_INT == 36 && Build.VERSION.SDK_INT_FULL >= SDK_INT_FULL_36_1)

  fun canPostPromoted(context: Context): Boolean {
    if (!promotionSupported()) return false
    return try {
      context.getSystemService(NotificationManager::class.java).canPostPromotedNotifications()
    } catch (e: Exception) {
      false
    }
  }

  fun support(context: Context): Map<String, Any?> {
    val nm = NotificationManagerCompat.from(context)
    val channel = nm.getNotificationChannel(CHANNEL_ID)
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return mapOf(
      "sdkInt" to Build.VERSION.SDK_INT,
      "promotion" to promotionSupported(),
      "canPostPromoted" to canPostPromoted(context),
      "notificationsEnabled" to (nm.areNotificationsEnabled() && channel?.importance != NotificationManager.IMPORTANCE_NONE),
      "ignoringBatteryOptimizations" to power.isIgnoringBatteryOptimizations(context.packageName),
      "manufacturer" to Build.MANUFACTURER,
      "brand" to Build.BRAND,
    )
  }

  fun openPromotionSettings(context: Context): Boolean {
    val pkg = context.packageName
    val promoted = listOf(ACTION_MANAGE_PROMOTED, ACTION_PROMOTION_36)
      .filter { Build.VERSION.SDK_INT >= 36 }
      .map { Intent(it).putExtra(Settings.EXTRA_APP_PACKAGE, pkg) }
    return launchFirst(context, promoted + notificationIntents(pkg))
  }

  fun openNotificationSettings(context: Context): Boolean = launchFirst(context, notificationIntents(context.packageName))

  fun openBatteryOptimizationSettings(context: Context): Boolean {
    val pkg = context.packageName
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val ask = if (!power.isIgnoringBatteryOptimizations(pkg)) {
      listOf(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg")))
    } else {
      emptyList()
    }
    return launchFirst(context, ask + Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) + appDetails(pkg))
  }

  private fun notificationIntents(pkg: String) =
    listOf(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg), appDetails(pkg))

  private fun appDetails(pkg: String) = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))

  /** Vendors drop settings pages: the first one that opens wins. */
  private fun launchFirst(context: Context, intents: List<Intent>): Boolean {
    for (intent in intents) {
      try {
        if (context !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return true
      } catch (e: ActivityNotFoundException) {
        continue
      } catch (e: SecurityException) {
        continue
      }
    }
    return false
  }
}
