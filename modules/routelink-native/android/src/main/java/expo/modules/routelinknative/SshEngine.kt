package expo.modules.routelinknative

import android.util.Base64
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.DisconnectReason
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.connection.ConnectionException
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.TransportException
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class SshOptionsRecord : Record {
  @Field val host: String = ""
  @Field val port: Int = 22
  @Field val username: String = "root"
  @Field val password: String? = null
  /** The app key's 32-byte ed25519 seed, base64; used instead of the password when set. */
  @Field val keySeed: String? = null
  /** Pinned host key, "SHA256:…" (OpenSSH notation). Required: sshHostKey reads it on the first connection. */
  @Field val hostKey: String? = null
  @Field val cols: Int = 80
  @Field val rows: Int = 24
  /** TCP connect, key exchange and login, each. */
  @Field val timeoutMs: Double = 10_000.0
}

/** Captures the server's key; accepts it only when it matches the pin (no pin: probe, always refuse). */
private class Pin(private val pinned: String?) : HostKeyVerifier {
  @Volatile var seen: Pair<String, String>? = null

  override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
    val blob = Buffer.PlainBuffer().putPublicKey(key).compactData
    val fingerprint = SshKeys.fingerprint(blob)
    seen = KeyType.fromKey(key).toString() to fingerprint
    return pinned != null && fingerprint == pinned
  }

  override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
}

private const val MAX_EXEC_OUTPUT = 1 shl 20

/**
 * SSH with sshj (design §17): interactive shells with a PTY, one-off commands, host key pinning. The first
 * connection is two steps, as on iOS: sshHostKey reads the key, the user confirms it, then sshOpen pins it.
 */
internal class SshEngine(private val emit: (String, Map<String, Any?>) -> Unit) {
  private class Live(val client: SSHClient, val session: Session, val shell: Session.Shell) {
    val closed = AtomicBoolean(false)
  }

  private val live = ConcurrentHashMap<String, Live>()

  fun hostKey(host: String, port: Int, timeoutMs: Long): Map<String, String> {
    val pin = Pin(null)
    val client = client(timeoutMs.toInt())
    client.addHostKeyVerifier(pin)
    try {
      client.connect(host, port)
    } catch (e: Exception) {
      pin.seen?.let { (type, fingerprint) -> return mapOf("type" to type, "fingerprint" to fingerprint) }
      throw mapError(e)
    } finally {
      runCatching { client.disconnect() }
    }
    throw NativeError("ERR_NETWORK", "the server sent no host key")
  }

  fun open(o: SshOptionsRecord): String {
    val client = connect(o)
    try {
      val session = client.startSession()
      session.allocatePTY("xterm-256color", o.cols, o.rows, 0, 0, emptyMap())
      val shell = session.startShell()
      val id = UUID.randomUUID().toString()
      val entry = Live(client, session, shell)
      live[id] = entry
      thread(name = "ssh-$id", isDaemon = true) { pump(id, entry) }
      return id
    } catch (e: Exception) {
      runCatching { client.disconnect() }
      throw mapError(e)
    }
  }

  fun write(id: String, data: String) {
    val entry = live[id] ?: throw NativeError("ERR_INVALID_ARGUMENT", "no SSH session $id")
    try {
      entry.shell.outputStream.run {
        write(Base64.decode(data, Base64.NO_WRAP))
        flush()
      }
    } catch (e: Exception) {
      throw mapError(e)
    }
  }

  fun resize(id: String, cols: Int, rows: Int) {
    val entry = live[id] ?: return
    runCatching { entry.shell.changeWindowDimensions(cols, rows, 0, 0) }
  }

  fun close(id: String) {
    val entry = live.remove(id) ?: return
    runCatching { entry.shell.close() }
    runCatching { entry.session.close() }
    runCatching { entry.client.disconnect() }
  }

  fun closeAll() = live.keys.toList().forEach(::close)

