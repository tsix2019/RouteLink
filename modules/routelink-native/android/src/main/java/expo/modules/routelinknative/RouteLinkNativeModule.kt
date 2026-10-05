package expo.modules.routelinknative

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RouteLinkNativeModule : Module() {
  private val http = HttpEngine()
  private val ssh = SshEngine { name, payload -> sendEvent(name, payload) }

  override fun definition() = ModuleDefinition {
    Name("RouteLinkNative")

    Events("onSshData", "onSshClosed")

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

    OnDestroy {
      ssh.closeAll()
    }
  }
}
