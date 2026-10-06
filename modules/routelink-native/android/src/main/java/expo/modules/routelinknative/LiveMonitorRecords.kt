package expo.modules.routelinknative

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Locale

// What JavaScript hands the live monitor (design §16, plan P4 §0.8). See LiveMonitorConfig in
// src/RouteLinkNative.types.ts for the documentation of each field.

class LiveTextsRecord : Record {
  @Field val channel: String = "Live monitor"
  @Field val line: String = "↓ {rx} ↑ {tx} · {online} online"
  @Field val lineNoCount: String = "↓ {rx} ↑ {tx}"
  @Field val top: String = "Busiest: {name} {rate}"
  @Field val connecting: String = "Connecting…"
  @Field val offlineTitle: String = "Router offline"
  @Field val offlineText: String = "Can't reach {name}, trying again"
  @Field val offlineChip: String = "Offline"
  @Field val recovered: String = "Back online (offline for {duration})"
  @Field val sessionExpired: String = "Open the app to reconnect"
  @Field val error: String = "Can't read the router, trying again"
  @Field val stop: String = "Stop"
  @Field val stoppedTitle: String = "Live monitor stopped"
  @Field val stoppedTls: String = "The router's certificate has changed"
  @Field val sec: String = "{s}s"
  @Field val minSec: String = "{m}m {s}s"
  @Field val hourMin: String = "{h}h {m}m"
}

class LiveSessionRecord : Record {
  @Field val endpoint: String = ""
  @Field val sid: String = ""
  @Field val cookie: String? = null
}

class LiveDeviceRecord : Record {
  @Field val mac: String = ""
  @Field val rxBps: Double = 0.0
  @Field val txBps: Double = 0.0
}

class LiveSampleRecord : Record {
  @Field val rxBps: Double = 0.0
  @Field val txBps: Double = 0.0
  @Field val online: Double? = null
  @Field val devices: List<LiveDeviceRecord> = emptyList()
}

class LiveMonitorConfigRecord : Record {
  @Field val routerId: String = ""
  @Field val routerName: String = ""
  /** "agent" (routelink live), "luci" (luci-rpc counters + ip neigh) or "demo" (made up here). */
  @Field val source: String = "luci"
  @Field val session: LiveSessionRecord? = null
  @Field val tlsSha256: String? = null
  @Field val wanDevice: String? = null
  @Field val intervalSec: Double = 2.0
  /** Null or 0: until stopped. */
  @Field val durationMin: Double? = null
  @Field val names: Map<String, String> = emptyMap()
  @Field val texts: LiveTextsRecord = LiveTextsRecord()
  @Field val sample: LiveSampleRecord? = null
  /** Opened when the notification is tapped, e.g. routelink://overview. */
  @Field val link: String = ""
  /** #RRGGBB accent of the notification icon. */
  @Field val color: String? = null
}

class LiveMonitorUpdateRecord : Record {
  @Field val routerName: String? = null
  @Field val names: Map<String, String>? = null
  @Field val sample: LiveSampleRecord? = null
  @Field val session: LiveSessionRecord? = null
  @Field val intervalSec: Double? = null
}

// ---- immutable copies the service works with ----

internal data class LiveTexts(
  val channel: String,
  val line: String,
  val lineNoCount: String,
  val top: String,
  val connecting: String,
  val offlineTitle: String,
  val offlineText: String,
  val offlineChip: String,
  val recovered: String,
  val sessionExpired: String,
  val error: String,
  val stop: String,
  val stoppedTitle: String,
  val stoppedTls: String,
  val sec: String,
  val minSec: String,
  val hourMin: String,
)

internal data class LiveSession(val endpoint: String, val sid: String, val cookie: String?)

internal data class LiveDevice(val mac: String, val rxBps: Double, val txBps: Double)

internal data class LiveSample(
  val rxBps: Double,
  val txBps: Double,
  /** Null while unknown (no plugin, the neighbour table not read yet or not allowed). */
  val online: Int?,
  val devices: List<LiveDevice> = emptyList(),
)

internal data class LiveConfig(
  val routerId: String,
  val routerName: String,
  val source: String,
  val session: LiveSession?,
  val tlsSha256: String?,
  val wanDevice: String?,
  val intervalMs: Long,
  val startedAt: Long,
  /** Wall-clock end, null for "until stopped". */
  val endsAt: Long?,
  val names: Map<String, String>,
  val texts: LiveTexts,
  val sample: LiveSample?,
  val link: String,
  val color: String?,
)

internal fun LiveTextsRecord.toTexts() = LiveTexts(
  channel, line, lineNoCount, top, connecting, offlineTitle, offlineText, offlineChip, recovered,
  sessionExpired, error, stop, stoppedTitle, stoppedTls, sec, minSec, hourMin,
)

internal fun LiveSessionRecord.toSession(): LiveSession? =
  if (endpoint.isBlank() || sid.isBlank()) null else LiveSession(endpoint, sid, cookie?.takeIf { it.isNotBlank() })

internal fun LiveSampleRecord.toSample() = LiveSample(
  rxBps,
  txBps,
  online?.takeIf { it.isFinite() && it >= 0 }?.toInt(),
  devices.map { LiveDevice(it.mac, it.rxBps, it.txBps) },
)

internal fun normalizeNames(names: Map<String, String>): Map<String, String> =
  names.mapKeys { it.key.uppercase(Locale.US) }

/** Refresh interval as the overview has it (1–10 s); anything else is clamped. */
internal fun intervalMsOf(sec: Double): Long = (sec.takeIf { it.isFinite() } ?: 2.0).coerceIn(1.0, 60.0).times(1000).toLong()

internal fun LiveMonitorConfigRecord.toConfig(now: Long): LiveConfig {
  if (routerId.isBlank()) throw NativeError("ERR_INVALID_ARGUMENT", "routerId is required")
  if (source !in setOf("agent", "luci", "demo")) throw NativeError("ERR_INVALID_ARGUMENT", "unknown source: $source")
  val live = session?.toSession()
  if (source != "demo" && live == null) throw NativeError("ERR_INVALID_ARGUMENT", "a session is required")
  if (source == "luci" && wanDevice.isNullOrBlank()) throw NativeError("ERR_INVALID_ARGUMENT", "wanDevice is required")
  val minutes = durationMin?.takeIf { it.isFinite() && it > 0 }
  return LiveConfig(
    routerId = routerId,
    routerName = routerName.ifBlank { routerId },
    source = source,
    session = live,
    tlsSha256 = tlsSha256?.takeIf { it.isNotBlank() },
    wanDevice = wanDevice?.takeIf { it.isNotBlank() },
    intervalMs = intervalMsOf(intervalSec),
    startedAt = now,
    endsAt = minutes?.let { now + (it * 60_000).toLong() },
    names = normalizeNames(names),
    texts = texts.toTexts(),
    sample = sample?.toSample(),
    link = link,
    color = color,
  )
}
