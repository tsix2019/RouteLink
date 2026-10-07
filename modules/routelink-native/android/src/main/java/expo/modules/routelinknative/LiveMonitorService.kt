package expo.modules.routelinknative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The Android live monitor (design §16): a `connectedDevice` foreground service that polls one router
 * and keeps its speed in an ongoing notification, promoted to a status-bar chip on Android 16 QPR (API 36.1+).
 *
 * States: starting → ok; after 2 failed polls in a row "offline" (vibrates once, LU-3) or "error"; a dead
 * session is "session-expired" until the app hands over a new one. Ends at the chosen time ("timeout"), on
 * the Stop action or from the app ("user"), on a certificate problem ("error"); anything else is "system".
 */
class LiveMonitorService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val http = HttpEngine()
  private var job: Job? = null
  private var config: LiveConfig? = null
  private var poller: LivePoller? = null

  private var status = "starting"
  private var sample: LiveSample? = null
  private var failures = 0
  private var firstFailureAt = 0L
  private var offlineSince = 0L
  /** "Back online (offline for 3m 20s)": shown for one refresh after an outage. */
  private var recovered: String? = null
  /** When the app last handed over a sample of its own (elapsedRealtime). */
  private var pushedAt = 0L
  /** When the service last asked the router itself (elapsedRealtime). */
  private var polledAt = 0L
  private var stopping = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    LiveMonitor.service = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopWith("user")
      ACTION_START -> {
        val next = LiveMonitor.pending
        LiveMonitor.pending = null
        if (next == null) {
          // Started with startForegroundService: Android insists on startForeground before stopping.
          startForegroundSafely(placeholder())
          finish("error", "no configuration")
        } else {
          begin(next)
        }
      }
      // Restarted by the system after its process died: the session and texts are gone with it.
      else -> if (config == null) stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    val cfg = config
    if (!stopping && cfg != null) {
      stopping = true
      job?.cancel()
      LiveMonitor.onInterrupted(this, cfg)
      LiveMonitor.emit("onLiveMonitorStopped", mapOf("reason" to "system", "routerId" to cfg.routerId))
    }
    scope.cancel()
    if (LiveMonitor.service === this) LiveMonitor.service = null
    super.onDestroy()
  }

  // ---- control (main thread) ----

  private fun begin(cfg: LiveConfig) {
    job?.cancel()
    config = cfg
    stopping = false
    status = "starting"
    failures = 0
    recovered = null
    sample = cfg.sample
    pushedAt = if (cfg.sample != null) SystemClock.elapsedRealtime() else 0L
    poller = LivePoller(http, cfg.source, cfg.session, cfg.tlsSha256, cfg.wanDevice, cfg.sample).also { p ->
      cfg.sample?.let(p::onPushed)
    }
    ensureChannel(cfg.texts)
    if (!startForegroundSafely(build())) {
      finish("error", "startForeground failed")
      return
    }
    job = scope.launch {
      while (isActive && !stopping) {
        val began = SystemClock.elapsedRealtime()
        val c = config ?: break
        if (c.endsAt != null && System.currentTimeMillis() >= c.endsAt) {
          stopWith("timeout")
          break
        }
        tick(c)
        if (stopping) break
        render()
        delay((c.intervalMs - (SystemClock.elapsedRealtime() - began)).coerceAtLeast(MIN_GAP_MS))
      }
    }
  }

  /** From the module thread: names, a fresh sample of the app's, a new session, the interval. */
  fun applyUpdate(update: LiveMonitorUpdateRecord) {
    scope.launch {
      val cfg = config ?: return@launch
      var next = cfg
      update.routerName?.takeIf { it.isNotBlank() }?.let { next = next.copy(routerName = it) }
      update.names?.let { next = next.copy(names = normalizeNames(it)) }
      update.intervalSec?.let { next = next.copy(intervalMs = intervalMsOf(it)) }
      update.session?.toSession()?.let { s ->
        next = next.copy(session = s)
        poller?.session = s
        if (status == "session-expired") setStatus("starting")
      }
      config = next
      update.sample?.toSample()?.let { s ->
        if (next.source == "demo") poller?.setDemoBase(s)
        poller?.onPushed(s)
        poller?.resetCounters()
        pushedAt = SystemClock.elapsedRealtime()
        onSuccess(s)
      }
      if (!stopping) render()
    }
  }

  fun stopWith(reason: String) {
    scope.launch { finish(reason, null) }
  }

  fun snapshot(): Map<String, Any?>? {
    val cfg = config ?: return null
    if (stopping) return null
    return mapOf(
      "running" to true,
      "routerId" to cfg.routerId,
      "routerName" to cfg.routerName,
      "source" to (poller?.source ?: cfg.source),
      "startedAt" to cfg.startedAt.toDouble(),
      "endsAt" to cfg.endsAt?.toDouble(),
      "intervalSec" to cfg.intervalMs / 1000.0,
      "status" to status,
    )
  }

  private fun finish(reason: String, message: String?) {
    if (stopping) return
    stopping = true
    job?.cancel()
    val cfg = config
    LiveMonitor.onStopped(this)
    // In the background nobody would know why the notification went away.
    if (cfg != null && message == "tls") postStopped(cfg, cfg.texts.stoppedTls)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
    LiveMonitor.emit(
      "onLiveMonitorStopped",
      mapOf("reason" to reason, "routerId" to cfg?.routerId, "message" to message),
    )
  }

  // ---- polling ----

  private suspend fun tick(cfg: LiveConfig) {
    // The overview polls the same data while it is on screen and hands it over: no second request, except
    // now and then, or rpcd drops the service's idle session (300 s) and the first poll in the background fails.
    val now = SystemClock.elapsedRealtime()
    val pushed = now - pushedAt < cfg.intervalMs * 3 / 2
    if (pushed && now - polledAt < KEEP_ALIVE_MS) return
    if (status == "session-expired") return
    val p = poller ?: return
    polledAt = now
    try {
      val s = p.poll(cfg.intervalMs)
      // a keep-alive's rates span minutes (luci counters): the app's sample stays
      onSuccess(if (pushed) null else s)
    } catch (f: PollFailure) {
      when (f) {
        is PollFailure.SessionGone -> setStatus("session-expired")
        is PollFailure.Tls -> finish("error", "tls")
        // Plugin removed or stopped: carry on without it when the WAN device is known.
        is PollFailure.NoPlugin -> if (cfg.wanDevice != null) p.source = "luci" else onFailure(false)
        is PollFailure.Offline -> onFailure(true)
        is PollFailure.Other -> onFailure(false)
      }
    }
  }

  private fun onSuccess(s: LiveSample?) {
    if (status == "offline") {
      val texts = config?.texts
      if (texts != null) {
        recovered = LiveFormat.fill(texts.recovered, "duration" to LiveFormat.duration(SystemClock.elapsedRealtime() - offlineSince, texts))
      }
    }
    failures = 0
    if (s != null) sample = s
    setStatus("ok")
  }

  private fun onFailure(offline: Boolean) {
    val now = SystemClock.elapsedRealtime()
    if (failures == 0) firstFailureAt = now
    failures++
    if (failures < 2) return
    if (offline) {
      if (status != "offline") {
        offlineSince = firstFailureAt
        sample = null
        poller?.resetCounters()
        vibrate()
      }
      setStatus("offline")
    } else if (status != "offline") {
      setStatus("error")
    }
  }

  private fun setStatus(next: String) {
    if (next == status) return
    status = next
    config?.let { LiveMonitor.emit("onLiveMonitorStatus", mapOf("status" to next, "routerId" to it.routerId)) }
  }

  // ---- notification ----

  private fun render() {
    try {
      NotificationManagerCompat.from(this).notify(LiveMonitor.NOTIFICATION_ID, build())
    } catch (e: SecurityException) {
      // Notification permission withdrawn: the service keeps running, the user can stop it from the app.
    }
  }

  private fun build(): Notification {
    val cfg = config ?: return placeholder()
    val texts = cfg.texts
    var title = cfg.routerName
    val text: String
    var second: String? = null
    var chip: String? = null
    when (status) {
      "offline" -> {
        title = texts.offlineTitle
        text = LiveFormat.fill(texts.offlineText, "name" to cfg.routerName)
        chip = texts.offlineChip
      }
      "session-expired" -> text = texts.sessionExpired
      "error" -> text = texts.error
      else -> {
        val s = sample
        val back = recovered
        recovered = null
        if (s == null) {
          text = back ?: texts.connecting
        } else if (back != null) {
          text = back
          second = LiveFormat.line(s, texts)
        } else {
          text = LiveFormat.line(s, texts)
          second = LiveFormat.top(s, cfg.names, texts)
        }
        if (s != null) chip = LiveFormat.chip(s.rxBps)
      }
    }

    val builder = NotificationCompat.Builder(this, LiveMonitor.CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(if (second != null) "$text\n$second" else text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openIntent(cfg))
      .setDeleteIntent(stopIntent())
      .addAction(0, texts.stop, stopIntent())
      // Android 16 QPR+: a Live Update with a chip in the status bar (design §3.1). Harmless before.
      .setRequestPromotedOngoing(true)
    if (chip != null) builder.setShortCriticalText(chip)
    accent(cfg)?.let(builder::setColor)
    if (cfg.endsAt != null) {
      builder.setWhen(cfg.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false)
    }
    // Android 17: ↓, ↑ and online as a MetricStyle (plan P4 §0.9) while the numbers are current.
    return LiveMetrics.apply(this, builder.build(), if (status == "ok") sample else null, texts)
  }

  private fun placeholder(): Notification =
    NotificationCompat.Builder(this, LiveMonitor.CHANNEL_ID).setSmallIcon(smallIcon()).setOngoing(true).build()

  private fun postStopped(cfg: LiveConfig, body: String) {
    val n = NotificationCompat.Builder(this, LiveMonitor.CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(cfg.texts.stoppedTitle)
      .setContentText("${cfg.routerName}: $body")
      .setAutoCancel(true)
      .setContentIntent(openIntent(cfg))
      .apply { accent(cfg)?.let { setColor(it) } }
      .build()
    try {
      NotificationManagerCompat.from(this).notify(LiveMonitor.STOPPED_NOTIFICATION_ID, n)
    } catch (e: SecurityException) {
      // No notification permission.
    }
  }

  private fun startForegroundSafely(notification: Notification): Boolean = try {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
    ServiceCompat.startForeground(this, LiveMonitor.NOTIFICATION_ID, notification, type)
    true
  } catch (e: Exception) {
    // Android 12+ background-start limits, or Android 14's type prerequisites.
    false
  }

  private fun ensureChannel(texts: LiveTexts) {
    // Silent: it is updated every few seconds. Not IMPORTANCE_MIN, which rules out promotion.
    val channel = NotificationChannel(LiveMonitor.CHANNEL_ID, texts.channel, NotificationManager.IMPORTANCE_DEFAULT).apply {
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun openIntent(cfg: LiveConfig): PendingIntent {
    val intent = if (cfg.link.isNotBlank()) {
      Intent(Intent.ACTION_VIEW, Uri.parse(cfg.link)).setPackage(packageName)
    } else {
      packageManager.getLaunchIntentForPackage(packageName) ?: Intent().setPackage(packageName)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun stopIntent(): PendingIntent = PendingIntent.getService(
    this,
    1,
    Intent(this, LiveMonitorService::class.java).setAction(ACTION_STOP),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  /** The app's notification glyph (expo-notifications' `notification_icon`), else the launcher icon. */
  private fun smallIcon(): Int {
    val id = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (id != 0) id else applicationInfo.icon
  }

  private fun accent(cfg: LiveConfig): Int? = cfg.color?.let {
    try {
      Color.parseColor(it)
    } catch (e: IllegalArgumentException) {
      null
    }
  }

  /** LU-3: one short buzz when the router goes offline. */
  private fun vibrate() {
    try {
      val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        getSystemService(VibratorManager::class.java)?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      }
      val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build()
      @Suppress("DEPRECATION")
      vibrator?.vibrate(VibrationEffect.createOneShot(300, VibrationEffect.DEFAULT_AMPLITUDE), attributes)
    } catch (e: Exception) {
      // No vibrator, or not allowed: the title still says offline.
    }
  }

  companion object {
    const val ACTION_START = "expo.modules.routelinknative.live.START"
    const val ACTION_STOP = "expo.modules.routelinknative.live.STOP"
    private const val MIN_GAP_MS = 250L
    private const val KEEP_ALIVE_MS = 120_000L
  }
}
