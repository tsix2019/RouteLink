package expo.modules.routelinknative

import android.app.Notification
import android.content.Context
import android.os.Build

/**
 * Android 17's Notification.MetricStyle (↓, ↑, online devices; design §16 LU-2). The project compiles
 * against API 36, so the API-37 classes are reached by reflection (they are public SDK API, documented at
 * developer.android.com/reference/android/app/Notification.MetricStyle); anything missing or changed just
 * leaves the notification with its BigText style.
 */
internal object LiveMetrics {
  private const val API_37 = 37
  private val UNITS = listOf("Kbps", "Mbps", "Gbps")

  private class Api(
    val style: Class<*>,
    val metric: Class<*>,
    val value: Class<*>,
    val fixedFloat: Class<*>,
    val fixedInt: Class<*>,
  )

  private val api: Api? by lazy {
    if (Build.VERSION.SDK_INT < API_37) return@lazy null
    try {
      Api(
        Class.forName("android.app.Notification\$MetricStyle"),
        Class.forName("android.app.Notification\$Metric"),
        Class.forName("android.app.Notification\$Metric\$MetricValue"),
        Class.forName("android.app.Notification\$Metric\$FixedFloat"),
        Class.forName("android.app.Notification\$Metric\$FixedInt"),
      )
    } catch (e: ReflectiveOperationException) {
      null
    }
  }

  /** A rate as a value and unit for FixedFloat: 12_300_000 → (12.3, "Mbps"). */
  fun scaled(bitsPerSec: Double): Pair<Float, String> {
    var n = if (bitsPerSec.isFinite() && bitsPerSec > 0) bitsPerSec / 1000 else 0.0
    var i = 0
    while (n >= 1000 && i < UNITS.size - 1) {
      n /= 1000
      i++
    }
    return n.toFloat() to UNITS[i]
  }

  private fun rateMetric(a: Api, bitsPerSec: Double, label: String): Any {
    val (value, unit) = scaled(bitsPerSec)
    val v = a.fixedFloat
      .getConstructor(Float::class.javaPrimitiveType, CharSequence::class.java, Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
      .newInstance(value, unit, 0, if (value >= 100) 0 else 1)
    return a.metric.getConstructor(a.value, CharSequence::class.java).newInstance(v, label)
  }

  /** The style for a sample, or null before Android 17 (or when the API is not what we expect). */
  fun style(sample: LiveSample, texts: LiveTexts): Notification.Style? {
    val a = api ?: return null
    return try {
      val style = a.style.getConstructor().newInstance()
      val add = a.style.getMethod("addMetric", a.metric)
      add.invoke(style, rateMetric(a, sample.rxBps, "↓"))
      add.invoke(style, rateMetric(a, sample.txBps, "↑"))
      if (sample.online != null) {
        val v = a.fixedInt.getConstructor(Int::class.javaPrimitiveType).newInstance(sample.online)
        add.invoke(style, a.metric.getConstructor(a.value, CharSequence::class.java).newInstance(v, texts.onlineLabel))
      }
      // Download is what the status-bar chip shows.
      a.style.getMethod("setCriticalMetric", Int::class.javaPrimitiveType).invoke(style, 0)
      style as Notification.Style
    } catch (e: ReflectiveOperationException) {
      null
    } catch (e: RuntimeException) {
      null
    }
  }

  /** The compat-built notification with the metric style on top, when there is one. */
  fun apply(context: Context, notification: Notification, sample: LiveSample?, texts: LiveTexts): Notification {
    val style = sample?.let { style(it, texts) } ?: return notification
    return try {
      Notification.Builder.recoverBuilder(context, notification).setStyle(style).build()
    } catch (e: RuntimeException) {
      notification
    }
  }
}
