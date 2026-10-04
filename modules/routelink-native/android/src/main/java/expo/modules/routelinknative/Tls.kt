package expo.modules.routelinknative

import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

internal const val PIN_MISMATCH = "RL_PIN_MISMATCH"

internal fun sha256Hex(bytes: ByteArray): String =
  MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Trust-on-first-use pinning: accept exactly one leaf certificate, ignoring CA chain and hostname. */
internal class PinningTrustManager(private val expected: String) : X509TrustManager {
  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    val leaf = chain.firstOrNull() ?: throw CertificateException(PIN_MISMATCH)
    if (!sha256Hex(leaf.encoded).equals(expected, ignoreCase = true)) throw CertificateException(PIN_MISMATCH)
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
    throw CertificateException("client certificates are not supported")

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** Accepts any certificate and remembers the leaf. Used for discovery probes and fetchServerCertificate. */
internal class CapturingTrustManager : X509TrustManager {
  @Volatile
  var leaf: X509Certificate? = null

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    leaf = chain.firstOrNull()
  }

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
    throw CertificateException("client certificates are not supported")

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

internal fun sslContextFor(trustManager: X509TrustManager): SSLContext =
  SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), SecureRandom()) }
