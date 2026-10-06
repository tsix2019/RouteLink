import Citadel
import CryptoKit
import ExpoModulesCore
import Foundation
import NIOCore
import NIOSSH

struct SshOptions: Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var username: String = "root"
  @Field var password: String?
  /// The app key's 32-byte ed25519 seed, base64; used instead of the password when set.
  @Field var keySeed: String?
  /// Pinned host key, "SHA256:…" (OpenSSH notation). Required: sshHostKey reads it on the first connection.
  @Field var hostKey: String?
  @Field var cols: Int = 80
  @Field var rows: Int = 24
  @Field var timeoutMs: Double = 10_000
}

private struct HostKeyRejected: Error {}
private struct CommandTimedOut: Error {}

/// OpenSSH's notation for a key: SHA256 of its blob, base64 without padding.
func sshFingerprint(_ blob: Data) -> String {
  "SHA256:" + Data(SHA256.hash(data: blob)).base64EncodedString().replacingOccurrences(of: "=", with: "")
}

/// Captures the server's key; accepts it only when it matches the pin (no pin: probe, always refuse).
/// Never waits for the user here: Citadel gives connect, key exchange and login 10 seconds together.
private final class Pin: NIOSSHClientServerAuthenticationDelegate, @unchecked Sendable {
  let pinned: String?
  private let lock = NSLock()
  private var _seen: (type: String, fingerprint: String)?
  var seen: (type: String, fingerprint: String)? { lock.withLock { _seen } }

  init(_ pinned: String?) { self.pinned = pinned }

  func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
    // "ssh-ed25519 AAAA…": the second field is the key blob.
    let fields = String(openSSHPublicKey: hostKey).split(separator: " ")
    let blob = fields.count > 1 ? Data(base64Encoded: String(fields[1])) ?? Data() : Data()
    let found = (type: fields.first.map(String.init) ?? "unknown", fingerprint: sshFingerprint(blob))
    lock.withLock { _seen = found }
    if let pinned, pinned == found.fingerprint {
      validationCompletePromise.succeed(())
    } else {
      validationCompletePromise.fail(HostKeyRejected())
    }
  }
}

/// Collected output of a one-off command.
private final class ExecOutput: @unchecked Sendable {
  private let lock = NSLock()
  private var stdout = Data()
  private var stderr = Data()
  private var exitCode: Int? = 0
  private var ended = false
  private static let limit = 1 << 20

  /// The command's output stream ended (with or without an exit status).
  var done: Bool { lock.withLock { ended } }

  func append(_ buffer: ByteBuffer, error: Bool) {
    lock.withLock {
      let bytes = Data(buffer.readableBytesView)
      if error {
        if stderr.count < Self.limit { stderr.append(bytes.prefix(Self.limit - stderr.count)) }
      } else if stdout.count < Self.limit {
        stdout.append(bytes.prefix(Self.limit - stdout.count))
      }
    }
  }

  func finish(code: Int?) {
    lock.withLock {
      exitCode = code
      ended = true
    }
  }

  var result: [String: Any] {
    lock.withLock {
      [
        "code": exitCode.map { $0 as Any } ?? NSNull(),
        "stdout": String(decoding: stdout, as: UTF8.self),
        "stderr": String(decoding: stderr, as: UTF8.self),
      ]
    }
  }
}

