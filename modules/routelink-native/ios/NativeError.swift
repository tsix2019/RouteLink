import ExpoModulesCore

/// Rejects the JS promise with `error.code` set to one of the NativeErrorCode values.
func nativeError(_ code: String, _ message: String) -> Exception {
  return Exception(name: "RouteLinkNativeError", description: message, code: code)
}
