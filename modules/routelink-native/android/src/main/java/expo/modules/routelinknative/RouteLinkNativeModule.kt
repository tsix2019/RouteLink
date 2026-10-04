package expo.modules.routelinknative

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RouteLinkNativeModule : Module() {
  private val http = HttpEngine()

  override fun definition() = ModuleDefinition {
    Name("RouteLinkNative")

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
  }
}
