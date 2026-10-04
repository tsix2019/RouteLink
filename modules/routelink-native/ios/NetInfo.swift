import Foundation
import Network

/// Resumes a continuation exactly once, from whichever callback fires first.
private final class Once<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var done = false
  private let resume: (T) -> Void

  init(_ resume: @escaping (T) -> Void) { self.resume = resume }

  func fire(_ value: T) {
    lock.lock()
    let first = !done
    done = true
    lock.unlock()
    if first { resume(value) }
  }
}

enum NetInfo {
  /// Every key is present, as on Android; unknown values are null (NSNull).
  static func read() async -> [String: Any] {
    let path = await currentPath()
    var out: [String: Any] = [
      "isWifi": path?.usesInterfaceType(.wifi) ?? false,
      "ip": NSNull(), "netmask": NSNull(), "gateway": NSNull(), "ifname": NSNull(),
    ]
    for endpoint in path?.gateways ?? [] {
      if case let .hostPort(host, _) = endpoint, case let .ipv4(address) = host {
        out["gateway"] = address.rawValue.map { String($0) }.joined(separator: ".")
        break
      }
    }
    if let (ip, mask, name) = primaryIPv4() {
      out["ip"] = ip
      if let mask = mask { out["netmask"] = mask }
      out["ifname"] = name
    }
    return out
  }

  private static func currentPath() async -> NWPath? {
    return await withCheckedContinuation { continuation in
      let monitor = NWPathMonitor()
      let queue = DispatchQueue(label: "io.github.tsix2019.routelink.netinfo")
      let once = Once<NWPath?> { path in
        monitor.pathUpdateHandler = nil
        monitor.cancel()
        continuation.resume(returning: path)
      }
      monitor.pathUpdateHandler = { path in once.fire(path) }
      monitor.start(queue: queue)
      queue.asyncAfter(deadline: .now() + 2) { once.fire(nil) }
    }
  }

  /// IPv4 address and netmask of the Wi-Fi interface (en0), else the first other en* interface.
  private static func primaryIPv4() -> (String, String?, String)? {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return nil }
    defer { freeifaddrs(list) }

    var fallback: (String, String?, String)?
    for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let entry = pointer.pointee
      guard let address = entry.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
      let name = String(cString: entry.ifa_name)
      guard let ip = numericHost(address) else { continue }
      let mask = entry.ifa_netmask.flatMap(numericHost)
      if name == "en0" { return (ip, mask, name) }
      if fallback == nil && name.hasPrefix("en") { fallback = (ip, mask, name) }
    }
    return fallback
  }

  private static func numericHost(_ address: UnsafeMutablePointer<sockaddr>) -> String? {
    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
    let result = getnameinfo(
      address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
    return result == 0 ? String(cString: host) : nil
  }
}