  fun exec(o: SshOptionsRecord, command: String, timeoutMs: Long): Map<String, Any?> {
    val client = connect(o)
    try {
      client.startSession().use { session ->
        val cmd = session.exec(command)
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val readers = listOf(cmd.inputStream to out, cmd.errorStream to err).map { (input, sink) ->
          thread(isDaemon = true) { runCatching { copyCapped(input, sink) } }
        }
        try {
          cmd.join(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: ConnectionException) {
          throw NativeError("ERR_TIMEOUT", "the command did not finish in ${timeoutMs / 1000} s")
        }
        readers.forEach { it.join(2_000) }
        return mapOf(
          "code" to cmd.exitStatus,
          "stdout" to out.toString(Charsets.UTF_8.name()),
          "stderr" to err.toString(Charsets.UTF_8.name()),
        )
      }
    } catch (e: NativeError) {
      throw e
    } catch (e: Exception) {
      throw mapError(e)
    } finally {
      runCatching { client.disconnect() }
    }
  }

  private fun client(timeoutMs: Int): SSHClient {
    BouncyCastle.ensure()
    val client = SSHClient(DefaultConfig().apply { this.timeoutMs = timeoutMs })
    client.connectTimeout = timeoutMs
    client.connection.keepAlive.keepAliveInterval = 15
    return client
  }

  private fun connect(o: SshOptionsRecord): SSHClient {
    val pinned = o.hostKey ?: throw NativeError("ERR_INVALID_ARGUMENT", "no pinned host key")
    val client = client(o.timeoutMs.toInt())
    client.addHostKeyVerifier(Pin(pinned))
    try {
      client.connect(o.host, o.port)
      val seed = o.keySeed
      if (seed != null) {
        client.authPublickey(o.username, client.loadKeys(SshKeys.privatePem(seed), null, null))
      } else {
        client.authPassword(o.username, o.password ?: "")
      }
      return client
    } catch (e: Exception) {
      runCatching { client.disconnect() }
      throw mapError(e)
    }
  }

  private fun pump(id: String, entry: Live) {
    var error: String? = null
    try {
      val buffer = ByteArray(8192)
      val input = entry.shell.inputStream
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        if (n > 0) emit("onSshData", mapOf("id" to id, "data" to Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP)))
      }
    } catch (e: Exception) {
      // Closing from our side also ends up here; that is not an error.
      if (live.containsKey(id)) error = e.message ?: e.javaClass.simpleName
    } finally {
      close(id)
      if (entry.closed.compareAndSet(false, true)) emit("onSshClosed", mapOf("id" to id, "error" to error))
    }
  }

  private fun copyCapped(input: InputStream, sink: ByteArrayOutputStream) {
    val buffer = ByteArray(8192)
    while (true) {
      val n = input.read(buffer)
      if (n < 0) return
      if (sink.size() < MAX_EXEC_OUTPUT) sink.write(buffer, 0, minOf(n, MAX_EXEC_OUTPUT - sink.size()))
    }
  }

  private fun mapError(e: Throwable): Throwable {
    if (e is NativeError) return e
    var cause: Throwable? = e
    while (cause != null) {
      when (cause) {
        is UserAuthException -> return NativeError("SSH_AUTH_FAILED", "the router refused the login", e)
        is TransportException -> if (cause.disconnectReason == DisconnectReason.HOST_KEY_NOT_VERIFIABLE) {
          return NativeError("SSH_HOST_KEY_CHANGED", "the router's host key is not the pinned one", e)
        }
        is UnknownHostException -> return NativeError("ERR_DNS", cause.message ?: "unknown host", e)
        is ConnectException, is NoRouteToHostException, is PortUnreachableException ->
          return NativeError("ERR_UNREACHABLE", cause.message ?: "unreachable", e)
        is SocketTimeoutException, is InterruptedIOException ->
          return NativeError("ERR_TIMEOUT", cause.message ?: "timed out", e)
      }
      cause = cause.cause
    }
    return NativeError("ERR_NETWORK", e.message ?: e.javaClass.simpleName, e)
  }
}
