package expo.modules.routelinknative

import expo.modules.kotlin.exception.CodedException

/** Rejects the JS promise with `error.code` set to one of the NativeErrorCode values. */
internal class NativeError(code: String, message: String, cause: Throwable? = null) :
  CodedException(code, message, cause)
