package expo.modules.routelinknative

import java.util.Locale
import kotlin.math.roundToLong

/**
 * Text of the live monitor notification. Mirrors src/features/live/format.ts (tested there with Jest):
 * keep both in step. The words come from JavaScript as templates ({rx}, {name}…), so nothing here is
 * language-specific except the units, which are the same in English and Chinese.
 */
internal object LiveFormat {
  private val RATE_UNITS = listOf("bps", "Kbps", "Mbps", "Gbps")
  private val CHIP_UNITS = listOf("K", "M", "G", "T")

  /** 12_300_000 → "12.3 Mbps" (formatBitRate in src/utils/format.ts). */
  fun rate(bitsPerSec: Double): String {
    var n = if (bitsPerSec.isFinite() && bitsPerSec > 0) bitsPerSec else 0.0
    var i = 0
    while (n >= 1000 && i < RATE_UNITS.size - 1) {
      n /= 1000
      i++
    }
    val digits = if (i == 0 || n >= 100) 0 else 1
    return "${fixed(n, digits)} ${RATE_UNITS[i]}"
  }

  /** The status-bar chip: "↓12.3M", at most 7 characters so Android shows all of it. */
  fun chip(bitsPerSec: Double): String {
    val v = if (bitsPerSec.isFinite() && bitsPerSec > 0) bitsPerSec else 0.0
    if (v < 50) return "↓0K"
    var n = v / 1000
    var i = 0
    while (i < CHIP_UNITS.size - 1 && (n * 10).roundToLong() / 10.0 >= 999.95) {
      n /= 1000
      i++
    }
    val text = if ((n * 10).roundToLong() < 1000) fixed(n, 1) else n.roundToLong().toString()
    return "↓$text${CHIP_UNITS[i]}"
  }

  /** "3 分 20 秒" from the {s} / {m}{s} / {h}{m} templates. */
  fun duration(ms: Long, texts: LiveTexts): String {
    val total = (ms.coerceAtLeast(0) + 500) / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return when {
      total < 60 -> fill(texts.sec, "s" to s.toString())
      total < 3600 -> fill(texts.minSec, "m" to m.toString(), "s" to s.toString())
      else -> fill(texts.hourMin, "h" to h.toString(), "m" to m.toString())
    }
  }

  /** "↓ 12.3 Mbps ↑ 1.2 Mbps · 18 online". */
  fun line(sample: LiveSample, texts: LiveTexts): String {
    val rx = rate(sample.rxBps)
    val tx = rate(sample.txBps)
    val online = sample.online
    return if (online == null) {
      fill(texts.lineNoCount, "rx" to rx, "tx" to tx)
    } else {
      fill(texts.line, "rx" to rx, "tx" to tx, "online" to online.toString())
    }
  }

  /** "Busiest: Ming's iPad ↓ 8.1 Mbps", or null when nothing is moving (or the plugin is missing). */
  fun top(sample: LiveSample, names: Map<String, String>, texts: LiveTexts): String? {
    val device = sample.devices.maxByOrNull { it.rxBps + it.txBps } ?: return null
    if (maxOf(device.rxBps, device.txBps) < MIN_TOP_BPS) return null
    val name = names[device.mac.uppercase(Locale.US)] ?: names[device.mac] ?: device.mac
    val rate = if (device.rxBps >= device.txBps) "↓ ${rate(device.rxBps)}" else "↑ ${rate(device.txBps)}"
    return fill(texts.top, "name" to name, "rate" to rate)
  }

  fun fill(template: String, vararg values: Pair<String, String>): String =
    values.fold(template) { acc, (key, value) -> acc.replace("{$key}", value) }

  private fun fixed(n: Double, digits: Int): String = String.format(Locale.US, "%.${digits}f", n)

  /** 1 KB/s: below that the "busiest device" line is noise. */
  const val MIN_TOP_BPS = 8_000.0
}
