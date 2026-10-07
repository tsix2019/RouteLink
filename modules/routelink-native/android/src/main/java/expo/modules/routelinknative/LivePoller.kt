package expo.modules.routelinknative

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.random.Random

/** Why a poll gave no sample. The service turns these into notification states. */
internal sealed class PollFailure(message: String) : Exception(message) {
  /** The router did not answer (timeout, unreachable, DNS, broken connection). */
  class Offline(message: String) : PollFailure(message)

  /** rpcd no longer knows the session (router restarted, session timed out): only the app can log in again. */
  class SessionGone : PollFailure("session expired")

  /** The pinned certificate no longer matches, or the system does not trust the router: retrying cannot help. */
  class Tls(message: String) : PollFailure(message)

  /** The plugin's ubus object is gone (uninstalled, daemon stopped). */
  class NoPlugin : PollFailure("routelink object not found")

  class Other(message: String) : PollFailure(message)
}

private sealed class RpcResult {
  class Ok(val data: JSONObject) : RpcResult()
  class Err(val code: String) : RpcResult()
}

/**
 * The live monitor's own polling (plan P4 §0.8: JavaScript timers do not run while the app is in the
 * background). Talks JSON-RPC to the session JavaScript logged in; never logs in itself.
 */
internal class LivePoller(
  private val http: HttpEngine,
  var source: String,
  var session: LiveSession?,
  private val tlsSha256: String?,
  private val wanDevice: String?,
  demoBase: LiveSample?,
) {
  private var nextId = 1
  private var counters: Counters? = null
  private var online: Int? = null
  private var onlineAt = 0L
  private var neighAllowed = true
  private var demo: LiveSample = demoBase ?: LiveSample(42e6, 3.5e6, 12)
  private var demoNow: LiveSample = demo

  private class Counters(val rx: Long, val tx: Long, val at: Long)

  /** The demo source drifts around what the app showed last. */
  fun setDemoBase(sample: LiveSample) {
    demo = sample
  }

  /** The app's own sample (overview in the foreground) stands in for a poll; the counters restart after it. */
  fun onPushed(sample: LiveSample) {
    if (sample.online != null) {
      online = sample.online
      onlineAt = SystemClock.elapsedRealtime()
    }
  }

  /** A sample, or null when it takes one more poll to know a rate (first counter reading). */
  suspend fun poll(intervalMs: Long): LiveSample? = when (source) {
    "demo" -> pollDemo()
    "agent" -> pollAgent()
    else -> pollLuci(intervalMs)
  }

  private suspend fun pollAgent(): LiveSample =
    when (val r = call(listOf(Call("routelink", "live"))).single()) {
      is RpcResult.Err -> throw when (r.code) {
        "ACCESS_DENIED" -> PollFailure.SessionGone()
        "NOT_FOUND", "METHOD_NOT_FOUND" -> PollFailure.NoPlugin()
        else -> PollFailure.Other(r.code)
      }
      is RpcResult.Ok -> {
        val wan = r.data.optJSONObject("wan") ?: JSONObject()
        val list = r.data.optJSONArray("devices") ?: JSONArray()
        val devices = (0 until list.length()).mapNotNull { i ->
          val d = list.optJSONObject(i) ?: return@mapNotNull null
          LiveDevice(d.optString("mac"), bits(d.opt("rx_rate")), bits(d.opt("tx_rate")))
        }.sortedByDescending { it.rxBps + it.txBps }.take(5)
        LiveSample(bits(wan.opt("rx_rate")), bits(wan.opt("tx_rate")), r.data.optInt("online", 0), devices)
      }
    }

  private suspend fun pollLuci(intervalMs: Long): LiveSample? {
    val device = wanDevice ?: throw PollFailure.Other("no WAN device")
    val now = SystemClock.elapsedRealtime()
    val wantNeigh = neighAllowed && now - onlineAt >= NEIGH_EVERY_MS
    val calls = mutableListOf(Call("luci-rpc", "getNetworkDevices"))
    if (wantNeigh) {
      calls += Call("file", "exec", JSONObject().put("command", "/sbin/ip").put("params", JSONArray(listOf("-4", "neigh", "show"))))
    }
    val results = call(calls)
    val devices = when (val r = results[0]) {
      is RpcResult.Err -> throw if (r.code == "ACCESS_DENIED") PollFailure.SessionGone() else PollFailure.Other(r.code)
      is RpcResult.Ok -> r.data
    }
    if (wantNeigh) {
      when (val r = results[1]) {
        is RpcResult.Ok -> {
          online = countOnline(r.data.optString("stdout"), setOf(device))
          onlineAt = now
        }
        // The counters came through with the same session, so this is the ACL (luci-mod-status missing).
        is RpcResult.Err -> if (r.code == "ACCESS_DENIED" || r.code == "PERMISSION_DENIED" || r.code == "NOT_FOUND") {
          neighAllowed = false
          online = null
        }
      }
    }
    val stats = devices.optJSONObject(device)?.optJSONObject("stats") ?: throw PollFailure.Other("no counters for $device")
    val next = Counters(stats.optLong("rx_bytes"), stats.optLong("tx_bytes"), now)
    val prev = counters
    counters = next
    // A stale or reset counter would give a meaningless average: start over.
    if (prev == null || next.at - prev.at > maxOf(3 * intervalMs, 10_000L)) return null
    val dt = (next.at - prev.at) / 1000.0
    if (dt <= 0 || next.rx < prev.rx || next.tx < prev.tx) return null
    return LiveSample((next.rx - prev.rx) * 8 / dt, (next.tx - prev.tx) * 8 / dt, online)
  }

  /** Forget the counters: after a gap (offline, pushed samples) the next rate needs two fresh readings. */
  fun resetCounters() {
    counters = null
  }

  private fun pollDemo(): LiveSample {
    fun drift(prev: Double, base: Double) = 0.6 * prev + 0.4 * base * (0.65 + 0.7 * Random.nextDouble())
    val devices = demo.devices.map { d ->
      val before = demoNow.devices.firstOrNull { it.mac == d.mac } ?: d
      LiveDevice(d.mac, drift(before.rxBps, d.rxBps), drift(before.txBps, d.txBps))
    }
    demoNow = LiveSample(drift(demoNow.rxBps, demo.rxBps), drift(demoNow.txBps, demo.txBps), demo.online, devices)
    return demoNow
  }

  private class Call(val obj: String, val method: String, val params: JSONObject = JSONObject())

  private suspend fun call(calls: List<Call>): List<RpcResult> {
    val s = session ?: throw PollFailure.SessionGone()
    val ids = calls.map { nextId++ }
    val encoded = calls.mapIndexed { i, c ->
      JSONObject()
        .put("jsonrpc", "2.0")
        .put("id", ids[i])
        .put("method", "call")
        .put("params", JSONArray().put(s.sid).put(c.obj).put(c.method).put(c.params))
    }
    val body = if (encoded.size == 1) encoded[0].toString() else JSONArray(encoded).toString()
    val headers = mutableMapOf("Content-Type" to "application/json")
    s.cookie?.let { headers["Cookie"] = it }
    val res = try {
      http.perform(
        url = s.endpoint,
        method = "POST",
        headers = headers,
        body = body,
        timeoutMs = REQUEST_TIMEOUT_MS,
        tlsMode = if (tlsSha256 != null) "pinned" else "system",
        sha256 = tlsSha256,
      )
    } catch (e: NativeError) {
      throw when (e.code) {
        "ERR_TLS_PIN_MISMATCH", "ERR_TLS_UNTRUSTED" -> PollFailure.Tls(e.code)
        "ERR_INVALID_ARGUMENT" -> PollFailure.Other(e.message ?: e.code)
        else -> PollFailure.Offline(e.code)
      }
    }
    if (res.status == 401 || res.status == 403) return calls.map { RpcResult.Err("ACCESS_DENIED") }
    // A gateway or proxy answering for a router that is gone.
    if (res.status in 502..504) throw PollFailure.Offline("HTTP ${res.status}")
    if (res.status != 200) throw PollFailure.Other("HTTP ${res.status}")
    val parsed = try {
      val text = res.body.trim()
      if (text.startsWith("[")) JSONArray(text) else JSONArray().put(JSONObject(text))
    } catch (e: Exception) {
      throw PollFailure.Other("not JSON")
    }
    val replies = (0 until parsed.length()).mapNotNull { parsed.optJSONObject(it) }
    return calls.indices.map { i ->
      // Some uhttpd builds answer errors with "id": null; they keep the request order.
      val reply = replies.firstOrNull { it.optInt("id", -1) == ids[i] } ?: replies.getOrNull(i)
      reply?.let(::decode) ?: RpcResult.Err("UNKNOWN")
    }
  }

  private fun decode(reply: JSONObject): RpcResult {
    reply.optJSONObject("error")?.let { error ->
      return RpcResult.Err(
        when (error.optInt("code")) {
          -32002 -> "ACCESS_DENIED"
          -32000 -> "NOT_FOUND"
          -32601 -> "METHOD_NOT_FOUND"
          else -> "RPC_${error.optInt("code")}"
        },
      )
    }
    val result = reply.optJSONArray("result") ?: return RpcResult.Err("UNKNOWN")
    return when (val status = result.optInt(0, -1)) {
      0 -> RpcResult.Ok(result.optJSONObject(1) ?: JSONObject())
      3 -> RpcResult.Err("METHOD_NOT_FOUND")
      4 -> RpcResult.Err("NOT_FOUND")
      6 -> RpcResult.Err("PERMISSION_DENIED")
      else -> RpcResult.Err("STATUS_$status")
    }
  }

  companion object {
    private const val REQUEST_TIMEOUT_MS = 6_000L
    /** Design §16: without the plugin, the online count is refreshed every 10 seconds. */
    const val NEIGH_EVERY_MS = 10_000L
    private val ONLINE_STATES = setOf("REACHABLE", "STALE", "DELAY", "PROBE")
    private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

    private fun bits(bytesPerSec: Any?): Double {
      val n = (bytesPerSec as? Number)?.toDouble() ?: 0.0
      return if (n.isFinite() && n > 0) n * 8 else 0.0
    }

    /** `ip -4 neigh show`: distinct MACs in a live state, leaving out the WAN side (the ISP's gateway). */
    fun countOnline(stdout: String, exclude: Set<String>): Int {
      val macs = HashSet<String>()
      for (line in stdout.lineSequence()) {
        val t = line.trim().split(Regex("\\s+"))
        if (t.size < 3 || !IPV4.matches(t[0])) continue
        fun after(key: String) = t.indexOf(key).takeIf { it >= 0 && it + 1 < t.size }?.let { t[it + 1] }
        val dev = after("dev")
        if (dev != null && dev in exclude) continue
        val mac = after("lladdr") ?: continue
        if (t.last().uppercase(Locale.US) in ONLINE_STATES) macs += mac.uppercase(Locale.US)
      }
      return macs.size
    }
  }
}
