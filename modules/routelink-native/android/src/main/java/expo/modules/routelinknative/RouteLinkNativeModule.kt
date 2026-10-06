package expo.modules.routelinknative

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class RouteLinkNativeModule : Module() {
  private val http = HttpEngine()
  private val ssh = SshEngine { name, payload -> sendEvent(name, payload) }
  private val liveEvents: (String, Map<String, Any?>) -> Unit = { name, payload -> sendEvent(name, payload) }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** Settings pages open on top of the app when there is an activity. */
  private val activityOrContext: Context
    get() = appContext.currentActivity ?: context

  override fun definition() = ModuleDefinition {
    Name("RouteLinkNative")

    Events("onSshData", "onSshClosed", "onLiveMonitorStopped", "onLiveMonitorStatus")

    OnCreate {
      LiveMonitor.emitter = liveEvents
    }

    AsyncFunction("httpRequest") Coroutine { options: HttpRequestRecord ->
      http.execute(options)
    }

    AsyncFunction("fetchServerCertificate") Coroutine { url: String, timeoutMs: Double? ->
      http.certificate(url, (timeoutMs ?: 8_000.0).toLong())
    }

    AsyncFunction("getNetworkInfo") {
      NetInfo.read(appContext.reactContext ?: throw Exceptions.ReactContextLost())
    }

    AsyncFunction("sendWakeOnLan") Coroutine { mac: String, broadcast: String?, port: Int? ->
      withContext(Dispatchers.IO) { WakeOnLan.send(mac, broadcast, port) }
    }

    // JavaScript timers do not run in a headless start (background task), this does.
    AsyncFunction("sleep") Coroutine { ms: Double ->
      delay(ms.toLong())
    }

    AsyncFunction("sshGenerateKey") Coroutine { comment: String ->
      withContext(Dispatchers.Default) { SshKeys.generate(comment) }
    }

    AsyncFunction("sshPublicKey") { seed: String, comment: String ->
      SshKeys.publicLine(seed, comment)
    }

    AsyncFunction("sshHostKey") Coroutine { host: String, port: Int, timeoutMs: Double? ->
      withContext(Dispatchers.IO) { ssh.hostKey(host, port, (timeoutMs ?: 10_000.0).toLong()) }
    }

    AsyncFunction("sshOpen") Coroutine { options: SshOptionsRecord ->
      withContext(Dispatchers.IO) { ssh.open(options) }
    }

    AsyncFunction("sshWrite") Coroutine { id: String, data: String ->
      withContext(Dispatchers.IO) { ssh.write(id, data) }
    }

    AsyncFunction("sshResize") Coroutine { id: String, cols: Int, rows: Int ->
      withContext(Dispatchers.IO) { ssh.resize(id, cols, rows) }
    }

    AsyncFunction("sshClose") Coroutine { id: String ->
      withContext(Dispatchers.IO) { ssh.close(id) }
    }

    AsyncFunction("sshExec") Coroutine { options: SshOptionsRecord, command: String, timeoutMs: Double? ->
      withContext(Dispatchers.IO) { ssh.exec(options, command, (timeoutMs ?: 30_000.0).toLong()) }
    }

    // Live monitor (design §16): Android only; iOS rejects with ERR_UNSUPPORTED.
    AsyncFunction("startLiveMonitor") { config: LiveMonitorConfigRecord ->
      LiveMonitor.start(context, config.toConfig(System.currentTimeMillis()))
    }

    AsyncFunction("updateLiveMonitor") { update: LiveMonitorUpdateRecord ->
      LiveMonitor.update(update)
    }

    AsyncFunction("stopLiveMonitor") {
      LiveMonitor.stop(context)
    }

    AsyncFunction("getLiveMonitorState") {
      LiveMonitor.state(context)
    }

    AsyncFunction("clearLiveMonitorInterruption") {
      LiveMonitor.clearInterruption(context)
    }

    AsyncFunction("getLiveMonitorSupport") {
      LiveMonitor.support(context)
    }

    AsyncFunction("canPostPromotedNotifications") {
      LiveMonitor.canPostPromoted(context)
    }

    AsyncFunction("openPromotedNotificationSettings") {
      LiveMonitor.openPromotionSettings(activityOrContext)
    }

    AsyncFunction("openNotificationSettings") {
      LiveMonitor.openNotificationSettings(activityOrContext)
    }

    AsyncFunction("openBatteryOptimizationSettings") {
      LiveMonitor.openBatteryOptimizationSettings(activityOrContext)
    }

    OnDestroy {
      ssh.closeAll()
      if (LiveMonitor.emitter === liveEvents) LiveMonitor.emitter = null
    }
  }
}
