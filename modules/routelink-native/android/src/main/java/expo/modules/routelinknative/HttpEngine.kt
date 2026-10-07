package expo.modules.routelinknative

import android.util.Base64
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
import java.io.EOFException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.SocketException
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
  /** "base64" for binary answers (backups); text otherwise. */
  @Field val responseEncoding: String = "utf8"
}

private val SHA256_HEX = Regex("^[0-9a-fA-F]{64}$")

internal class HttpResult(val status: Int, val headers: Map<String, List<String>>, val body: String)

internal class HttpEngine {
  // No redirects (LuCI login needs the 302 + Set-Cookie) and no cookie jar (routers must not share cookies).
  // No silent retries either (a repeated ubus call could repeat an action), so a pooled connection the
  // router already closed would surface as "unexpected end of stream". Idle connections are therefore
  // dropped after 4 s: below the idle timeouts of uhttpd (30 s), lighttpd (5 s) and nginx (65 s),
  // while 1–2 s polling still reuses its connection.
  private val base: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .cookieJar(CookieJar.NO_COOKIES)
    .retryOnConnectionFailure(false)
    .connectionPool(ConnectionPool(4, 4, TimeUnit.SECONDS))
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

  suspend fun execute(req: HttpRequestRecord): Map<String, Any> {
    val res = perform(
      url = req.url,
      method = req.method,
      headers = req.headers,
      body = req.body,
      timeoutMs = req.timeoutMs.toLong(),
      tlsMode = req.tls?.mode ?: "system",
      sha256 = req.tls?.sha256,
      base64 = req.responseEncoding == "base64",
    )
    return mapOf("status" to res.status, "headers" to res.headers, "body" to res.body)
  }

  /** One request; failures are NativeErrors with the codes the JS side knows. Also used by the live monitor. */
  suspend fun perform(
    url: String,
    method: String,
    headers: Map<String, String>,
    body: String?,
    timeoutMs: Long,
    tlsMode: String = "system",
    sha256: String? = null,
    base64: Boolean = false,
  ): HttpResult = withContext(Dispatchers.IO) {
    val target = url.toHttpUrlOrNull() ?: throw NativeError("ERR_INVALID_ARGUMENT", "invalid url: $url")
    val timeout = timeoutMs.coerceAtLeast(500L)
    val client = clientFor(tlsMode, sha256).newBuilder()
      .callTimeout(timeout, TimeUnit.MILLISECONDS)
      .connectTimeout(minOf(timeout, 5_000L), TimeUnit.MILLISECONDS)
      .readTimeout(timeout, TimeUnit.MILLISECONDS)
      .build()

    val verb = method.uppercase(Locale.US)
    val contentType = headers.entries.firstOrNull { it.key.equals("content-type", ignoreCase = true) }?.value
    val payload = if (verb == "POST") (body ?: "").toRequestBody(contentType?.toMediaTypeOrNull()) else null
    val request = Request.Builder().url(target).apply {
      headers.forEach { (name, value) -> header(name, value) }
      method(verb, payload)
    }.build()

    try {
      client.newCall(request).execute().use { res ->
        val names = LinkedHashMap<String, MutableList<String>>()
        for ((name, value) in res.headers) names.getOrPut(name.lowercase(Locale.US)) { mutableListOf() }.add(value)
        val text = if (base64) {
          Base64.encodeToString(res.body?.bytes() ?: ByteArray(0), Base64.NO_WRAP)
        } else {
          res.body?.string() ?: ""
        }
        HttpResult(res.code, names, text)
      }
    } catch (e: NativeError) {
      throw e
    } catch (e: Throwable) {
      throw mapError(e, tlsMode)
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
      // A handshake the network cut short (router rebooting, Wi-Fi flapping) says nothing about the certificate.
      mode == "system" && any { it is SSLHandshakeException || it is SSLPeerUnverifiedException } &&
        !any { it is EOFException || it is SocketException } ->
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
