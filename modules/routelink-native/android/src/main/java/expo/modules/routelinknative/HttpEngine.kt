package expo.modules.routelinknative

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

class TlsRecord : Record {
  @Field val mode: String = "system"
  @Field val sha256: String? = null
}

class HttpRequestRecord : Record {
  @Field val url: String = ""
  @Field val method: String = "GET"
  @Field val headers: Map<String, String> = emptyMap()
  @Field val body: String? = null
  @Field val timeoutMs: Double = 10_000.0
  @Field val tls: TlsRecord? = null
}

private val SHA256_HEX = Regex("^[0-9a-fA-F]{64}$")

internal class HttpEngine {
  // No redirects (LuCI login needs the 302 + Set-Cookie) and no cookie jar (routers must not share cookies).
  private val base: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .cookieJar(CookieJar.NO_COOKIES)
    .retryOnConnectionFailure(false)
    .build()

  // One client per TLS policy so pooled connections are reused between calls to the same router.
  private val clients = ConcurrentHashMap<String, OkHttpClient>()

  private fun clientFor(mode: String, sha256: String?): OkHttpClient {
    val key = "$mode:${sha256 ?: ""}"
    return clients.getOrPut(key) {
      when (mode) {
        "system" -> base
        "pinned" -> {
          val pin = sha256?.takeIf { SHA256_HEX.matches(it) }
            ?: throw NativeError("ERR_INVALID_ARGUMENT", "pinned mode requires a 64-char sha256")
          val tm = PinningTrustManager(pin.lowercase())
          base.newBuilder().sslSocketFactory(sslContextFor(tm).socketFactory, tm).hostnameVerifier { _, _ -> true }.build()
        }
        "insecure-probe" -> {
          val tm = CapturingTrustManager()
          base.newBuilder().sslSocketFactory(sslContextFor(tm).socketFactory, tm).hostnameVerifier { _, _ -> true }.build()
        }
        else -> throw NativeError("ERR_INVALID_ARGUMENT", "unknown tls mode: $mode")
      }
    }
  }

  suspend fun execute(req: HttpRequestRecord): Map<String, Any> = withContext(Dispatchers.IO) {
    val url = req.url.toHttpUrlOrNull() ?: throw NativeError("ERR_INVALID_ARGUMENT", "invalid url: ${req.url}")
    val mode = req.tls?.mode ?: "system"
    val timeout = req.timeoutMs.toLong().coerceAtLeast(500L)
    val client = clientFor(mode, req.tls?.sha256).newBuilder()
      .callTimeout(timeout, TimeUnit.MILLISECONDS)
      .connectTimeout(minOf(timeout, 5_000L), TimeUnit.MILLISECONDS)
      .readTimeout(timeout, TimeUnit.MILLISECONDS)
      .build()

    val method = req.method.uppercase(Locale.US)
    val contentType = req.headers.entries.firstOrNull { it.key.equals("content-type", ignoreCase = true) }?.value
    val body = if (method == "POST") (req.body ?: "").toRequestBody(contentType?.toMediaTypeOrNull()) else null
    val request = Request.Builder().url(url).apply {
      req.headers.forEach { (name, value) -> header(name, value) }
      method(method, body)
    }.build()

    try {
      client.newCall(request).execute().use { res ->
        val headers = LinkedHashMap<String, MutableList<String>>()
        for ((name, value) in res.headers) headers.getOrPut(name.lowercase(Locale.US)) { mutableListOf() }.add(value)
        mapOf("status" to res.code, "headers" to headers, "body" to (res.body?.string() ?: ""))
      }
    } catch (e: NativeError) {
      throw e
    } catch (e: Throwable) {
      throw mapError(e, mode)
    }
  }

  suspend fun certificate(rawUrl: String, timeoutMs: Long): Map<String, Any> = withContext(Dispatchers.IO) {
    val url = rawUrl.toHttpUrlOrNull()?.takeIf { it.isHttps }
      ?: throw NativeError("ERR_INVALID_ARGUMENT", "an https url is required: $rawUrl")
    val tm = CapturingTrustManager()
    val client = base.newBuilder()
      .sslSocketFactory(sslContextFor(tm).socketFactory, tm)
      .hostnameVerifier { _, _ -> true }
      .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS)) // always a fresh handshake
      .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .connectTimeout(minOf(timeoutMs, 5_000L), TimeUnit.MILLISECONDS)
      .build()
    try {
      client.newCall(Request.Builder().url(url).head().build()).execute().close()
    } catch (e: Throwable) {
      if (tm.leaf == null) throw mapError(e, "insecure-probe")
    }
    val leaf = tm.leaf ?: throw NativeError("ERR_NETWORK", "server did not present a certificate")
    mapOf(
      "sha256" to sha256Hex(leaf.encoded),
      "subject" to leaf.subjectX500Principal.name,
      "issuer" to leaf.issuerX500Principal.name,
      "notBefore" to iso(leaf.notBefore),
      "notAfter" to iso(leaf.notAfter),
    )
  }

  private fun iso(date: Date): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(date)

  private fun mapError(e: Throwable, mode: String): NativeError {
    val chain = generateSequence(e) { it.cause }.take(10).toList()
    fun any(predicate: (Throwable) -> Boolean) = chain.any(predicate)
    val message = e.message ?: e.javaClass.simpleName
    return when {
      any { it is CertificateException && it.message == PIN_MISMATCH } || any { it.message?.contains(PIN_MISMATCH) == true } ->
        NativeError("ERR_TLS_PIN_MISMATCH", "certificate does not match the pinned fingerprint", e)
      mode == "system" && any { it is SSLHandshakeException || it is SSLPeerUnverifiedException } ->
        NativeError("ERR_TLS_UNTRUSTED", "server certificate is not trusted", e)
      any { it is UnknownHostException } -> NativeError("ERR_DNS", message, e)
      any { it is InterruptedIOException } -> NativeError("ERR_TIMEOUT", "request timed out", e)
      any { it is ConnectException || it is NoRouteToHostException || it is PortUnreachableException } ->
        NativeError("ERR_UNREACHABLE", message, e)
      any { it is SSLException } -> NativeError("ERR_NETWORK", message, e)
      else -> NativeError("ERR_NETWORK", message, e)
    }
  }
}