/// SSH with Citadel (design §17): interactive shells with a PTY, one-off commands, host key pinning. The first
/// connection is two steps, as on Android: sshHostKey reads the key, the user confirms it, then sshOpen pins it.
actor SshEngine {
  private struct Live {
    let client: SSHClient
    let task: Task<Void, Never>
    var writer: TTYStdinWriter?
  }

  private var live: [String: Live] = [:]
  private var pendingWriters: [String: TTYStdinWriter] = [:]
  private let emit: @Sendable (String, [String: Any?]) -> Void

  init(emit: @escaping @Sendable (String, [String: Any?]) -> Void) {
    self.emit = emit
  }

  func hostKey(host: String, port: Int, timeoutMs: Double) async throws -> [String: String] {
    let pin = Pin(nil)
    do {
      let client = try await SSHClient.connect(
        host: host, port: port,
        authenticationMethod: .passwordBased(username: "routelink", password: ""),
        hostKeyValidator: .custom(pin), reconnect: .never, algorithms: Self.algorithms,
        connectTimeout: .milliseconds(Int64(timeoutMs)))
      try? await client.close()
    } catch {
      if let seen = pin.seen { return ["type": seen.type, "fingerprint": seen.fingerprint] }
      throw Self.mapError(error, pin: pin)
    }
    throw nativeError("ERR_NETWORK", "the server sent no host key")
  }

  func open(_ o: SshOptions) async throws -> String {
    let client = try await connect(o)
    let id = UUID().uuidString
    let request = SSHChannelRequestEvent.PseudoTerminalRequest(
      wantReply: true, term: "xterm-256color",
      terminalCharacterWidth: o.cols, terminalRowHeight: o.rows,
      terminalPixelWidth: 0, terminalPixelHeight: 0,
      terminalModes: .init([.ECHO: 1]))
    let emit = self.emit
    let task = Task { [weak self] in
      var failure: String?
      do {
        try await client.withPTY(request) { inbound, outbound in
          await self?.attach(id: id, writer: outbound)
          for try await chunk in inbound {
            switch chunk {
            case .stdout(let buffer), .stderr(let buffer):
              emit("onSshData", ["id": id, "data": Data(buffer.readableBytesView).base64EncodedString()])
            }
          }
        }
      } catch is CancellationError {
        // closed by sshClose
      } catch let error as SSHClient.CommandFailed {
        _ = error // the shell exited with a status: an ordinary end
      } catch {
        failure = String(describing: error)
      }
      let wasOpen = await self?.forget(id) ?? false
      if wasOpen || failure != nil {
        emit("onSshClosed", ["id": id, "error": Task.isCancelled ? nil : failure])
      }
    }
    live[id] = Live(client: client, task: task, writer: pendingWriters.removeValue(forKey: id))
    return id
  }

  private func attach(id: String, writer: TTYStdinWriter) {
    if live[id] != nil {
      live[id]?.writer = writer
    } else {
      pendingWriters[id] = writer
    }
  }

  /// Drops the session; true when it was still open (so the end was not ours).
  private func forget(_ id: String) async -> Bool {
    guard let entry = live.removeValue(forKey: id) else { return false }
    try? await entry.client.close()
    return true
  }

  func write(id: String, data: String) async throws {
    guard let writer = live[id]?.writer else {
      throw nativeError("ERR_INVALID_ARGUMENT", "no SSH session \(id)")
    }
    guard let bytes = Data(base64Encoded: data) else {
      throw nativeError("ERR_INVALID_ARGUMENT", "data is not base64")
    }
    do {
      try await writer.write(ByteBuffer(bytes: bytes))
    } catch {
      throw Self.mapError(error, pin: nil)
    }
  }

  func resize(id: String, cols: Int, rows: Int) async {
    guard let writer = live[id]?.writer else { return }
    try? await writer.changeSize(cols: cols, rows: rows, pixelWidth: 0, pixelHeight: 0)
  }

  func close(id: String) async {
    guard let entry = live.removeValue(forKey: id) else { return }
    entry.task.cancel()
    try? await entry.client.close()
  }

  func closeAll() async {
    for id in Array(live.keys) { await close(id: id) }
  }

  func exec(_ o: SshOptions, command: String, timeoutMs: Double) async throws -> [String: Any] {
    let client = try await connect(o)
    let output = ExecOutput()
    do {
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
          do {
            try await client.withExec(command) { inbound, _ in
              do {
                for try await chunk in inbound {
                  switch chunk {
                  case .stdout(let buffer): output.append(buffer, error: false)
                  case .stderr(let buffer): output.append(buffer, error: true)
                  }
                }
                output.finish(code: 0)
              } catch let failed as SSHClient.CommandFailed {
                output.finish(code: failed.exitCode)
              }
            }
          } catch {
            // withExec closes the channel when the closure returns; dropbear has usually closed it already
            // after sending the exit status ("Already closed"). The command itself finished.
            if !output.done { throw error }
          }
        }
        group.addTask {
          try await Task.sleep(nanoseconds: UInt64(timeoutMs * 1_000_000))
          throw CommandTimedOut()
        }
        try await group.next()
        group.cancelAll()
      }
    } catch is CommandTimedOut {
      try? await client.close()
      throw nativeError("ERR_TIMEOUT", "the command did not finish in \(Int(timeoutMs / 1000)) s")
    } catch {
      try? await client.close()
      throw Self.mapError(error, pin: nil)
    }
    try? await client.close()
    return output.result
  }

  private func connect(_ o: SshOptions) async throws -> SSHClient {
    guard let pinned = o.hostKey else { throw nativeError("ERR_INVALID_ARGUMENT", "no pinned host key") }
    let pin = Pin(pinned)
    let auth: SSHAuthenticationMethod
    if let seed = o.keySeed {
      guard let raw = Data(base64Encoded: seed), raw.count == 32 else {
        throw nativeError("ERR_INVALID_ARGUMENT", "an ed25519 seed has 32 bytes")
      }
      auth = .ed25519(username: o.username, privateKey: try Curve25519.Signing.PrivateKey(rawRepresentation: raw))
    } else {
      auth = .passwordBased(username: o.username, password: o.password ?? "")
    }
    do {
      return try await SSHClient.connect(
        host: o.host, port: o.port, authenticationMethod: auth,
        hostKeyValidator: .custom(pin), reconnect: .never, algorithms: Self.algorithms,
        connectTimeout: .milliseconds(Int64(o.timeoutMs)))
    } catch {
      throw Self.mapError(error, pin: pin)
    }
  }

  /// OpenWrt's dropbear has no AES-GCM, the only ciphers swift-nio-ssh offers by default.
  private static var algorithms: SSHAlgorithms {
    var algorithms = SSHAlgorithms()
    algorithms.transportProtectionSchemes = .add([AES128CTR.self])
    return algorithms
  }

  private static func mapError(_ error: Error, pin: Pin?) -> Error {
    if error is Exception { return error }
    if let pin, pin.seen != nil, pin.seen?.fingerprint != pin.pinned {
      return nativeError("SSH_HOST_KEY_CHANGED", "the router's host key is not the pinned one")
    }
    if let auth = error as? SSHClientError, case .allAuthenticationOptionsFailed = auth {
      return nativeError("SSH_AUTH_FAILED", "the router refused the login")
    }
    if error is AuthenticationFailed {
      return nativeError("SSH_AUTH_FAILED", "the router refused the login")
    }
    if let io = error as? IOError {
      switch io.errnoCode {
      case ECONNREFUSED, EHOSTUNREACH, ENETUNREACH, EHOSTDOWN:
        return nativeError("ERR_UNREACHABLE", String(describing: io))
      case ETIMEDOUT:
        return nativeError("ERR_TIMEOUT", String(describing: io))
      default:
        break
      }
    }
    if let channel = error as? ChannelError, case .connectTimeout(_) = channel {
      return nativeError("ERR_TIMEOUT", "connect timed out")
    }
    let text = String(describing: error)
    if text.contains("NIOConnectionError") || text.contains("connectionRefused") {
      return nativeError("ERR_UNREACHABLE", text)
    }
    return nativeError("ERR_NETWORK", text)
  }
}

enum SshKeys {
  static func generate(comment: String) -> [String: String] {
    let key = Curve25519.Signing.PrivateKey()
    return ["seed": key.rawRepresentation.base64EncodedString(), "publicKey": publicLine(key, comment: comment)]
  }

  static func publicLine(seed: String, comment: String) throws -> String {
    guard let raw = Data(base64Encoded: seed), raw.count == 32 else {
      throw nativeError("ERR_INVALID_ARGUMENT", "an ed25519 seed has 32 bytes")
    }
    return publicLine(try Curve25519.Signing.PrivateKey(rawRepresentation: raw), comment: comment)
  }

  /// "ssh-ed25519 AAAA… comment": the blob is the SSH wire format, two length-prefixed strings.
  private static func publicLine(_ key: Curve25519.Signing.PrivateKey, comment: String) -> String {
    func field(_ bytes: Data) -> Data {
      var length = UInt32(bytes.count).bigEndian
      return Data(bytes: &length, count: 4) + bytes
    }
    let blob = field(Data("ssh-ed25519".utf8)) + field(key.publicKey.rawRepresentation)
    return "ssh-ed25519 \(blob.base64EncodedString()) \(comment)".trimmingCharacters(in: .whitespaces)
  }
}
