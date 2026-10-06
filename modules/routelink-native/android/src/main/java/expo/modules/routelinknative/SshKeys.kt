package expo.modules.routelinknative

import android.util.Base64
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.util.OpenSSHPrivateKeyUtil
import org.bouncycastle.crypto.util.OpenSSHPublicKeyUtil
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security

/**
 * The app's ed25519 key. Stored as its 32-byte seed (base64), the same bytes CryptoKit's rawRepresentation uses
 * on iOS, so one format works on both platforms.
 */
internal object SshKeys {
  fun generate(comment: String): Map<String, String> {
    val pair = Ed25519KeyPairGenerator()
      .apply { init(Ed25519KeyGenerationParameters(SecureRandom())) }
      .generateKeyPair()
    val key = pair.private as Ed25519PrivateKeyParameters
    return mapOf("seed" to b64(key.encoded), "publicKey" to publicLine(key, comment))
  }

  fun publicLine(seed: String, comment: String): String = publicLine(fromSeed(seed), comment)

  /** OpenSSH's own format, which sshj reads back. */
  fun privatePem(seed: String): String {
    val body = b64(OpenSSHPrivateKeyUtil.encodePrivateKey(fromSeed(seed)))
    return "-----BEGIN OPENSSH PRIVATE KEY-----\n${body.chunked(70).joinToString("\n")}\n-----END OPENSSH PRIVATE KEY-----\n"
  }

  /** OpenSSH's notation: SHA256 of the key blob, base64 without padding. */
  fun fingerprint(blob: ByteArray): String =
    "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(blob), Base64.NO_WRAP or Base64.NO_PADDING)

  private fun fromSeed(seed: String): Ed25519PrivateKeyParameters {
    val bytes = Base64.decode(seed, Base64.NO_WRAP)
    if (bytes.size != Ed25519PrivateKeyParameters.KEY_SIZE) {
      throw NativeError("ERR_INVALID_ARGUMENT", "an ed25519 seed has ${Ed25519PrivateKeyParameters.KEY_SIZE} bytes")
    }
    return Ed25519PrivateKeyParameters(bytes, 0)
  }

  private fun publicLine(key: Ed25519PrivateKeyParameters, comment: String): String =
    "ssh-ed25519 ${b64(OpenSSHPublicKeyUtil.encodePublicKey(key.generatePublicKey()))} $comment".trim()

  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
}

/**
 * Android ships a cut-down provider named "BC" without X25519 or Ed25519. sshj looks its algorithms up by that
 * name, so the full BouncyCastle has to take its place before the first DefaultConfig is built.
 */
internal object BouncyCastle {
  @Synchronized
  fun ensure() {
    if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)?.javaClass == BouncyCastleProvider::class.java) return
    Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
    Security.addProvider(BouncyCastleProvider())
  }
}
