import CryptoKit
import ExpoModulesCore
import Foundation
import Security

struct TlsOptions: Record {
  @Field var mode: String = "system"
  @Field var sha256: String?
}

struct HttpRequestOptions: Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String?
  @Field var timeoutMs: Double = 10_000
  @Field var tls: TlsOptions?
  /// "base64" for binary answers (backups); text otherwise.
  @Field var responseEncoding: String = "utf8"
}

func sha256Hex(_ data: Data) -> String {
  return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// Per-request delegate: certificate policy, no redirects, and a record of what went wrong.
final class TaskDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  let mode: String
  let pin: String?
  private(set) var pinMismatch = false
  private(set) var untrusted = false
  private(set) var leaf: SecCertificate?

  init(mode: String, pin: String?) {
    self.mode = mode
    self.pin = pin?.lowercased()
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    let chain = (SecTrustCopyCertificateChain(trust) as? [SecCertificate]) ?? []
    leaf = chain.first

    switch mode {
    case "pinned":
      if let leaf = leaf, let pin = pin, sha256Hex(SecCertificateCopyData(leaf) as Data) == pin {
        completionHandler(.useCredential, URLCredential(trust: trust))
      } else {
        pinMismatch = true
        completionHandler(.cancelAuthenticationChallenge, nil)
      }
    case "insecure-probe":
      completionHandler(.useCredential, URLCredential(trust: trust))
    default:
      if SecTrustEvaluateWithError(trust, nil) {
        completionHandler(.performDefaultHandling, nil)
      } else {
        untrusted = true
        completionHandler(.cancelAuthenticationChallenge, nil)
      }
    }
  }

  // LuCI login answers 302 + Set-Cookie: hand the redirect response back instead of following it.
  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

final class HttpEngine {
  func execute(_ options: HttpRequestOptions) async throws -> [String: Any] {
    guard let url = URL(string: options.url), url.scheme == "http" || url.scheme == "https" else {
      throw nativeError("ERR_INVALID_ARGUMENT", "invalid url: \(options.url)")
    }
    let mode = options.tls?.mode ?? "system"
    let pin = options.tls?.sha256
    if mode == "pinned" && pin?.count != 64 {
      throw nativeError("ERR_INVALID_ARGUMENT", "pinned mode requires a 64-char sha256")
    }
    let timeout = max(0.5, options.timeoutMs / 1000)

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    request.httpMethod = options.method.uppercased()
    request.httpShouldHandleCookies = false
    for (name, value) in options.headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    if request.httpMethod == "POST" {
      request.httpBody = (options.body ?? "").data(using: .utf8)
    }

    let delegate = TaskDelegate(mode: mode, pin: pin)
    let session = makeSession(delegate: delegate, timeout: timeout)
    defer { session.finishTasksAndInvalidate() }

    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        throw nativeError("ERR_NETWORK", "not an HTTP response")
      }
      return [
        "status": http.statusCode,
        "headers": headers(of: http),
        "body": options.responseEncoding == "base64"
          ? data.base64EncodedString() : String(decoding: data, as: UTF8.self),
      ]
    } catch let error as Exception {
      throw error
    } catch {
      throw mapError(error, delegate: delegate, mode: mode)
    }
  }

  func certificate(_ rawUrl: String, timeoutMs: Double) async throws -> [String: Any] {
    guard let url = URL(string: rawUrl), url.scheme == "https" else {
      throw nativeError("ERR_INVALID_ARGUMENT", "an https url is required: \(rawUrl)")
    }
    let timeout = max(0.5, timeoutMs / 1000)
    let delegate = TaskDelegate(mode: "insecure-probe", pin: nil)
    let session = makeSession(delegate: delegate, timeout: timeout)
    defer { session.finishTasksAndInvalidate() }

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    request.httpMethod = "HEAD"
    do {
      _ = try await session.data(for: request)
    } catch {
      if delegate.leaf == nil {
        throw mapError(error, delegate: delegate, mode: "insecure-probe")
      }
    }
    guard let leaf = delegate.leaf else {
      throw nativeError("ERR_NETWORK", "server did not present a certificate")
    }
    return [
      "sha256": sha256Hex(SecCertificateCopyData(leaf) as Data),
      "subject": (SecCertificateCopySubjectSummary(leaf) as String?) ?? "",
      "issuer": "",
      "notBefore": "",
      "notAfter": "",
    ]
  }

  private func makeSession(delegate: TaskDelegate, timeout: TimeInterval) -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.httpCookieAcceptPolicy = .never
    config.httpCookieStorage = nil
    config.urlCache = nil
    config.timeoutIntervalForRequest = timeout
    config.timeoutIntervalForResource = timeout
    config.waitsForConnectivity = false
    return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
  }

  private func headers(of http: HTTPURLResponse) -> [String: [String]] {
    var out: [String: [String]] = [:]
    var raw: [String: String] = [:]
    for (key, value) in http.allHeaderFields {
      guard let name = key as? String else { continue }
      let text = "\(value)"
      raw[name] = text
      if name.lowercased() != "set-cookie" {
        out[name.lowercased(), default: []].append(text)
      }
    }
    // Foundation folds repeated Set-Cookie headers into one line; split them back into name=value pairs.
    if let url = http.url {
      let cookies = HTTPCookie.cookies(withResponseHeaderFields: raw, for: url)
      if !cookies.isEmpty {
        out["set-cookie"] = cookies.map { "\($0.name)=\($0.value)" }
      }
    }
    return out
  }

  private func mapError(_ error: Error, delegate: TaskDelegate, mode: String) -> Exception {
    if delegate.pinMismatch {
      return nativeError("ERR_TLS_PIN_MISMATCH", "certificate does not match the pinned fingerprint")
    }
    if delegate.untrusted {
      return nativeError("ERR_TLS_UNTRUSTED", "server certificate is not trusted")
    }
    let ns = error as NSError
    if ns.domain == NSURLErrorDomain {
      switch ns.code {
      case NSURLErrorTimedOut:
        return nativeError("ERR_TIMEOUT", "request timed out")
      case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet:
        return nativeError("ERR_UNREACHABLE", ns.localizedDescription)
      case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
        return nativeError("ERR_DNS", ns.localizedDescription)
      case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot,
        NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateNotYetValid,
        NSURLErrorSecureConnectionFailed:
        return mode == "system"
          ? nativeError("ERR_TLS_UNTRUSTED", ns.localizedDescription)
          : nativeError("ERR_NETWORK", ns.localizedDescription)
      default:
        break
      }
    }
    return nativeError("ERR_NETWORK", ns.localizedDescription)
  }
}
