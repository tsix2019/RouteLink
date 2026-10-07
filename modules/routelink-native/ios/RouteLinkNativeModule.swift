import ExpoModulesCore
import Foundation

/// Lets the SSH engine send events without holding the module.
final class EventSink: @unchecked Sendable {
  weak var module: RouteLinkNativeModule?
  func send(_ name: String, _ body: [String: Any?]) { module?.sendEvent(name, body) }
}

public class RouteLinkNativeModule: Module {
  private let http = HttpEngine()
  private let events = EventSink()
  private let sshEngine = SshEngineBox()
  private var ssh: SshEngine { sshEngine.engine(events) }

  public func definition() -> ModuleDefinition {
    Name("RouteLinkNative")

    Events("onSshData", "onSshClosed", "onLiveMonitorStopped", "onLiveMonitorStatus")

    OnCreate {
      self.events.module = self
    }

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

    // Matches Android, where JavaScript timers do not run in a headless start (background task).
    AsyncFunction("sleep") { (ms: Double) async in
      try? await Task.sleep(nanoseconds: UInt64(max(ms, 0) * 1_000_000))
    }

    AsyncFunction("sshGenerateKey") { (comment: String) -> [String: String] in
      return SshKeys.generate(comment: comment)
    }

    AsyncFunction("sshPublicKey") { (seed: String, comment: String) throws -> String in
      return try SshKeys.publicLine(seed: seed, comment: comment)
    }

    AsyncFunction("sshHostKey") { (host: String, port: Int, timeoutMs: Double?) async throws -> [String: String] in
      return try await self.ssh.hostKey(host: host, port: port, timeoutMs: timeoutMs ?? 10_000)
    }

    AsyncFunction("sshOpen") { (options: SshOptions) async throws -> String in
      return try await self.ssh.open(options)
    }

    AsyncFunction("sshWrite") { (id: String, data: String) async throws in
      try await self.ssh.write(id: id, data: data)
    }

    AsyncFunction("sshResize") { (id: String, cols: Int, rows: Int) async in
      await self.ssh.resize(id: id, cols: cols, rows: rows)
    }

    AsyncFunction("sshClose") { (id: String) async in
      await self.ssh.close(id: id)
    }

    AsyncFunction("sshExec") { (options: SshOptions, command: String, timeoutMs: Double?) async throws -> [String: Any] in
      return try await self.ssh.exec(options, command: command, timeoutMs: timeoutMs ?? 30_000)
    }

    // The live monitor is an Android foreground service (design §16); iOS would need a Live Activity.
    AsyncFunction("startLiveMonitor") { (config: [String: Any]) throws in
      throw liveUnsupported()
    }
    AsyncFunction("updateLiveMonitor") { (update: [String: Any]) throws in
      throw liveUnsupported()
    }
    AsyncFunction("stopLiveMonitor") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("getLiveMonitorState") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("clearLiveMonitorInterruption") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("getLiveMonitorSupport") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("canPostPromotedNotifications") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("openPromotedNotificationSettings") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("openNotificationSettings") { () throws in
      throw liveUnsupported()
    }
    AsyncFunction("openBatteryOptimizationSettings") { () throws in
      throw liveUnsupported()
    }

    OnDestroy {
      Task { await self.ssh.closeAll() }
    }
  }
}

private func liveUnsupported() -> Exception {
  return nativeError("ERR_UNSUPPORTED", "The live monitor is only available on Android")
}

/// Creates the engine once, on first use, whichever thread gets there first.
final class SshEngineBox: @unchecked Sendable {
  private let lock = NSLock()
  private var created: SshEngine?

  func engine(_ events: EventSink) -> SshEngine {
    lock.withLock {
      if let created { return created }
      let engine = SshEngine { name, body in events.send(name, body) }
      created = engine
      return engine
    }
  }
}
