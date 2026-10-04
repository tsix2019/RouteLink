import ExpoModulesCore

public class RouteLinkNativeModule: Module {
  private let http = HttpEngine()

  public func definition() -> ModuleDefinition {
    Name("RouteLinkNative")

    AsyncFunction("httpRequest") { (options: HttpRequestOptions) async throws -> [String: Any] in
      return try await self.http.execute(options)
    }

    AsyncFunction("fetchServerCertificate") { (url: String, timeoutMs: Double?) async throws -> [String: Any] in
      return try await self.http.certificate(url, timeoutMs: timeoutMs ?? 8_000)
    }

    AsyncFunction("getNetworkInfo") { () async -> [String: Any] in
      return await NetInfo.read()
    }

    // Broadcasting needs Apple's com.apple.developer.networking.multicast entitlement, so iOS asks the router instead.
    AsyncFunction("sendWakeOnLan") { (mac: String, broadcast: String?, port: Int?) throws in
      throw nativeError("ERR_UNSUPPORTED", "Wake-on-LAN broadcast is not available on iOS; the router sends it instead")
    }
  }
}
